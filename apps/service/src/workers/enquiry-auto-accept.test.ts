/**
 * Auto-accepting what a model read — the front of the pipeline, against a real
 * database.
 *
 * `extractEnquiry` cannot be exercised cheaply because it calls a model, so the
 * apply step is a function of its own and tested here directly. The rules worth
 * pinning are the ones that keep an unattended write honest: it applies a
 * confident proposal into an empty column, it never overwrites a value a person
 * put there, it leaves a proposal below the confidence ceiling in the queue, and
 * it refuses an ambiguous port exactly as the manual accept does — closing the
 * ones it applies as `applied` so the audit trail reads the same either way.
 */

import { beforeAll, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'

const APP_URL = process.env.TEST_DATABASE_URL
const enabled = Boolean(APP_URL)
if (APP_URL) process.env.DATABASE_URL = APP_URL

const { aiInvocations, branches, enquiries, extractionProposals, systemActor, withActor, workingCalendars } =
  await import('@qabandi/db')

const { autoApplyProposals } = await import('./enquiry-extract')

const BRANCH = '00000000-0000-7000-8000-0000000000f1'
const actor = systemActor()
const RUN = Date.now().toString(36).toUpperCase().slice(-5)
let seq = 0
let invocationId: string

async function makeEnquiry(over: Record<string, unknown> = {}): Promise<string> {
  seq += 1
  return withActor(actor, async (tx) => {
    const [row] = await tx
      .insert(enquiries)
      .values({
        reference: `AA-${RUN}-${seq}`,
        branchId: BRANCH,
        status: 'new',
        channel: 'email',
        ...over,
      })
      .returning({ id: enquiries.id })
    return row!.id
  })
}

/** Insert proposal rows the way extraction would, and return the apply candidates. */
async function seed(
  enquiryId: string,
  entries: readonly { field: string; value: string; confidence: number; wasEmpty?: boolean }[],
) {
  await withActor(actor, (tx) =>
    tx.insert(extractionProposals).values(
      entries.map((e) => ({
        branchId: BRANCH,
        invocationId,
        targetTable: 'enquiries' as const,
        targetId: enquiryId,
        field: e.field,
        value: e.value,
        confidence: e.confidence.toFixed(4),
        status: 'proposed' as const,
        targetWasEmpty: e.wasEmpty ?? true,
      })),
    ),
  )
  return entries.map((e) => ({
    proposal: { field: e.field, value: e.value, confidence: e.confidence },
    wasEmpty: e.wasEmpty ?? true,
  }))
}

const apply = (enquiryId: string, candidates: Awaited<ReturnType<typeof seed>>, confidence = 0.9) =>
  withActor(actor, (tx) => autoApplyProposals(tx, enquiryId, candidates, confidence))

const enquiryRow = async (id: string) => {
  const [row] = await withActor(actor, (tx) =>
    tx
      .select({
        incoterm: enquiries.incoterm,
        pieces: enquiries.pieces,
        mode: enquiries.mode,
        originId: enquiries.originId,
      })
      .from(enquiries)
      .where(eq(enquiries.id, id))
      .limit(1),
  )
  return row!
}

const statuses = (enquiryId: string) =>
  withActor(actor, (tx) =>
    tx
      .select({ field: extractionProposals.field, status: extractionProposals.status })
      .from(extractionProposals)
      .where(eq(extractionProposals.targetId, enquiryId)),
  )

describe.skipIf(!enabled)('autoApplyProposals', () => {
  beforeAll(async () => {
    const [calendar] = await withActor(actor, (tx) =>
      tx.select({ id: workingCalendars.id }).from(workingCalendars).where(eq(workingCalendars.key, 'kuwait')).limit(1),
    )
    if (!calendar) throw new Error('Run `pnpm db:seed` before the auto-accept tests')

    await withActor(actor, (tx) =>
      tx
        .insert(branches)
        .values({
          id: BRANCH,
          code: 'AAC',
          legalNameEn: 'Auto-accept Test Branch',
          legalNameAr: 'فرع',
          country: 'KW',
          baseCurrency: 'KWD',
          invoiceSeries: 'AAC',
          calendarId: calendar.id,
        })
        .onConflictDoNothing(),
    )

    invocationId = await withActor(actor, async (tx) => {
      const [row] = await tx
        .insert(aiInvocations)
        .values({
          branchId: BRANCH,
          principalId: actor.principalId,
          surface: 'enquiry_extract',
          modelRequested: 'test-model',
          promptVersion: 'test',
          inputHash: `aa-${RUN}`,
        })
        .returning({ id: aiInvocations.id })
      return row!.id
    })
  })

  it('applies confident proposals into empty columns and closes them', async () => {
    const id = await makeEnquiry()
    const candidates = await seed(id, [
      { field: 'incoterm', value: 'CIF', confidence: 0.95 },
      { field: 'pieces', value: '10', confidence: 0.95 },
      { field: 'mode', value: 'sea_fcl', confidence: 0.92 },
    ])

    const applied = await apply(id, candidates)

    expect(applied).toBe(3)
    const row = await enquiryRow(id)
    expect(row.incoterm).toBe('CIF')
    expect(row.pieces).toBe(10)
    expect(row.mode).toBe('sea_fcl')
    expect((await statuses(id)).every((p) => p.status === 'applied')).toBe(true)
  })

  it('leaves a proposal below the confidence ceiling in the queue', async () => {
    const id = await makeEnquiry()
    const candidates = await seed(id, [{ field: 'incoterm', value: 'FOB', confidence: 0.5 }])

    const applied = await apply(id, candidates, 0.9)

    expect(applied).toBe(0)
    expect((await enquiryRow(id)).incoterm).toBeNull()
    expect((await statuses(id))[0]!.status).toBe('proposed')
  })

  it('never overwrites a column a person already filled', async () => {
    const id = await makeEnquiry({ incoterm: 'DAP' })
    const candidates = await seed(id, [
      { field: 'incoterm', value: 'CIF', confidence: 0.99, wasEmpty: false },
    ])

    const applied = await apply(id, candidates)

    expect(applied).toBe(0)
    expect((await enquiryRow(id)).incoterm).toBe('DAP')
  })

  it('refuses an ambiguous port, leaving it for a person', async () => {
    const id = await makeEnquiry()
    const candidates = await seed(id, [
      { field: 'origin', value: 'Nowhereville-on-Sea', confidence: 0.99 },
      { field: 'pieces', value: '4', confidence: 0.95 },
    ])

    const applied = await apply(id, candidates)

    // Only the piece count — the unresolvable port stays proposed.
    expect(applied).toBe(1)
    const row = await enquiryRow(id)
    expect(row.originId).toBeNull()
    expect(row.pieces).toBe(4)
    const origin = (await statuses(id)).find((p) => p.field === 'origin')
    expect(origin?.status).toBe('proposed')
  })
})
