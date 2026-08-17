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

import type { FxQuote, FxRateSource } from '../ports/index'
import { config } from '../config'

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
  readonly rates?: Record<string, number>
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

      const body = (await response.json()) as RatesResponse

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

      return quotes
        .filter((code) => typeof body.rates?.[code] === 'number')
        .map((code) => ({
          from: base,
          to: code,
          /*
            A string, all the way through.

            `fx_rates.rate` is `numeric(19,8)` and the wire format is a string
            for the reason §11 gives about money: a JS number cannot hold what
            the column can, and the conversion is lossy in the direction that
            looks fine until it does not. `toFixed(8)` matches the column's
            scale exactly rather than hoping the driver rounds the same way.
          */
          rate: (body.rates![code] as number).toFixed(8),
          effectiveOn,
          source: 'http',
        }))
    },
  }
}

/**
 * Which source this deployment runs on.
 *
 * Defaults to manual, so a deployment that has configured nothing behaves
 * exactly as Release One did rather than failing at boot over a feature nobody
 * asked for.
 */
export function resolveFxSource(): FxRateSource {
  if (config.FX_SOURCE !== 'api') return manualFxSource

  if (!config.FX_API_URL) {
    throw new Error(
      'FX_SOURCE=api but FX_API_URL is not set. It is a URL template — the ' +
        '`{base}` placeholder is substituted per request, e.g. ' +
        'https://open.er-api.com/v6/latest/{base}',
    )
  }

  return httpFxSource(config.FX_API_URL, config.FX_API_KEY)
}
