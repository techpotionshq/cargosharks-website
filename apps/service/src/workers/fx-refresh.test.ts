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
 *
 * **Nothing about what to fetch is configured.** The quote currencies are
 * `currencies.is_tracked`; the base currencies are the distinct
 * `branches.base_currency` of the active entities. Both were environment
 * variables sitting beside columns that already answered the same question,
 * and `FX_BASE_CURRENCY` was worse than redundant — one deployment-wide value
 * meant a Dubai entity invoicing in AED had no rates fetched at all. So the
 * cases below write to those columns, and the tests that used to check how a
 * comma-separated string was parsed are gone with the string.
 */

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { and, eq, inArray } from 'drizzle-orm'
import type { Actor } from '@qabandi/db'

const APP_URL = process.env.TEST_DATABASE_URL
const enabled = Boolean(APP_URL)
if (APP_URL) process.env.DATABASE_URL = APP_URL

const harness = vi.hoisted(() => ({
  key: 'http',
  quotes: [] as { from: string; to: string; rate: string; source: string; effectiveOn: string }[],
  asked: [] as { base: string; quotes: readonly string[] }[],
}))

vi.mock('../adapters/index', () => ({
  fxSource: async () => ({
    get key() {
      return harness.key
    },
    fetch: async (base: string, quotes: readonly string[]) => {
      harness.asked.push({ base, quotes })
      /*
        Answer only for the base actually asked about.

        The worker calls once per distinct branch base currency, and the
        fixtures carry two (KWD and AED). A feed that returned the same rows to
        both would double every count below and hide which base a rate came
        from — which is the one thing these cases are now about.
      */
      return harness.quotes.filter((q) => q.from === base)
    },
  }),
}))

const { currencies, fxRates, withActor } = await import('@qabandi/db')
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

/** The call the worker made for one base, or undefined if it made none. */
const askedFor = (base: string) => harness.asked.find((call) => call.base === base)

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

/**
 * Mark exactly these currencies as tracked, and nothing else.
 *
 * The list used to be a string this test could set on a mock. It is a column
 * now, so the fixture has to write to the table — and it writes the *whole*
 * state rather than only the codes it wants, because a row left tracked by an
 * earlier case is a currency the feed is asked for in a later one, which is
 * the flakiest possible shape for a test to have.
 */
const track = async (codes: readonly string[]) =>
  withActor(actor, async (tx) => {
    await tx.update(currencies).set({ isTracked: false }).where(eq(currencies.isTracked, true))
    if (codes.length > 0) {
      await tx
        .update(currencies)
        .set({ isTracked: true })
        .where(inArray(currencies.code, [...codes]))
    }
  })

describe.skipIf(!enabled)('the daily FX refresh', () => {
  beforeEach(async () => {
    harness.key = 'http'
    harness.quotes = []
    harness.asked.length = 0
    await track(['USD', 'EUR'])
  })

  afterAll(async () => {
    /*
      Put the deployment default back.

      `0029` backfills these ten, and a suite that left the table with two
      tracked currencies would silently narrow what the next developer's local
      database fetches — a change to seeded data made by a test run, which is
      the kind of thing nobody thinks to look for.
    */
    if (enabled) {
      await track(['USD', 'AED', 'EUR', 'GBP', 'SAR', 'QAR', 'BHD', 'OMR', 'INR', 'CNY'])
    }
    vi.restoreAllMocks()
  })

  describe('a deployment that has bought no feed', () => {
    /** Not a failure and not worth a round trip. */
    it('answers nothing to do, without asking anybody', async () => {
      harness.key = 'manual'

      const result = await runFxRefresh()

      expect(result).toEqual({ source: 'manual', written: 0, skipped: [], bases: [] })
      expect(harness.asked).toEqual([])
    })
  })

  describe('what it asks for', () => {
    it('asks the feed for the currencies this operator trades in', async () => {
      const on = day()
      harness.quotes = [quote('USD', '3.257', on), quote('EUR', '3.010', on)]

      await runFxRefresh()

      // Sorted: the order is the table's, and asserting on it would be a test
      // of the row order rather than of what was asked for.
      expect([...(askedFor('KWD')?.quotes ?? [])].sort()).toEqual(['EUR', 'USD'])
    })

    /**
     * The whole point of moving the list onto the table.
     *
     * A currency an administrator marks tracked is fetched on the next run,
     * with no deployment in between — which is what `FX_QUOTE_CURRENCIES`
     * could not do, and why a currency added on the reference screen used to
     * be invisible to the feed until somebody edited a variable.
     */
    it('picks up a currency the moment it is marked tracked', async () => {
      await track(['USD'])
      harness.quotes = []
      await runFxRefresh()
      expect([...(askedFor('KWD')?.quotes ?? [])]).toEqual(['USD'])

      await track(['USD', 'GBP'])
      harness.asked.length = 0
      await runFxRefresh()
      expect([...(askedFor('KWD')?.quotes ?? [])].sort()).toEqual(['GBP', 'USD'])
    })

    /** Nothing tracked is not a failure, and not worth a round trip either. */
    it('asks nobody anything when no currency is tracked', async () => {
      await track([])

      const result = await runFxRefresh()

      expect(result.written).toBe(0)
      expect(harness.asked).toEqual([])
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
      // `XYZ` is not a currency row, so it cannot be tracked — which is the
      // point: the feed can still answer with it, and the filter is what stops
      // one unknown code failing the whole insert on the foreign key.
      await track(['USD'])
      harness.quotes = [quote('USD', '3.257000', on), quote('XYZ', '1.000000', on)]

      const result = await runFxRefresh()

      expect(result.written).toBe(1)
      expect(result.skipped).toEqual(['XYZ'])
      expect((await stored(on)).map((row) => row.to)).toEqual(['USD'])
    })

    it('writes nothing, and says so, when every rate is unusable', async () => {
      const on = day()
      await track(['USD'])
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

  describe('which bases it asks about', () => {
    /*
      Two entities on two currencies is the normal shape, not an edge case.

      This is the case `FX_BASE_CURRENCY` got wrong: one deployment-wide value
      meant whichever entity did not hold it was never quoted, silently.
    */
    it('asks once per distinct branch base currency', async () => {
      harness.quotes = []

      await runFxRefresh()

      const bases = harness.asked.map((a) => a.base).sort()
      expect(bases).toEqual([...new Set(bases)])
      expect(bases).toContain('KWD')
      // The seeded fixtures carry a Dubai entity on AED.
      expect(bases).toContain('AED')
    })

    /** A rate from a currency to itself is one, and asking for it is noise. */
    it('never asks a base for itself', async () => {
      await track(['USD', 'KWD', 'AED'])
      harness.quotes = []

      await runFxRefresh()

      for (const call of harness.asked) {
        expect(call.quotes).not.toContain(call.base)
      }
    })

    /*
      The guard against a base that is not a currency row is deliberately not
      exercised here.

      `branches.base_currency` is not a foreign key, so the filter in the
      worker is real and worth having — a typo there would otherwise be asked
      of the feed and then written into `fx_rates`, which *is* a foreign key,
      failing every good rate in the batch. Proving it needs a branch with a
      bad base, and this suite runs against a shared database where a branch
      cannot be un-inserted (§5.5) and would be visible to every other test
      while it existed. The cost of the proof exceeds the value of it.
    */
  })
})
