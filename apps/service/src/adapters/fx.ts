/**
 * The FX rate source — `FxRateSource` in `ports/index.ts`.
 *
 * The port has been declared since Release One and had nothing behind it: the
 * config carries `FX_SOURCE`, `FX_API_URL` and `FX_API_KEY`, and no code read
 * them. Every rate in the system arrived by hand.
 *
 * That is defensible for one operator with two currencies and indefensible at
 * five entities across three, which is what the product is sold as. A stale
 * rate does not fail loudly — it produces an invoice that reconciles wrong
 * months later, which is the most expensive shape of error this system can
 * make (§6, FR-RT-06).
 *
 * ## Why the rate is stored rather than fetched
 *
 * Nothing here is called at quote time. `charge_lines` carries the rate it was
 * struck at *and the moment it was taken*, so the feed's job is to write a
 * dated row into `fx_rates` and never to answer a question in the request
 * path. A currency API that is slow, rate-limited or down must not be able to
 * stop someone raising a quote.
 */

import { checkPegs, crossCheck, parseRate, type D } from '@qabandi/core'
import type { FxQuote, FxRateSource, FxRefusal, FxReport } from '../ports/index'
import type { LiveIntegration } from '../settings'

/** The service does not depend on decimal.js directly; core's instance type. */
type Decimal = InstanceType<typeof D>

/**
 * The Release One behaviour, kept as a real implementation rather than an
 * absence.
 *
 * An operator types the rate on the charge line and the row in `fx_rates`
 * carries `source = 'manual'`. This returns nothing, which is different from
 * failing: there is no feed configured and that is a choice, not a fault.
 */
export const manualFxSource: FxRateSource = {
  key: 'manual',
  fetch: () => Promise.resolve([]),
}

interface RatesResponse {
  readonly result?: string
  /** Each rate as the provider's own text — see `parseRatesJson`. */
  readonly rates?: Record<string, string>
  readonly base_code?: string
  readonly time_last_update_utc?: string
  readonly 'error-type'?: string
}

/**
 * A JSON rates feed, shaped for the family of APIs that all answer the same
 * way — `exchangerate-api`, `open.er-api.com`, `apilayer`, most of the free
 * tier of everything else.
 *
 * `FX_API_URL` is a template rather than a host so a different provider is a
 * configuration change and not a code change:
 *
 *     FX_API_URL=https://open.er-api.com/v6/latest/{base}
 *     FX_API_URL=https://api.example.com/latest?base={base}&key={key}
 *
 * The `{base}` and `{key}` placeholders are the whole contract. A provider
 * that answers a different JSON shape needs its own adapter, and that is the
 * right amount of friction — silently coercing an unknown response into a
 * rate is how a wrong number gets into an invoice.
 */
export function httpFxSource(url: string, apiKey?: string): FxRateSource {
  return {
    key: 'http',

    async fetch(base: string, quotes: readonly string[]): Promise<FxQuote[]> {
      const endpoint = url
        .replace('{base}', encodeURIComponent(base))
        .replace('{key}', encodeURIComponent(apiKey ?? ''))

      /*
        A timeout, because there is no such thing as a request without one.

        This runs on a schedule rather than in a request, so a hang would not
        show as a slow page — it would show as a worker that stopped doing its
        other work, which is far harder to notice.
      */
      const response = await fetch(endpoint, {
        signal: AbortSignal.timeout(15_000),
        headers: apiKey ? { apikey: apiKey } : {},
      })

      if (!response.ok) {
        throw new Error(`FX feed answered ${response.status} ${response.statusText}`)
      }

      const body = parseRatesJson(await response.text()) as RatesResponse

      // Several of these APIs answer 200 with an error in the body.
      if (body.result === 'error' || !body.rates) {
        throw new Error(`FX feed returned no rates: ${body['error-type'] ?? 'unknown'}`)
      }

      /*
        The date the rates are *for*, not the date they were fetched.

        `fx_rates.effective_on` is part of the unique key, so getting this
        wrong writes a second row for the same day rather than being idempotent
        — and an invoice reconciled against "yesterday's rate, fetched today"
        is a discrepancy nobody can explain a quarter later.
      */
      const effectiveOn = (
        body.time_last_update_utc ? new Date(body.time_last_update_utc) : new Date()
      )
        .toISOString()
        .slice(0, 10)

      return quotes.flatMap((code) => {
        /*
          A string, all the way through, and the provider's own digits.

          `fx_rates.rate` is `numeric(24,14)` and the wire format is a string
          for the reason §11 gives about money. This used to be
          `number.toFixed(8)`, which rounded a weak currency's rate to eight
          places and passed every figure through a binary float on the way.
          The JSON text goes straight into a decimal instead, and a rate that
          is not a finite number above zero is dropped rather than stored.
        */
        const rate = parseRate(body.rates?.[code])
        return rate
          ? [{ from: base, to: code, rate: asColumn(rate), effectiveOn, source: 'http' }]
          : []
      })
    },
  }
}

