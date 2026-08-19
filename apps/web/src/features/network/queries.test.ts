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
const { listPartners, listLocations, countNetwork, partnerTypeCounts, getPartnerDetail } =
  await import('./queries')

describe.skipIf(!enabled)('network reads', () => {
  beforeAll(async () => {
    await world()
  })

  it('lists partners and finds the fixture agent', async () => {
    const codes = (await listPartners(homeActor)).map((p) => p.code)
    expect(codes).toContain('AGT-FIXTURE')
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
})
