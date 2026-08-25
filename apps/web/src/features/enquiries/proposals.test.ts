/**
 * Turning what a model read into a fact on a shipment — `AI-05`, `AI-07`.
 *
 * This is the file where a wrong answer costs something real. Everything up to
 * here is a proposal sitting in a table nobody prices against; accepting one
 * writes a column that a quotation is then built on. So what is pinned below
 * is not that the happy path works — it is the four refusals:
 *
 *   - a place we do not hold is refused rather than guessed at;
 *   - a place matching **two** rows is refused just as firmly as none, because
 *     a confident tie-break is exactly how the wrong port gets written;
 *   - a column somebody has since filled is never overwritten;
 *   - a value that is not a valid mode, date or number is refused with what
 *     was expected, rather than landing as text in a typed column.
 *
 * The last one matters more than it looks. `value` is `text` in
 * `extraction_proposals` on purpose — a model is another producer of untrusted
 * rows — and this is the only place that text becomes typed.
 */

import { beforeAll, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'

const APP_URL = process.env.TEST_DATABASE_URL
const enabled = Boolean(APP_URL)
if (APP_URL) process.env.DATABASE_URL = APP_URL

const harness = vi.hoisted(() => ({ session: null as unknown }))

vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))
vi.mock('@/lib/session', () => ({ requireSession: async () => harness.session }))

const { aiInvocations, enquiries, extractionProposals, locations, withActor } =
  await import('@qabandi/db')

const { AWAY_BRANCH, CUSTOMER, HOME_BRANCH, ORIGIN, PRINCIPAL, bothBranchesActor, world } =
  await import('@/lib/testing/fixtures')

const { acceptProposal, rejectProposal } = await import('./form-actions')
const { enquiryProposals } = await import('./proposals')

const session = {
  actor: bothBranchesActor,
  principal: {
    id: PRINCIPAL,
    nameEn: 'Enquiry Desk',
    nameAr: null,
    email: 'enquiries@qabandi.test',
    locale: 'en' as const,
  },
  permissions: new Set(['enquiry.assign']),
  branchRoles: new Map([
    [HOME_BRANCH, 'sales'],
    [AWAY_BRANCH, 'sales'],
  ]),
  requiresTwoFactor: false,
}

const form = (fields: Record<string, string>): FormData => {
  const data = new FormData()
  for (const [key, value] of Object.entries(fields)) data.set(key, value)
  return data
}