/**
 * Which source this deployment runs on.
 *
 * Defaults to manual, so a deployment that has configured nothing behaves
 * exactly as Release One did rather than failing at boot over a feature nobody
 * asked for.
 *
 * Takes its configuration rather than reading it. The value is not purity for
 * its own sake: the same function now has to answer for a settings row and for
 * an environment variable, and a resolver that reached for `config` directly
 * could only ever answer for one of them.
 */
export function resolveFxSource(settings: LiveIntegration, log?: FxLog): FxRateSource {
  /*
    `resilient` needs nothing configured: both providers are free, keyless and
    named in code, because their response shapes are, and a URL field that
    could point it somewhere else would be a field that could break it.
  */
  if (settings.driver === 'resilient') return resilientFxSource({ log })
  if (settings.driver !== 'api') return manualFxSource

  const url = settings.text('url')

  if (!url) {
    throw new Error(
      'The FX source is set to `api` with no URL. It is a template — the ' +
        '`{base}` placeholder is substituted per request, e.g. ' +
        'https://open.er-api.com/v6/latest/{base}',
    )
  }

  return httpFxSource(url, settings.secret('apiKey'))
}

// --- the resilient driver ----------------------------------------------------

/**
 * A JSON body with every number kept as the text it was sent as.
 *
 * `JSON.parse` turns `3.2343660000000001` into the nearest binary float before
 * anything can look at it, and that float's digits are not the provider's.
 * Node 22's reviver receives the source text of each primitive (TC39 "JSON.parse
 * source text access"), so numbers are handed on as strings and become
 * decimals without ever being floats. Where a runtime does not supply the
 * context, `String(n)` is the shortest text that round-trips, which is the
 * next best thing and never a `toFixed`.
 */
export function parseRatesJson(text: string): unknown {
  return JSON.parse(text, function (_key, value: unknown, context?: { source?: string }) {
    if (typeof value !== 'number') return value
    return context?.source ?? String(value)
  } as (this: unknown, key: string, value: unknown) => unknown)
}

/** The column's scale is fourteen places; a provider rarely sends more. */
function asColumn(rate: Decimal): string {
  return rate.toDecimalPlaces(14).toFixed()
}

/** The service's logger, narrowed to what this file says. pino satisfies it. */
export interface FxLog {
  info(obj: unknown, msg: string): void
  warn(obj: unknown, msg: string): void
  error(obj: unknown, msg: string): void
}

const quiet: FxLog = { info: () => {}, warn: () => {}, error: () => {} }

/** One provider's answer for one base: the date it is for, and its rates. */
interface ProviderAnswer {
  readonly date: string
  /** Units of each currency per one unit of the base, upper-case codes. */
  readonly rates: Map<string, Decimal>
}

interface Provider {
  /** Written to `fx_rates.source` for every rate taken from it. */
  readonly name: string
  ask(base: string, signal: AbortSignal): Promise<ProviderAnswer>
}

export interface ResilientOptions {
  /** Injected so tests can answer without the network. */
  readonly fetch?: typeof fetch
  /** Injected so a test of the retry does not wait for it. */
  readonly sleep?: (ms: number) => Promise<void>
  readonly log?: FxLog
  readonly timeoutMs?: number
  readonly backoffMs?: number
}

export const ER_API_URL = 'https://open.er-api.com/v6/latest/{BASE}'
export const CURRENCY_API_URLS = [
  'https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/{base}.json',
  'https://latest.currency-api.pages.dev/v1/currencies/{base}.json',
] as const

/** Only ISO-shaped codes. currency-api also answers for crypto tokens. */
const ISO = /^[A-Z]{3}$/

