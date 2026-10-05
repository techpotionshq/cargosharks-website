/**
 * The resilient FX driver, against a fetch that answers from a table.
 *
 * No network and no database: every case below is a pair of provider bodies
 * and what the driver made of them. The figures are close to the real ones
 * for 5 October 2026 — KWD at about 3.234 USD, AED on its 3.6725 peg — so a
 * failure reads as the market situation it models.
 */

import { describe, expect, it, vi } from 'vitest'
import { parseRatesJson, resilientFxSource, resolveFxSource, type FxLog } from './fx'
import type { LiveIntegration } from '../settings'

const ER = 'https://open.er-api.com/v6/latest/'
const JSD = 'https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/'
const MIRROR = 'https://latest.currency-api.pages.dev/v1/currencies/'

/** KWD per the primary: 3.234366 USD, 11.87812 AED (3.6724 per USD). */
const erKwd = (rates: Record<string, number | string> = {}) =>
  JSON.stringify({
    result: 'success',
    base_code: 'KWD',
    time_last_update_utc: 'Mon, 05 Oct 2026 00:02:31 +0000',
    rates: { KWD: 1, USD: 3.234366, AED: 11.87812, EUR: 2.781, SAR: 12.1289, ...rates },
  })

/** KWD per the fallback: within 0.1% of the primary, dated the day before. */
const caKwd = (rates: Record<string, number | string> = {}) =>
  JSON.stringify({
    date: '2026-10-04',
    kwd: {
      kwd: 1,
      usd: 3.237409,
      aed: 11.88938,
      eur: 2.7835,
      sar: 12.1402,
      aave: 0.0177,
      ...rates,
    },
  })

type Answer = { status?: number; body: string } | Error

/** A fetch that answers by URL prefix and records what it was asked. */
function fakeFetch(routes: Record<string, Answer | Answer[]>) {
  const asked: string[] = []
  const counters = new Map<string, number>()
  const impl = vi.fn(async (input: string | URL | Request) => {
    const url = String(input)
    asked.push(url)
    const key = Object.keys(routes).find((prefix) => url.startsWith(prefix))
    if (!key) throw new Error(`unexpected fetch ${url}`)
    const entry = routes[key]!
    const n = counters.get(key) ?? 0
    counters.set(key, n + 1)
    const answer = Array.isArray(entry) ? entry[Math.min(n, entry.length - 1)]! : entry
    if (answer instanceof Error) throw answer
    return new Response(answer.body, { status: answer.status ?? 200 })
  })
  return { impl: impl as unknown as typeof fetch, asked }
}

function recorder() {
  const lines: { level: string; obj: unknown; msg: string }[] = []
  const log: FxLog = {
    info: (obj, msg) => lines.push({ level: 'info', obj, msg }),
    warn: (obj, msg) => lines.push({ level: 'warn', obj, msg }),
    error: (obj, msg) => lines.push({ level: 'error', obj, msg }),
  }
  return { log, lines }
}

const source = (routes: Record<string, Answer | Answer[]>) => {
  const { impl, asked } = fakeFetch(routes)
  const { log, lines } = recorder()
  const fx = resilientFxSource({ fetch: impl, log, sleep: async () => {}, timeoutMs: 1000 })
  return { fx, asked, lines }
}