describe.skipIf(!enabled)('accepting what a model read', () => {
  let invocationId: string

  beforeAll(async () => {
    await world()
    harness.session = session

    /*
      One invocation for the whole file. Proposals reference it, and the panel
      reads the model and prompt version off it — a proposal whose provenance
      cannot be named is one nobody can attribute a bad run to.
    */
    invocationId = await withActor(bothBranchesActor, async (tx) => {
      const [row] = await tx
        .insert(aiInvocations)
        .values({
          branchId: HOME_BRANCH,
          principalId: PRINCIPAL,
          surface: 'enquiry_extract',
          modelRequested: 'minimax/minimax-m3',
          modelServed: 'minimax/minimax-m3',
          promptVersion: 'enquiry-extract@1',
          inputHash: `test-${Math.random().toString(36).slice(2)}`,
        })
        .returning({ id: aiInvocations.id })
      return row!.id
    })
  })

  /** A fresh enquiry per case, so one accept cannot decide another's outcome. */
  async function anEnquiry(): Promise<string> {
    return withActor(bothBranchesActor, async (tx) => {
      const [row] = await tx
        .insert(enquiries)
        .values({
          branchId: HOME_BRANCH,
          customerId: CUSTOMER,
          reference: `PRP-${Math.random().toString(36).slice(2, 10).toUpperCase()}`,
          channel: 'email',
          status: 'new',
        })
        .returning({ id: enquiries.id })
      return row!.id
    })
  }

  async function aProposal(
    enquiryId: string,
    field: string,
    value: string,
    over: Record<string, unknown> = {},
  ): Promise<string> {
    return withActor(bothBranchesActor, async (tx) => {
      const [row] = await tx
        .insert(extractionProposals)
        .values({
          branchId: HOME_BRANCH,
          invocationId,
          targetTable: 'enquiries',
          targetId: enquiryId,
          field,
          value,
          confidence: '0.9000',
          evidence: 'from line 3',
          ...over,
        })
        .returning({ id: extractionProposals.id })
      return row!.id
    })
  }

  const readEnquiry = async (id: string) =>
    withActor(bothBranchesActor, async (tx) => {
      const [row] = await tx.select().from(enquiries).where(eq(enquiries.id, id)).limit(1)
      return row as Record<string, unknown> | undefined
    })

  const readProposal = async (id: string) =>
    withActor(bothBranchesActor, async (tx) => {
      const [row] = await tx
        .select({
          status: extractionProposals.status,
          decidedById: extractionProposals.decidedById,
        })
        .from(extractionProposals)
        .where(eq(extractionProposals.id, id))
        .limit(1)
      return row
    })

  it('writes the column and closes the proposal', async () => {
    const enquiryId = await anEnquiry()
    const proposalId = await aProposal(enquiryId, 'mode', 'sea_fcl')

    const state = await acceptProposal({}, form({ proposalId, enquiryId }))

    expect(state.message).toBeUndefined()
    expect((await readEnquiry(enquiryId))?.mode).toBe('sea_fcl')

    const settled = await readProposal(proposalId)
    expect(settled?.status).toBe('applied')
    // Under the coordinator's own actor — that is what the audit trail names.
    expect(settled?.decidedById).toBe(PRINCIPAL)
  })

  it('carries a quantity through as text, never as a float', async () => {
    const enquiryId = await anEnquiry()
    const proposalId = await aProposal(enquiryId, 'grossWeightKg', '18500.500')

    await acceptProposal({}, form({ proposalId, enquiryId }))

    // `numeric` comes back as a string, and the digits are the ones proposed.
    expect(String((await readEnquiry(enquiryId))?.grossWeightKg)).toMatch(/^18500\.5/)
  })

  it('resolves a place name to the location we hold', async () => {
    const enquiryId = await anEnquiry()
    const [place] = await withActor(bothBranchesActor, (tx) =>
      tx
        .select({ name: locations.nameEn })
        .from(locations)
        .where(eq(locations.id, ORIGIN))
        .limit(1),
    )
    const proposalId = await aProposal(enquiryId, 'origin', place!.name)

    const state = await acceptProposal({}, form({ proposalId, enquiryId }))

    expect(state.message).toBeUndefined()
    expect((await readEnquiry(enquiryId))?.originId).toBe(ORIGIN)
  })

  /**
   * A place we do not hold is refused, and the sentence says what to do.
   *
   * The alternative — creating the location — would let an emailed enquiry
   * write rows into the reference data every screen in the product picks from.
   */
  it('refuses a place that is not on file', async () => {
    const enquiryId = await anEnquiry()
    const proposalId = await aProposal(enquiryId, 'origin', 'Port of Nowhere')

    const state = await acceptProposal({}, form({ proposalId, enquiryId }))

    expect(state.message).toMatch(/not a place or commodity on file/)
    expect((await readEnquiry(enquiryId))?.originId).toBeNull()
    expect((await readProposal(proposalId))?.status).toBe('proposed')
  })

  /**
   * Two matches is no match — the rule `inbound-routing.ts` makes for
   * attribution, for the same reason: a confident tie-break is how the wrong
   * row gets written, and it is invisible afterwards.
   */
  it('refuses a name that matches two places rather than picking one', async () => {
    const enquiryId = await anEnquiry()
    const ambiguous = `Twin Port ${Math.random().toString(36).slice(2, 8)}`

    await withActor(bothBranchesActor, async (tx) => {
      await tx.insert(locations).values([
        { kind: 'seaport', nameEn: ambiguous, countryCode: 'KW', unlocode: null },
        { kind: 'inland', nameEn: ambiguous, countryCode: 'KW', unlocode: null },
      ])
    })

    const proposalId = await aProposal(enquiryId, 'destination', ambiguous)
    const state = await acceptProposal({}, form({ proposalId, enquiryId }))

    expect(state.message).toMatch(/matches 2 records/)
    expect((await readEnquiry(enquiryId))?.destinationId).toBeNull()
  })

  /**
   * A person's answer wins, and it wins at the moment of the accept.
   *
   * `target_was_empty` records what was true when the model was asked;
   * `decideProposal` is re-run here against the row as it is *now*, because a
   * coordinator may have typed the value in between.
   */
  it('refuses to overwrite a column somebody has filled since', async () => {
    const enquiryId = await anEnquiry()
    const proposalId = await aProposal(enquiryId, 'incoterm', 'FOB')

    await withActor(bothBranchesActor, async (tx) => {
      await tx.update(enquiries).set({ incoterm: 'CIF' }).where(eq(enquiries.id, enquiryId))
    })

    const state = await acceptProposal({}, form({ proposalId, enquiryId }))

    expect(state.message).toMatch(/filled in since/)
    expect((await readEnquiry(enquiryId))?.incoterm).toBe('CIF')
  })

  it('refuses a value that is not one of the modes, and says what it expected', async () => {
    const enquiryId = await anEnquiry()
    const proposalId = await aProposal(enquiryId, 'mode', 'hovercraft')

    const state = await acceptProposal({}, form({ proposalId, enquiryId }))

    expect(state.message).toMatch(/sea_fcl/)
    expect((await readEnquiry(enquiryId))?.mode).toBeNull()
  })

  it('refuses a ready date that is not a date', async () => {
    const enquiryId = await anEnquiry()
    const proposalId = await aProposal(enquiryId, 'readyOn', 'next Tuesday')

    const state = await acceptProposal({}, form({ proposalId, enquiryId }))

    expect(state.message).toMatch(/YYYY-MM-DD/)
    expect((await readEnquiry(enquiryId))?.readyOn).toBeNull()
  })

  /**
   * Dismissing records a decision. Nothing is deleted (§5.5), and a rejected
   * proposal is the most useful row in the table — it is the evaluation set.
   */
  it('records a dismissal rather than removing it', async () => {
    const enquiryId = await anEnquiry()
    const proposalId = await aProposal(enquiryId, 'pieces', '240')

    await rejectProposal({}, form({ proposalId, enquiryId }))

    const settled = await readProposal(proposalId)
    expect(settled?.status).toBe('rejected')
    expect(settled?.decidedById).toBe(PRINCIPAL)
    expect((await readEnquiry(enquiryId))?.pieces).toBeNull()
  })

  it('shows only what is still open, with its evidence', async () => {
    const enquiryId = await anEnquiry()
    const open = await aProposal(enquiryId, 'volumeCbm', '54')
    const dismissed = await aProposal(enquiryId, 'dimensions', '120x80x100')
    await rejectProposal({}, form({ proposalId: dismissed, enquiryId }))

    const rows = await enquiryProposals(bothBranchesActor, enquiryId)

    expect(rows.map((r) => r.id)).toEqual([open])
    expect(rows[0]?.evidence).toBe('from line 3')
    expect(rows[0]?.promptVersion).toBe('enquiry-extract@1')
  })

  /** A settled proposal cannot be applied twice — the second click says so. */
  it('refuses a proposal somebody has already decided', async () => {
    const enquiryId = await anEnquiry()
    const proposalId = await aProposal(enquiryId, 'mode', 'air')
    await acceptProposal({}, form({ proposalId, enquiryId }))

    const again = await acceptProposal({}, form({ proposalId, enquiryId }))

    expect(again.message).toMatch(/already decided/)
  })
})