function ratesFrom(raw: unknown): Map<string, Decimal> {
  const out = new Map<string, Decimal>()
  if (!raw || typeof raw !== 'object') return out
  for (const [code, value] of Object.entries(raw as Record<string, unknown>)) {
    const upper = code.toUpperCase()
    if (!ISO.test(upper)) continue
    const rate = parseRate(value)
    if (rate) out.set(upper, rate)
  }
  return out
}

async function getJson(
  doFetch: typeof fetch,
  url: string,
  signal: AbortSignal,
): Promise<Record<string, unknown>> {
  const response = await doFetch(url, { signal, headers: { accept: 'application/json' } })
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`.trim())
  const body = parseRatesJson(await response.text())
  if (!body || typeof body !== 'object') throw new Error('the body is not a JSON object')
  return body as Record<string, unknown>
}

/**
 * ExchangeRate-API's open endpoint — the primary.
 *
 * Free, keyless, daily, and the only one of the two whose terms require
 * attribution; the screens that show these rates say "Rates by
 * ExchangeRate-API" for that reason. It answers 200 with `result: "error"` for
 * an unknown base, so success is read from the body and not the status.
 */
function erApi(doFetch: typeof fetch): Provider {
  return {
    name: 'er-api',
    async ask(base, signal) {
      const body = await getJson(doFetch, ER_API_URL.replace('{BASE}', base), signal)
      if (body.result !== 'success') {
        throw new Error(`answered ${String(body.result)}: ${String(body['error-type'] ?? '')}`)
      }
      if (typeof body.base_code === 'string' && body.base_code.toUpperCase() !== base) {
        throw new Error(`answered for ${body.base_code}, not ${base}`)
      }
      // The day the rates are for, from the provider and never from our clock.
      const stamp = typeof body.time_last_update_utc === 'string' ? body.time_last_update_utc : ''
      const when = new Date(stamp)
      if (Number.isNaN(when.getTime())) throw new Error('no time_last_update_utc')
      const rates = ratesFrom(body.rates)
      if (rates.size === 0) throw new Error('no rates in the body')
      return { date: when.toISOString().slice(0, 10), rates }
    },
  }
}

/**
 * fawazahmed0's currency-api — the fallback, from jsDelivr then its mirror.
 *
 * A different upstream from ExchangeRate-API, which is the point of a second
 * opinion: two mirrors of one source would agree when the source is wrong.
 * Lower-case codes, and the date is a field of its own.
 */
function currencyApi(doFetch: typeof fetch): Provider {
  return {
    name: 'currency-api',
    async ask(base, signal) {
      const lower = base.toLowerCase()
      const failures: string[] = []
      for (const template of CURRENCY_API_URLS) {
        const url = template.replace('{base}', lower)
        try {
          const body = await getJson(doFetch, url, signal)
          const date = typeof body.date === 'string' ? body.date : ''
          if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('no date in the body')
          const rates = ratesFrom(body[lower])
          if (rates.size === 0) throw new Error(`no "${lower}" rates in the body`)
          return { date, rates }
        } catch (error) {
          if (signal.aborted) throw error
          failures.push(`${new URL(url).host}: ${(error as Error).message}`)
        }
      }
      throw new Error(failures.join('; '))
    },
  }
}

/**
 * Ask once, and once more after a pause, each attempt with its own timeout.
 *
 * One retry, because these are free endpoints run as a courtesy and a client
 * that hammers them is a client that gets blocked; the schedule retries the
 * whole run later in the day anyway. The backoff is short for the same reason
 * the timeout exists: this runs inside a worker that has other jobs to do.
 */
async function withRetry(
  provider: Provider,
  base: string,
  options: Required<Pick<ResilientOptions, 'sleep' | 'timeoutMs' | 'backoffMs'>>,
): Promise<ProviderAnswer> {
  let last: unknown
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) await options.sleep(options.backoffMs)
    try {
      return await provider.ask(base, AbortSignal.timeout(options.timeoutMs))
    } catch (error) {
      last = error
    }
  }
  throw last instanceof Error ? last : new Error(String(last))
}

/**
 * The recommended driver: two free providers, each checked against the other.
 *
 * ExchangeRate-API is asked, and currency-api beside it. Every rate must be a
 * finite number above zero. Where both answer a pair and agree within 1% the
 * primary's figure is used; where they disagree by more the pair is refused
 * for the day, because one of them is wrong and nothing here can say which.
 * Where only one answers, it is used and the other's failure is logged. The
 * merged batch then has to sit on the Middle East pegs — AED, SAR, QAR, BHD,
 * OMR and JOD within 1% of their dollar peg, KWD between 3.0 and 3.5 USD —
 * or the currency (or, if the base itself fails, the whole batch) is refused.
 *
 * Each rate is written with the provider it came from as its `source`, so a
 * row says whose number it is. Readers pick the newest rate whatever its
 * source, with a hand-entered rate winning on the same day.
 */
export function resilientFxSource(options: ResilientOptions = {}): FxRateSource {
  const doFetch = options.fetch ?? fetch
  const log = options.log ?? quiet
  const timing = {
    sleep: options.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms))),
    timeoutMs: options.timeoutMs ?? 10_000,
    backoffMs: options.backoffMs ?? 2_000,
  }
  const primary = erApi(doFetch)
  const fallback = currencyApi(doFetch)

  async function fetchReport(base: string, quotes: readonly string[]): Promise<FxReport> {
    const wanted = quotes.filter((code) => code !== base)
    const [p, f] = await Promise.allSettled([
      withRetry(primary, base, timing),
      withRetry(fallback, base, timing),
    ])

    const providers = [
      p.status === 'fulfilled'
        ? { name: primary.name, ok: true, date: p.value.date }
        : { name: primary.name, ok: false, error: (p.reason as Error).message },
      f.status === 'fulfilled'
        ? { name: fallback.name, ok: true, date: f.value.date }
        : { name: fallback.name, ok: false, error: (f.reason as Error).message },
    ]

    if (p.status === 'rejected' && f.status === 'rejected') {
      log.error({ base, providers }, 'fx: every provider failed; no rates for this base today')
      throw new Error(
        `every FX provider failed for ${base}: ` +
          providers.map((x) => `${x.name} (${x.error})`).join(', '),
      )
    }
    if (p.status === 'rejected' || f.status === 'rejected') {
      const failed = providers.find((x) => !x.ok)!
      log.warn(
        { base, provider: failed.name, error: failed.error },
        'fx: one provider failed; using the other without a cross-check',
      )
    }

    const pAnswer = p.status === 'fulfilled' ? p.value : undefined
    const fAnswer = f.status === 'fulfilled' ? f.value : undefined

    /*
      The dollar is always reconciled, whether or not it is tracked: every
      peg below is measured against it, and a batch whose dollar the two
      providers disagree on has nothing to measure with.
    */
    const codes = [...new Set([...wanted, ...(base === 'USD' ? [] : ['USD'])])]
    const { agreed, diverged } = crossCheck(
      pAnswer?.rates ?? new Map(),
      fAnswer?.rates ?? new Map(),
      codes,
    )

    const refused: FxRefusal[] = []
    for (const d of diverged) {
      refused.push({
        pair: `${base}→${d.code}`,
        reason: `providers disagree by ${d.percent}% (${primary.name} ${d.primary}, ${fallback.name} ${d.fallback})`,
      })
    }

    const merged = new Map([...agreed].map(([code, entry]) => [code, entry.rate]))
    const pegs = checkPegs(base, merged)
    const whole = pegs.get('*')

    const out: FxQuote[] = []
    for (const code of wanted) {
      const entry = agreed.get(code)
      if (!entry) {
        if (!diverged.some((d) => d.code === code)) {
          refused.push({ pair: `${base}→${code}`, reason: 'no provider quoted a usable rate' })
        }
        continue
      }
      const problem = whole ?? pegs.get(code)
      if (problem) {
        refused.push({ pair: `${base}→${code}`, reason: `off peg: ${problem}` })
        continue
      }
      const answer = entry.from === 'primary' ? pAnswer! : fAnswer!
      out.push({
        from: base,
        to: code,
        rate: asColumn(entry.rate),
        effectiveOn: answer.date,
        source: entry.from === 'primary' ? primary.name : fallback.name,
      })
    }

    for (const r of refused) {
      // Loud on purpose: a refused pair is a rate somebody will have to type.
      log.error({ base, pair: r.pair, reason: r.reason }, 'fx: rate refused')
    }

    return { quotes: out, refused, providers }
  }

  return {
    key: 'resilient',
    sources: [primary.name, fallback.name],
    fetchReport,
    fetch: async (base, quotes) => (await fetchReport(base, quotes)).quotes,
  }
}
