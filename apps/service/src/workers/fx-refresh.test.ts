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

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { and, eq, inArray, lte } from 'drizzle-orm'
import type { Actor } from '@qabandi/db'

const APP_URL = process.env.TEST_DATABASE_URL
const enabled = Boolean(APP_URL)
if (APP_URL) process.env.DATABASE_URL = APP_URL

const harness = vi.hoisted(() => ({
  /** When set, the source the worker is handed — the real resilient driver on a fake fetch. */
  real: null as unknown,
  key: 'http',
  quotes: [] as { from: string; to: string; rate: string; source: string; effectiveOn: string }[],
  asked: [] as { base: string; quotes: readonly string[] }[],
}))

vi.mock('../adapters/index', () => ({
  fxSource: async () =>
    harness.real ?? {
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
    },
}))

const { branches, currencies, fxFeedStatus, fxRateOrder, fxRates, withActor, workingCalendars } =
  await import('@qabandi/db')
const { runFxRefresh: refresh } = await import('./fx-refresh')
const { resilientFxSource } = await import('../adapters/fx')

/*
  A fixed business day, far from any real one. The worker skips a base whose
  rows for *today* already exist, and on a database where the live feed has
  run that would be every base — so the cases name their own today.
*/
const TODAY = '2000-12-31'
const runFxRefresh = () => refresh({ today: TODAY })

const actor: Actor = {
  principalId: '00000000-0000-7000-8000-0000000000a1',
  type: 'system',
  branchIds: [],
}

const RUN = Date.now().toString(36).toUpperCase().slice(-5)
let seq = 0

