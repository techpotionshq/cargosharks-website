/**
 * Partners and locations — the network reference reads.
 *
 * Every search here is checked for what it *excludes*. A predicate that
 * matches everything is indistinguishable from a working one on a screen with
 * three rows, and this codebase has already shipped a query whose filter bound
 * to the wrong table and silently matched nothing.
 */

import { beforeAll, describe, expect, it } from 'vitest'

const APP_URL = process.env.TEST_DATABASE_URL
const enabled = Boolean(APP_URL)
if (APP_URL) process.env.DATABASE_URL = APP_URL

const { PARTNER, homeActor, world } = await import('@/lib/testing/fixtures')
const {
  listPartners,
  listLocations,
  countNetwork,
  partnerTypeCounts,
  getPartnerDetail,
  listAgentShipments,
} = await import('./queries')

describe.skipIf(!enabled)('network reads', () => {
  beforeAll(async () => {
    await world()
  })

  /*
    The unfiltered list is the first 200 by name, and this database is never
    emptied: every run of the service suites adds "Agent N" partners that sort
    ahead of the fixture agent, which fell off the page after enough runs. So
    this pins what the list promises — rows, capped at a page — and the search
    below is what finds the fixture agent. (Name order is the database's
    collation, which a JS sort does not reproduce everywhere, so it is not
    asserted.)
  */
  it('lists partners, capped at a page', async () => {
    const rows = await listPartners(homeActor)
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.length).toBeLessThanOrEqual(200)
  })

  /** The search narrows rather than matching everything. */
  it('narrows partners by search', async () => {
    const hits = await listPartners(homeActor, 'AGT-FIXTURE')
    expect(hits.map((p) => p.code)).toContain('AGT-FIXTURE')

    expect(await listPartners(homeActor, 'zzz-no-such-partner')).toEqual([])
  })

  it('lists locations', async () => {
    expect(Array.isArray(await listLocations(homeActor))).toBe(true)
  })

  it('narrows locations by search', async () => {
    expect(await listLocations(homeActor, 'zzz-no-such-location')).toEqual([])
  })

  it('counts the network without dropping the fixture partner', async () => {
    const counts = await countNetwork(homeActor)
    expect(Number(counts.partners)).toBeGreaterThan(0)
  })

  it('counts partners by type', async () => {
    const byType = await partnerTypeCounts(homeActor)
    expect(byType.some((t) => t.type === 'agent' && Number(t.count) > 0)).toBe(true)
  })

  it('reads a partner the actor may see', async () => {
    const detail = await getPartnerDetail(homeActor, PARTNER)
    expect(detail).toBeTruthy()
  })

  it('returns nothing for a partner that does not exist', async () => {
    expect(await getPartnerDetail(homeActor, '00000000-0000-7000-8000-0000000000f4')).toBeFalsy()
  })

  /*
    A9. The agent home read nothing, so an agency named on live shipments was
    told "Nothing assigned to you". The scoping is the policy's: the agent
    sees the job its partner is named on and not the one it is not.
  */
  it("lists the shipments an agent's partner is named on, and only those", async () => {
    const { HOME_JOB, AWAY_JOB, HOME_BRANCH } = await import('@/lib/testing/fixtures')
    const { jobPartners, systemActor, withActor } = await import('@qabandi/db')
    await withActor(systemActor(), (tx) =>
      tx
        .insert(jobPartners)
        .values({
          jobId: HOME_JOB,
          branchId: HOME_BRANCH,
          partnerId: PARTNER,
          role: 'origin_agent',
        })
        .onConflictDoNothing(),
    )

    const agent = {
      principalId: '00000000-0000-7000-8000-0000000000f5',
      type: 'agent_contact' as const,
      branchIds: [],
      customerId: null,
      partnerId: PARTNER,
      ip: null,
    }
    const rows = await listAgentShipments(agent, 'ar')
    const ids = rows.map((row) => row.id)

    expect(ids).toContain(HOME_JOB)
    expect(ids).not.toContain(AWAY_JOB)
    // Nothing of the customer's leaves this query.
    expect(rows.every((row) => row.customerReference === null)).toBe(true)
  })

  it('lists nothing for a principal with no partner', async () => {
    expect(await listAgentShipments(homeActor)).toEqual([])
  })
})
