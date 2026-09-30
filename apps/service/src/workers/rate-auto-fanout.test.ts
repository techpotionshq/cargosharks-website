/**
 * Automatic rate procurement — FR-RT-10, against a real database.
 *
 * The worker opens the same `rate_requests` rows the enquiry screen's picker
 * does, so the value worth pinning is not the insert but the four gates around
 * it: it is off unless the integration says `auto`; it asks only where the lane
 * is complete; it asks each covering agent once; and it asks only agents with an
 * email. Each of those is a `where` or a driver check, which is exactly what a
 * mocked test cannot see — so this runs the real worker and skips without a
 * database, the same contract as the other worker suites.
 *
 * The gate is toggled through `RATE_AUTOFANOUT_DRIVER`: the test database holds
 * no `integration_settings` row for the key, so the resolver reads the variable
 * live on every call (settings.ts `envOnly`), and setting or clearing it per
 * test is enough to switch the feature on and off.
 */

import { beforeAll, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import type { LiveIntegration } from '../settings'

const APP_URL = process.env.TEST_DATABASE_URL
const enabled = Boolean(APP_URL)
if (APP_URL) process.env.DATABASE_URL = APP_URL

/**
 * The resolved gate, injected — the real one is read through a thirty-second
 * cache that is deliberately un-clearable, so a test cannot switch the driver on
 * and off through the environment within one run.
 */
const gate = (driver: string, maxAgents?: number): LiveIntegration => ({
  key: 'rateAutoFanout',
  driver,
  live: driver === 'auto',
  missing: [],
  fromRow: false,
  text: () => undefined,
  number: (_name, fallback) => maxAgents ?? fallback,
  bool: (_name, fallback) => fallback,
  secret: () => undefined,
})

const {
  branches,
  enquiries,
  locations,
  partnerContacts,
  partnerCoverage,
  partners,
  rateRequests,
  systemActor,
  withActor,
  workingCalendars,
} = await import('@qabandi/db')

const { autoFanoutRateRequests } = await import('./rate-auto-fanout')

const BRANCH = '00000000-0000-7000-8000-0000000000e1'
const ORIGIN = '00000000-0000-7000-8000-0000000000e2'
const DEST_A = '00000000-0000-7000-8000-0000000000e3'
const DEST_B = '00000000-0000-7000-8000-0000000000e4'
const AGENT_A = '00000000-0000-7000-8000-0000000000e5' // covers lane A, has email
const AGENT_B = '00000000-0000-7000-8000-0000000000e6' // covers lane B, no contact

const actor = systemActor()
const RUN = Date.now().toString(36).toUpperCase().slice(-5)
let seq = 0

/** A fresh enquiry, so each test starts with one nobody has asked about. */
async function makeEnquiry(fields: {
  mode?: 'sea_fcl' | null
  originId?: string | null
  destinationId?: string | null
  status?: 'new' | 'assigned' | 'rating' | 'quoted'
}): Promise<string> {
  seq += 1
  return withActor(actor, async (tx) => {
    const [row] = await tx
      .insert(enquiries)
      .values({
        reference: `FAN-${RUN}-${seq}`,
        branchId: BRANCH,
        status: fields.status ?? 'rating',
        channel: 'email',
        mode: fields.mode === undefined ? 'sea_fcl' : fields.mode,
        originId: fields.originId === undefined ? ORIGIN : fields.originId,
        destinationId: fields.destinationId === undefined ? DEST_A : fields.destinationId,
      })
      .returning({ id: enquiries.id })
    return row!.id
  })
}

const requestsFor = (enquiryId: string) =>
  withActor(actor, (tx) =>
    tx
      .select({
        partnerId: rateRequests.partnerId,
        status: rateRequests.status,
        token: rateRequests.token,
      })
      .from(rateRequests)
      .where(eq(rateRequests.enquiryId, enquiryId)),
  )

describe.skipIf(!enabled)('autoFanoutRateRequests', () => {
  beforeAll(async () => {
    const [calendar] = await withActor(actor, (tx) =>
      tx
        .select({ id: workingCalendars.id })
        .from(workingCalendars)
        .where(eq(workingCalendars.key, 'kuwait'))
        .limit(1),
    )
    if (!calendar) throw new Error('Run `pnpm db:seed` before the auto-fanout tests')

    await withActor(actor, async (tx) => {
      await tx
        .insert(branches)
        .values({
          id: BRANCH,
          code: 'FAN',
          legalNameEn: 'Fanout Test Branch',
          legalNameAr: 'فرع',
          country: 'KW',
          baseCurrency: 'KWD',
          invoiceSeries: 'FAN',
          calendarId: calendar.id,
        })
        .onConflictDoNothing()

      await tx
        .insert(locations)
        .values([
          {
            id: ORIGIN,
            kind: 'seaport',
            unlocode: 'ZZFN1',
            nameEn: 'Fanout Origin',
            nameAr: 'أ',
            countryCode: 'KW',
          },
          {
            id: DEST_A,
            kind: 'seaport',
            unlocode: 'ZZFN2',
            nameEn: 'Fanout Dest A',
            nameAr: 'ب',
            countryCode: 'CN',
          },
          {
            id: DEST_B,
            kind: 'seaport',
            unlocode: 'ZZFN3',
            nameEn: 'Fanout Dest B',
            nameAr: 'ج',
            countryCode: 'AE',
          },
        ])
        .onConflictDoNothing()

      await tx
        .insert(partners)
        .values([
          { id: AGENT_A, code: 'AGT-FAN-A', type: 'agent', legalNameEn: 'Fanout Agent A' },
          { id: AGENT_B, code: 'AGT-FAN-B', type: 'agent', legalNameEn: 'Fanout Agent B' },
        ])
        .onConflictDoNothing()

      await tx
        .insert(partnerCoverage)
        .values([
          {
            partnerId: AGENT_A,
            mode: 'sea_fcl',
            originId: ORIGIN,
            destinationId: DEST_A,
            isActive: true,
          },
          {
            partnerId: AGENT_B,
            mode: 'sea_fcl',
            originId: ORIGIN,
            destinationId: DEST_B,
            isActive: true,
          },
        ])
        .onConflictDoNothing()

      // Only agent A has a contact; agent B is covered but unreachable.
      await tx
        .insert(partnerContacts)
        .values({
          partnerId: AGENT_A,
          nameEn: 'Desk A',
          email: 'agent-a@fanout.test',
          isPrimary: true,
          isActive: true,
        })
        .onConflictDoNothing()
    })
  })

  it('opens an RFQ to a covering agent when switched on', async () => {
    const id = await makeEnquiry({})

    const result = await autoFanoutRateRequests({ source: gate('auto') })

    expect(result.enabled).toBe(true)
    const rows = await requestsFor(id)
    expect(rows).toHaveLength(1)
    expect(rows[0]!.partnerId).toBe(AGENT_A)
    expect(rows[0]!.status).toBe('sent')
    expect(rows[0]!.token).toMatch(/^[a-f0-9]{24}$/)
  })

  it('does nothing at all on its inert default', async () => {
    const id = await makeEnquiry({})

    const result = await autoFanoutRateRequests({ source: gate('manual') })

    expect(result.enabled).toBe(false)
    expect(await requestsFor(id)).toEqual([])
  })

  it('leaves an enquiry whose lane is not resolved yet', async () => {
    const id = await makeEnquiry({ destinationId: null })

    await autoFanoutRateRequests({ source: gate('auto') })

    expect(await requestsFor(id)).toEqual([])
  })

  it('does not ask an agent already on the enquiry', async () => {
    const id = await makeEnquiry({})
    // A request already exists — the loop-breaker must leave the enquiry alone.
    await withActor(actor, (tx) =>
      tx.insert(rateRequests).values({
        branchId: BRANCH,
        enquiryId: id,
        partnerId: AGENT_A,
        status: 'sent',
        token: `preexisting-${RUN}-${seq}`,
      }),
    )

    await autoFanoutRateRequests({ source: gate('auto') })

    // Still exactly the one that was there — nothing added.
    const rows = await requestsFor(id)
    expect(rows).toHaveLength(1)
    expect(rows[0]!.token).toBe(`preexisting-${RUN}-${seq}`)
  })

  it('does not ask a covering agent that has no email', async () => {
    // Lane B is covered only by agent B, who has no contact.
    const id = await makeEnquiry({ destinationId: DEST_B })

    const result = await autoFanoutRateRequests({ source: gate('auto') })

    expect(result.enabled).toBe(true)
    expect(await requestsFor(id)).toEqual([])
  })
})
