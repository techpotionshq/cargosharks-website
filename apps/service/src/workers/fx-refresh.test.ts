/**
 * The daily FX refresh.
 *
 * Nothing reads the feed at quote time: a charge line stores the rate it was
 * struck at and the moment it was taken, so this worker's whole job is to make
 * sure a fresh rate is *available*, never to answer a question while somebody
 * is waiting. That separation is what makes a slow or rate-limited provider a
 * monitoring problem rather than an outage — and it is also why nothing on a
 * screen goes red when this stops working.
 *
 * **Idempotent by the unique key, not by checking first.** `fx_rates_unique`
 * is (from, to, effective_on, source), so running twice in a day writes the
 * same row twice and the second is discarded. The rate for a day is therefore
 * the first one seen that day — deliberately, because an invoice raised at
 * 09:00 and reconciled against a rate that moved at 16:00 is exactly the
 * discrepancy this table exists to prevent.
 *
 * **One unknown currency must not lose a good batch.** `from_currency` and
 * `to_currency` are real foreign keys, so a feed answering with a code the
 * operator never configured would fail the whole insert. They are filtered and
 * reported instead, which keeps a broad feed from being a fragile one.
 *
 * **A deployment that bought no feed is not a failure.** `manual` answers
 * "nothing to do" rather than making the caller ask which mode it is in.
 */

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { and, eq } from 'drizzle-orm'
import type { Actor } from '@qabandi/db'

const APP_URL = process.env.TEST_DATABASE_URL
const enabled = Boolean(APP_URL)
if (APP_URL) process.env.DATABASE_URL = APP_URL

const harness = vi.hoisted(() => ({
  key: 'http',
  quotes: [] as { from: string; to: string; rate: string; source: string; effectiveOn: string }[],
  asked: [] as { base: string; quotes: readonly string[] }[],
  base: 'KWD',
  wanted: 'USD,EUR',
}))

vi.mock('../adapters/index', () => ({
  adapters: () => ({
    fx: {
      get key() {
        return harness.key
      },
      fetch: async (base: string, quotes: readonly string[]) => {
        harness.asked.push({ base, quotes })
        return harness.quotes
      },
    },
  }),
}))

vi.mock('../config', () => ({
  config: {
    get FX_BASE_CURRENCY() {
      return harness.base
    },
    get FX_QUOTE_CURRENCIES() {
      return harness.wanted
    },
  },
}))

const { fxRates, withActor } = await import('@qabandi/db')
const { runFxRefresh } = await import('./fx-refresh')

const actor: Actor = {
  principalId: '00000000-0000-7000-8000-0000000000a1',
  type: 'system',
  branchIds: [],
}

const RUN = Date.now().toString(36).toUpperCase().slice(-5)
let seq = 0

/** A distinct effective day per case, so one test cannot see another's row. */
const day = () => {
  seq += 1
  return new Date(Date.UTC(2040, 0, 1) + seq * 86_400_000).toISOString().slice(0, 10)
}

const quote = (to: string, rate: string, effectiveOn: string, from = 'KWD') => ({
  from,
  to,
  rate,
  source: `fx-test-${RUN}`,
  effectiveOn,
})

const stored = (effectiveOn: string) =>
  withActor(actor, (tx) =>
    tx
      .select({
        from: fxRates.fromCurrency,
        to: fxRates.toCurrency,
        rate: fxRates.rate,
        source: fxRates.source,
      })
      .from(fxRates)
      .where(and(eq(fxRates.effectiveOn, effectiveOn), eq(fxRates.source, `fx-test-${RUN}`))),
  )