describe('the resilient FX driver', () => {
  it('uses the primary where both providers agree within 1%', async () => {
    const { fx, lines } = source({ [ER]: { body: erKwd() }, [JSD]: { body: caKwd() } })

    const report = await fx.fetchReport!('KWD', ['USD', 'AED', 'EUR'])

    expect(report.refused).toEqual([])
    expect(report.quotes).toEqual([
      { from: 'KWD', to: 'USD', rate: '3.234366', effectiveOn: '2026-10-05', source: 'er-api' },
      { from: 'KWD', to: 'AED', rate: '11.87812', effectiveOn: '2026-10-05', source: 'er-api' },
      { from: 'KWD', to: 'EUR', rate: '2.781', effectiveOn: '2026-10-05', source: 'er-api' },
    ])
    expect(lines.filter((l) => l.level !== 'info')).toEqual([])
  })

  it('refuses a pair the providers disagree on by more than 1%, and logs it', async () => {
    const { fx, lines } = source({
      [ER]: { body: erKwd({ EUR: 2.9 }) },
      [JSD]: { body: caKwd({ eur: 2.78 }) },
    })

    const report = await fx.fetchReport!('KWD', ['USD', 'EUR'])

    expect(report.quotes.map((q) => q.to)).toEqual(['USD'])
    expect(report.refused).toEqual([
      {
        pair: 'KWD→EUR',
        reason: 'providers disagree by 4.14% (er-api 2.9, currency-api 2.78)',
      },
    ])
    expect(lines).toContainEqual(
      expect.objectContaining({ level: 'error', msg: 'fx: rate refused' }),
    )
  })

  it('falls back to currency-api, with its own date and source, when the primary is down', async () => {
    const { fx, lines, asked } = source({
      [ER]: { status: 503, body: 'down' },
      [JSD]: { body: caKwd() },
    })

    const report = await fx.fetchReport!('KWD', ['USD', 'AED'])

    expect(report.quotes).toEqual([
      {
        from: 'KWD',
        to: 'USD',
        rate: '3.237409',
        effectiveOn: '2026-10-04',
        source: 'currency-api',
      },
      {
        from: 'KWD',
        to: 'AED',
        rate: '11.88938',
        effectiveOn: '2026-10-04',
        source: 'currency-api',
      },
    ])
    // Asked twice: one retry, after the backoff.
    expect(asked.filter((u) => u.startsWith(ER))).toHaveLength(2)
    expect(lines).toContainEqual(
      expect.objectContaining({
        level: 'warn',
        msg: 'fx: one provider failed; using the other without a cross-check',
      }),
    )
  })

  it('tries the pages.dev mirror when jsDelivr fails', async () => {
    const { fx, asked } = source({
      [ER]: new Error('connect ETIMEDOUT'),
      [JSD]: { status: 404, body: 'not found' },
      [MIRROR]: { body: caKwd() },
    })

    const report = await fx.fetchReport!('KWD', ['USD'])

    expect(report.quotes[0]).toMatchObject({ source: 'currency-api', rate: '3.237409' })
    expect(asked.some((u) => u.startsWith(MIRROR))).toBe(true)
  })

  it('recovers on the retry', async () => {
    const { fx } = source({
      [ER]: [new Error('socket hang up'), { body: erKwd() }],
      [JSD]: { body: caKwd() },
    })
    const report = await fx.fetchReport!('KWD', ['USD'])
    expect(report.quotes[0]).toMatchObject({ source: 'er-api' })
  })

  it('throws, naming both, when every provider is down', async () => {
    const { fx, lines } = source({
      [ER]: new Error('ECONNREFUSED'),
      [JSD]: { status: 500, body: '' },
      [MIRROR]: { status: 500, body: '' },
    })

    await expect(fx.fetchReport!('KWD', ['USD'])).rejects.toThrow(
      /every FX provider failed for KWD: er-api \(ECONNREFUSED\), currency-api \(/,
    )
    expect(lines.map((l) => l.level)).toContain('error')
  })

  it('treats a malformed body as a failed provider', async () => {
    const { fx } = source({
      [ER]: { body: '<html>Cloudflare</html>' },
      [JSD]: { body: '{"date":"2026-10-04","kwd":"oops"}' },
      [MIRROR]: { body: '{"date": "2026-10-04"' },
    })
    await expect(fx.fetchReport!('KWD', ['USD'])).rejects.toThrow(/every FX provider failed/)
  })

  it('treats a 200 with an error body as a failed provider', async () => {
    const { fx } = source({
      [ER]: { body: JSON.stringify({ result: 'error', 'error-type': 'unsupported-code' }) },
      [JSD]: { body: caKwd() },
    })
    const report = await fx.fetchReport!('KWD', ['USD'])
    expect(report.providers[0]).toEqual({
      name: 'er-api',
      ok: false,
      error: 'answered error: unsupported-code',
    })
    expect(report.quotes[0]?.source).toBe('currency-api')
  })

  it('drops a rate that is not a finite number above zero', async () => {
    const { fx } = source({
      [ER]: { body: erKwd({ EUR: 0, GBP: -1, INR: 'NaN' }) },
      [JSD]: { status: 500, body: '' },
      [MIRROR]: { status: 500, body: '' },
    })
    const report = await fx.fetchReport!('KWD', ['USD', 'EUR', 'GBP', 'INR'])
    expect(report.quotes.map((q) => q.to)).toEqual(['USD'])
    expect(report.refused.map((r) => r.pair)).toEqual(['KWD→EUR', 'KWD→GBP', 'KWD→INR'])
  })

  it('refuses a pegged currency that is off its peg', async () => {
    // AED at 12.5 per KWD is 3.865 per USD, 5% off the 3.6725 peg — in both feeds.
    const { fx } = source({
      [ER]: { body: erKwd({ AED: 12.5 }) },
      [JSD]: { body: caKwd({ aed: 12.51 }) },
    })
    const report = await fx.fetchReport!('KWD', ['USD', 'AED', 'SAR'])
    expect(report.quotes.map((q) => q.to)).toEqual(['USD', 'SAR'])
    expect(report.refused[0]?.pair).toBe('KWD→AED')
    expect(report.refused[0]?.reason).toMatch(/^off peg: AED at 3\.86/)
  })

  it('refuses the whole batch when KWD itself is outside its band', async () => {
    // Both feeds agreeing on an inverted dinar — 0.309 USD — is still wrong.
    const inverted = { USD: 0.3092, AED: 1.1355, EUR: 0.2659, SAR: 1.1595 }
    const { fx } = source({
      [ER]: { body: erKwd(inverted) },
      [JSD]: { body: caKwd({ usd: 0.3093, aed: 1.1356, eur: 0.266, sar: 1.1596 }) },
    })
    const report = await fx.fetchReport!('KWD', ['USD', 'AED', 'EUR'])
    expect(report.quotes).toEqual([])
    expect(report.refused.every((r) => /KWD at 0\.309/.test(r.reason))).toBe(true)
  })

  it('takes the date from the provider, never from the clock', async () => {
    vi.useFakeTimers({ now: new Date('2026-12-25T12:00:00Z') })
    try {
      const { fx } = source({ [ER]: { body: erKwd() }, [JSD]: { body: caKwd() } })
      const report = await fx.fetchReport!('KWD', ['USD'])
      expect(report.quotes[0]?.effectiveOn).toBe('2026-10-05')
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps the digits the provider sent rather than a float of them', () => {
    const body = parseRatesJson('{"rates":{"JPY":0.0028123456789012345,"KWD":1}}') as {
      rates: Record<string, string>
    }
    expect(body.rates.JPY).toBe('0.0028123456789012345')
    expect(body.rates.KWD).toBe('1')
  })

  it('asks for the lower-case base on currency-api and the upper-case one on er-api', async () => {
    const { fx, asked } = source({ [ER]: { body: erKwd() }, [JSD]: { body: caKwd() } })
    await fx.fetch('KWD', ['USD'])
    expect(asked).toContain(`${ER}KWD`)
    expect(asked).toContain(`${JSD}kwd.json`)
  })
})

describe('choosing the driver', () => {
  const settings = (driver: string, text: Record<string, string> = {}): LiveIntegration =>
    ({
      driver,
      text: (name: string) => text[name],
      secret: () => undefined,
    }) as unknown as LiveIntegration

  it('needs no URL or key for the resilient driver', () => {
    const fx = resolveFxSource(settings('resilient'))
    expect(fx.key).toBe('resilient')
    expect(fx.sources).toEqual(['er-api', 'currency-api'])
  })

  it('keeps the api driver, which still demands its URL', () => {
    expect(resolveFxSource(settings('api', { url: 'https://x/{base}' })).key).toBe('http')
    expect(() => resolveFxSource(settings('api'))).toThrow(/no URL/)
  })

  it('stays manual by default', () => {
    expect(resolveFxSource(settings('manual')).key).toBe('manual')
  })
})
