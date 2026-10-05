import { describe, expect, it } from 'vitest'
import { fxRateLabel, fxSourceName, type FxTranslate } from './fx-label'

/** The English catalogue's `fxFeed.sources`, as the page's translator answers. */
const names: Record<string, string> = {
  'sources.er-api': 'ExchangeRate-API',
  'sources.currency-api': 'currency-api',
  'sources.manual': 'Entered by hand',
}
const t = Object.assign((key: string) => names[key] ?? key, {
  has: (key: string) => key in names,
}) as FxTranslate

describe('the rate label on the quotation screen', () => {
  it('names the pair, the rate, the provider and when it was taken, in UTC', () => {
    expect(
      fxRateLabel(
        {
          from: 'USD',
          to: 'KWD',
          rate: '0.30918000000000',
          source: 'er-api',
          takenAt: '2026-10-05T00:02:31.000Z',
        },
        t,
        'en',
      ),
    ).toBe('USD→KWD 0.30918 · ExchangeRate-API · 05 Oct, 00:02 UTC')
  })

  it('dates an older rate by its own day, not by when the row was written', () => {
    expect(
      fxRateLabel(
        {
          from: 'USD',
          to: 'KWD',
          rate: '0.307',
          source: 'seed-demo',
          effectiveOn: '2026-01-01',
          takenAt: '2026-10-05T09:46:00.000Z',
        },
        t,
        'en',
      ),
    ).toBe('USD→KWD 0.307 · seed-demo · 01 Jan 2026')
    expect(
      fxRateLabel(
        {
          from: 'USD',
          to: 'KWD',
          rate: '0.30918',
          source: 'er-api',
          effectiveOn: '2026-10-05',
          takenAt: '2026-10-05T00:02:31.000Z',
        },
        t,
        'en',
      ),
    ).toBe('USD→KWD 0.30918 · ExchangeRate-API · 05 Oct, 00:02 UTC')
  })

  it('says a hand-entered rate was entered by hand', () => {
    expect(
      fxRateLabel(
        { from: 'USD', to: 'KWD', rate: '0.305', source: 'manual', takenAt: null },
        t,
        'en',
      ),
    ).toBe('USD→KWD 0.305 · Entered by hand')
  })

  it('leaves out what a quotation priced before this did not record', () => {
    expect(
      fxRateLabel({ from: 'INR', to: 'KWD', rate: '0.0037', source: null, takenAt: null }, t, 'en'),
    ).toBe('INR→KWD 0.0037')
    expect(fxSourceName('somewhere-else', t)).toBe('somewhere-else')
  })
})