describe.skipIf(!enabled)('the daily FX refresh', () => {
  beforeEach(() => {
    harness.key = 'http'
    harness.quotes = []
    harness.asked.length = 0
    harness.base = 'KWD'
    harness.wanted = 'USD,EUR'
  })

  afterAll(() => {
    vi.restoreAllMocks()
  })

  describe('a deployment that has bought no feed', () => {
    /** Not a failure and not worth a round trip. */
    it('answers nothing to do, without asking anybody', async () => {
      harness.key = 'manual'

      const result = await runFxRefresh()

      expect(result).toEqual({ source: 'manual', written: 0, skipped: [] })
      expect(harness.asked).toEqual([])
    })
  })

  describe('what it asks for', () => {
    it('asks the feed for the currencies this operator trades in', async () => {
      const on = day()
      harness.quotes = [quote('USD', '3.257', on), quote('EUR', '3.010', on)]

      await runFxRefresh()

      expect(harness.asked[0]?.base).toBe('KWD')
      expect(harness.asked[0]?.quotes).toEqual(['USD', 'EUR'])
    })

    /** A rate from a currency to itself is one, and asking for it is noise. */
    it('never asks for the base against itself', async () => {
      harness.wanted = 'USD,KWD,EUR'
      harness.quotes = []

      await runFxRefresh()

      expect(harness.asked[0]?.quotes).toEqual(['USD', 'EUR'])
    })

    it('reads a list however it was spaced or cased', async () => {
      harness.wanted = ' usd , eur ,, '
      harness.quotes = []

      await runFxRefresh()

      expect(harness.asked[0]?.quotes).toEqual(['USD', 'EUR'])
    })
  })

  describe('what it writes', () => {
    it('writes a dated row for each rate it was given', async () => {
      const on = day()
      harness.quotes = [quote('USD', '3.257000', on), quote('EUR', '3.010000', on)]

      const result = await runFxRefresh()

      expect(result.written).toBe(2)
      const rows = await stored(on)
      expect(rows.map((row) => row.to).sort()).toEqual(['EUR', 'USD'])
      expect(rows.every((row) => row.from === 'KWD')).toBe(true)
    })

    /**
     * The rate for a day is the first one seen that day. An invoice raised at
     * 09:00 and reconciled against a rate that moved at 16:00 is exactly the
     * discrepancy this table exists to prevent — so the second run of a day is
     * discarded by the unique key rather than by any bookkeeping here.
     */
    it('keeps the first rate of the day when it runs again', async () => {
      const on = day()
      harness.quotes = [quote('USD', '3.257000', on)]
      await runFxRefresh()

      harness.quotes = [quote('USD', '9.999000', on)]
      const second = await runFxRefresh()

      const rows = await stored(on)
      expect(rows).toHaveLength(1)
      expect(Number(rows[0]?.rate)).toBeCloseTo(3.257, 6)
      // It reports what it offered, not what the database accepted — the
      // insert is the thing that decides, and it did so silently.
      expect(second.written).toBe(1)
    })

    /**
     * One unknown code must not lose the batch. `from_currency` and
     * `to_currency` are real foreign keys, so an unfiltered insert would fail
     * whole and take every good rate with it.
     */
    it('keeps the rates it can use and names the ones it cannot', async () => {
      const on = day()
      harness.wanted = 'USD,XYZ'
      harness.quotes = [quote('USD', '3.257000', on), quote('XYZ', '1.000000', on)]

      const result = await runFxRefresh()

      expect(result.written).toBe(1)
      expect(result.skipped).toEqual(['XYZ'])
      expect((await stored(on)).map((row) => row.to)).toEqual(['USD'])
    })

    it('writes nothing, and says so, when every rate is unusable', async () => {
      const on = day()
      harness.wanted = 'XYZ'
      harness.quotes = [quote('XYZ', '1.000000', on)]

      const result = await runFxRefresh()

      expect(result.written).toBe(0)
      expect(result.skipped).toEqual(['XYZ'])
      expect(await stored(on)).toEqual([])
    })

    it('writes nothing when the feed had nothing to say', async () => {
      harness.quotes = []

      const result = await runFxRefresh()

      expect(result.written).toBe(0)
      expect(result.skipped).toEqual([])
    })

    it('names the driver that answered, for the boot log and the report', async () => {
      const on = day()
      harness.quotes = [quote('USD', '3.257000', on)]

      expect((await runFxRefresh()).source).toBe('http')
    })
  })

  describe('a base currency nobody seeded', () => {
    /**
     * Refused loudly rather than skipped. Every rate hangs off the base, so a
     * deployment that enabled the feed without seeding its own currency has a
     * configuration fault and should hear about it at the first run — not
     * accumulate a table of rows pointing at nothing.
     */
    it('refuses to run at all, and says what to fix', async () => {
      harness.base = 'XYZ'
      harness.wanted = 'USD'
      harness.quotes = [quote('USD', '1.000000', day(), 'XYZ')]

      await expect(runFxRefresh()).rejects.toThrow('FX_BASE_CURRENCY=XYZ')
    })
  })
})