/** A distinct effective day per case, so one test cannot see another's row. */
/*
  Dates in the past, on purpose. The refresh now writes each rate both ways, so
  these rows include USD → KWD — and dated in 2040 they became the "latest"
  rate for every other suite that converts USD (the rate-reply comparison read
  0.307031 instead of its own 0.308). Every assertion here is by exact date, so
  the year does not matter to this file; a past one keeps it out of others'.
*/
const day = () => {
  seq += 1
  return new Date(Date.UTC(2000, 0, 1) + seq * 86_400_000).toISOString().slice(0, 10)
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
  /*
    The two base currencies this suite is about — Kuwait on KWD, Dubai on AED.
    They used to come from `db:seed-demo`'s entities, so the suite passed only
    where that dataset had been loaded; against a plain `db:seed` there was no
    AED branch and "asks about AED" failed. Owned here now, so the suite stands
    up its own world.
  */
  beforeAll(async () => {
    const [calendar] = await withActor(actor, (tx) =>
      tx
        .select({ id: workingCalendars.id })
        .from(workingCalendars)
        .where(eq(workingCalendars.key, 'kuwait'))
        .limit(1),
    )
    if (!calendar) return
    await withActor(actor, (tx) =>
      tx
        .insert(branches)
        .values([
          {
            id: '00000000-0000-7000-8000-0000000000fa',
            code: 'FXK',
            legalNameEn: 'FX Kuwait',
            legalNameAr: 'إف إكس الكويت',
            country: 'KW',
            baseCurrency: 'KWD',
            invoiceSeries: 'FXK',
            calendarId: calendar.id,
          },
          {
            id: '00000000-0000-7000-8000-0000000000fb',
            code: 'FXD',
            legalNameEn: 'FX Dubai',
            legalNameAr: 'إف إكس دبي',
            country: 'AE',
            baseCurrency: 'AED',
            invoiceSeries: 'FXD',
            calendarId: calendar.id,
          },
        ])
        .onConflictDoNothing(),
    )
  })

  beforeEach(async () => {
    harness.real = null
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

      // Two quotes, each stored both ways — what was inserted, not what was offered.
      expect(result.written).toBe(4)
      const rows = await stored(on)
      const outward = rows.filter((row) => row.from === 'KWD')
      expect(outward.map((row) => row.to).sort()).toEqual(['EUR', 'USD'])
    })

    /*
      The direction every reader asks for. Pricing, the rate-reply comparison
      and the auto-promote sweep look up `to_currency = base` — "1 USD = ? KWD"
      — and with only the feed's outward row they found nothing, so a USD rate
      card refused to price once the feed was switched on. The reciprocal is
      exact decimal arithmetic at the column's fourteen places.
    */
    it('also writes each rate into the base, as pricing reads it', async () => {
      const on = day()
      harness.quotes = [quote('USD', '3.257000', on), quote('EUR', '3.010000', on)]

      await runFxRefresh()

      const inward = (await stored(on)).filter((row) => row.to === 'KWD')
      expect(inward.map((row) => [row.from, row.rate]).sort()).toEqual([
        ['EUR', '0.33222591362126'],
        ['USD', '0.30703101013202'],
      ])
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

      const rows = (await stored(on)).filter((row) => row.from === 'KWD')
      expect(rows).toHaveLength(1)
      expect(Number(rows[0]?.rate)).toBeCloseTo(3.257, 6)
      // It reports what the database accepted — nothing, on a same-day re-run.
      expect(second.written).toBe(0)
    })

    /*
      A weak currency's reciprocal is a small number. At eight places INR→KWD
      (~0.0037) kept six significant figures; the column now keeps fourteen
      places, and the stored rate is the reciprocal to all of them.
    */
    it('keeps the reciprocal of a weak currency to more than six figures', async () => {
      const on = day()
      await track(['INR'])
      harness.quotes = [quote('INR', '270.500000', on)]

      await runFxRefresh()

      const [inward] = (await stored(on)).filter((row) => row.to === 'KWD')
      expect(inward?.rate).toBe('0.00369685767098')
    })

    /*
      Two bases, one pair. The KWD feed's KWD→AED quote implies AED→KWD, and
      the AED feed quotes AED→KWD itself; both land on one unique key. The
      quote somebody actually published wins over the arithmetic.
    */
    it('prefers a direct quote over a reciprocal of the same pair', async () => {
      const on = day()
      await track(['AED', 'KWD'])
      harness.quotes = [quote('AED', '11.950000', on), quote('KWD', '0.083700', on, 'AED')]

      await runFxRefresh()

      // Both directions are the published quotes, whichever base was fetched first.
      const rows = await stored(on)
      const pair = (from: string, to: string) =>
        rows.filter((row) => row.from === from && row.to === to).map((row) => Number(row.rate))
      expect(pair('AED', 'KWD')).toEqual([0.0837])
      expect(pair('KWD', 'AED')).toEqual([11.95])
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

      expect(result.written).toBe(2)
      expect(result.skipped).toEqual(['XYZ'])
      expect((await stored(on)).filter((row) => row.from === 'KWD').map((row) => row.to)).toEqual([
        'USD',
      ])
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

  /*
    The resilient driver end to end: real adapter code, a fake fetch, a real
    database. Dated in 2001 by the providers' own bodies, so no row here is
    ever the "latest" rate another suite converts at.
  */
  describe('with the resilient driver', () => {
    /*
      A block of provider days of its own per run, between 2001 and 2003: a
      re-run on the same database must not find the last run's rows on its
      days, or "writes both directions" would see nothing to write. Thirty-day
      blocks keep one run's history out of the next's move-guard window, and
      the years keep every row older than any rate another suite converts at.
    */
    let providerDay = (parseInt(RUN, 36) % 30) * 30
    const nextDay = () => {
      providerDay += 1
      return new Date(Date.UTC(2001, 0, 1) + providerDay * 86_400_000).toISOString().slice(0, 10)
    }

    /** Both providers answering for KWD and AED on `on`, with optional overrides. */
    function answering(
      on: string,
      { kwdUsd = '3.234366', eur = '2.781', primaryDown = false } = {},
    ) {
      const stamp = new Date(`${on}T00:02:31Z`).toUTCString()
      const usdPerKwd = Number(kwdUsd)
      const bodies: Record<string, string> = {
        'https://open.er-api.com/v6/latest/KWD': JSON.stringify({
          result: 'success',
          base_code: 'KWD',
          time_last_update_utc: stamp,
          rates: { KWD: 1, USD: kwdUsd, EUR: eur, AED: String(usdPerKwd * 3.6725) },
        }).replace(/"(\d[\d.]*)"/g, '$1'),
        'https://open.er-api.com/v6/latest/AED': JSON.stringify({
          result: 'success',
          base_code: 'AED',
          time_last_update_utc: stamp,
          rates: { AED: 1, USD: 0.272294, EUR: 0.242022, KWD: 0.084188 },
        }),
        'https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/kwd.json':
          JSON.stringify({
            date: on,
            kwd: {
              usd: usdPerKwd * 1.0009,
              eur: Number(eur) * 1.0009,
              aed: usdPerKwd * 3.6725 * 1.0009,
            },
          }),
        'https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/aed.json':
          JSON.stringify({ date: on, aed: { usd: 0.27232, eur: 0.24205, kwd: 0.08421 } }),
      }
      const fake = (async (input: string | URL | Request) => {
        const url = String(input)
        if (primaryDown && url.includes('er-api')) return new Response('down', { status: 503 })
        const body = bodies[url]
        return body ? new Response(body) : new Response('missing', { status: 404 })
      }) as unknown as typeof fetch
      harness.real = resilientFxSource({ fetch: fake, sleep: async () => {} })
    }

    const rowsOn = (on: string) =>
      withActor(actor, (tx) =>
        tx
          .select({
            from: fxRates.fromCurrency,
            to: fxRates.toCurrency,
            rate: fxRates.rate,
            source: fxRates.source,
          })
          .from(fxRates)
          .where(eq(fxRates.effectiveOn, on)),
      )

    it('writes both directions for both bases, dated by the provider', async () => {
      const on = nextDay()
      answering(on)
      await track(['USD', 'EUR'])

      const result = await runFxRefresh()

      expect(result.source).toBe('resilient')
      expect(result.refused).toEqual([])
      expect(result.effectiveOn).toEqual([on])
      const rows = await rowsOn(on)
      const pair = (from: string, to: string) =>
        rows.find((r) => r.from === from && r.to === to && r.source === 'er-api')?.rate
      expect(pair('KWD', 'USD')).toBe('3.23436600000000')
      expect(pair('USD', 'KWD')).toBe('0.30917960428721')
      expect(pair('AED', 'USD')).toBe('0.27229400000000')
      expect(pair('USD', 'AED')).toBeDefined()
    })

    it('writes nothing new on a second run the same day', async () => {
      const on = nextDay()
      answering(on)
      await runFxRefresh()
      const before = (await rowsOn(on)).length

      const second = await runFxRefresh()

      expect(second.written).toBe(0)
      expect((await rowsOn(on)).length).toBe(before)
    })

    it('keeps the first provider of the day when another answers later', async () => {
      const on = nextDay()
      answering(on, { primaryDown: true }) // only currency-api answers at 08:00
      await runFxRefresh()
      answering(on) // er-api is back by 11:00
      const second = await runFxRefresh()

      expect(second.written).toBe(0)
      const sources = new Set((await rowsOn(on)).map((r) => r.source))
      expect([...sources]).toEqual(['currency-api'])
    })

    it('refuses a rate that moved more than 10%, and writes the rest', async () => {
      const first = nextDay()
      answering(first)
      await runFxRefresh()

      // EUR from 2.781 to 3.10 KWD is 11.47%, and both providers agree on it.
      const next = nextDay()
      answering(next, { eur: '3.10' })
      const result = await runFxRefresh()

      expect(result.refused?.find((r) => r.pair === 'KWD→EUR')?.reason).toMatch(
        /moved 11\.47%.*limit 10%/,
      )
      const rows = await rowsOn(next)
      expect(rows.some((r) => r.from === 'KWD' && r.to === 'EUR')).toBe(false)
      expect(rows.some((r) => r.from === 'KWD' && r.to === 'USD')).toBe(true)
    })

    it('leaves a hand-entered rate for the same day alone, and readers prefer it', async () => {
      const on = nextDay()
      await withActor(actor, (tx) =>
        tx
          .insert(fxRates)
          .values({
            fromCurrency: 'USD',
            toCurrency: 'KWD',
            rate: '0.30500000',
            source: 'manual',
            effectiveOn: on,
          })
          .onConflictDoNothing(),
      )
      answering(on)

      await runFxRefresh()

      const rows = (await rowsOn(on)).filter((r) => r.from === 'USD' && r.to === 'KWD')
      expect(rows.map((r) => [r.source, r.rate]).sort()).toEqual([
        ['er-api', '0.30917960428721'],
        ['manual', '0.30500000000000'],
      ])
      // The order every reader uses: newest day, then the person over the feed.
      const [chosen] = await withActor(actor, (tx) =>
        tx
          .select({ rate: fxRates.rate, source: fxRates.source })
          .from(fxRates)
          .where(
            and(
              eq(fxRates.fromCurrency, 'USD'),
              eq(fxRates.toCurrency, 'KWD'),
              lte(fxRates.effectiveOn, on),
            ),
          )
          .orderBy(...fxRateOrder())
          .limit(1),
      )
      expect(chosen).toEqual({ rate: '0.30500000000000', source: 'manual' })
    })

    it('reports the feed stale once its newest rate is more than three days old', async () => {
      const on = nextDay()
      answering(on)
      await runFxRefresh()

      const plus = (n: number) =>
        new Date(Date.parse(`${on}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10)
      const fresh = await withActor(actor, (tx) => fxFeedStatus(tx, plus(3)))
      const stale = await withActor(actor, (tx) => fxFeedStatus(tx, plus(4)))

      expect(fresh.stalePairs).not.toContain('USD→KWD')
      expect(stale.stalePairs).toContain('USD→KWD')
      expect(stale.stale).toBe(true)
    })
  })
})
