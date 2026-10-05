/**
 * The hosted demo's records wear the deployment's brand — no database.
 *
 * The fixtures named Al-Qabandi's two companies as the branches, put every
 * user and mailbox on alqabandi.com, sent mail as "Al-Qabandi Freight", kept
 * documents in a `qabandi-documents` bucket and numbered house bills `AQP…`,
 * on every brand. The CargoSharks demo showed all of it. Each brand is loaded
 * fresh here, because the fixtures resolve the brand once, at import.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'

const saved = process.env.BRAND

afterEach(() => {
  if (saved === undefined) delete process.env.BRAND
  else process.env.BRAND = saved
  vi.resetModules()
})

async function fixturesFor(brand: string) {
  process.env.BRAND = brand
  vi.resetModules()
  return import('./fixtures')
}

const NOW = Date.parse('2026-10-05T09:00:00Z')

describe("the demo's operator identity", () => {
  it('is CargoSharks throughout on the CargoSharks brand', async () => {
    const f = await fixturesFor('cargosharks')
    const job = f.pilotJobs(NOW)[0]!
    const shown = JSON.stringify([
      f.pilotBranches(),
      f.pilotUsers(NOW),
      f.pilotIntegrationSettings(NOW),
      f.pilotWebhookEndpoints(NOW),
      f.pilotJob(job.id, NOW),
    ])

    expect(shown).not.toMatch(/qabandi|القبندي|AQP/i)
    expect(f.pilotBranches().map((row) => row.legalNameEn)).toEqual([
      'CargoSharks Freight Technologies',
      'CargoSharks Logistics FZE',
    ])
    expect(f.pilotUsers(NOW).every((row) => row.email.endsWith('@cargosharks.com'))).toBe(true)
    expect(f.pilotJob(job.id, NOW)?.houseBillNumber).toMatch(/^CSF/)
  })

  it('reads exactly as it always did on the Al-Qabandi brand', async () => {
    const f = await fixturesFor('qabandi')
    const job = f.pilotJobs(NOW)[0]!

    expect(f.pilotBranches().map((row) => row.legalNameEn)).toEqual([
      'Al-Qabandi Freight Services W.L.L.',
      'Al-Qabandi Logistics FZE',
    ])
    expect(f.pilotBranches()[0]!.mailFrom).toBe('kwi@alqabandi.com')
    expect(f.pilotJob(job.id, NOW)?.houseBillNumber).toMatch(/^AQP/)
  })
})
