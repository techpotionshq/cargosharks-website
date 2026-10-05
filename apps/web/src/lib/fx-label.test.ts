import { describe, expect, it } from 'vitest'
import { fxRateLabel, fxSourceName, zoneName, type FxTranslate } from './fx-label'
import { formatFxRate } from './format'

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

/* Live run 6 (N7): 14 decimals on a reciprocal, and UTC beside unlabelled Kuwait time. */
describe('reading precision and the zone', () => {
  it('shows a rate at six significant digits below one, six places above, trimmed', () => {
    expect(formatFxRate('0.08418840691961')).toBe('0.0841884')
    expect(formatFxRate('0.30917960428721')).toBe('0.30918')
    expect(formatFxRate('11.87812000000000')).toBe('11.87812')
    expect(formatFxRate('3.2500001234')).toBe('3.25')
    expect(formatFxRate('0.0000188123456')).toBe('0.0000188123')
    expect(formatFxRate(null)).toBeNull()
  })

  it("gives the time in the reader's zone and names it", () => {
    expect(zoneName('Asia/Kuwait')).toBe('GMT+3')
    expect(
      fxRateLabel(
        {
          from: 'USD',
          to: 'KWD',
          rate: '0.30917960428721',
          source: 'er-api',
          effectiveOn: '2026-10-05',
          takenAt: '2026-10-05T11:12:00.000Z',
        },
        t,
        'en',
        'Asia/Kuwait',
      ),
    ).toBe('USD→KWD 0.30918 · ExchangeRate-API · 05 Oct, 14:12 GMT+3')
  })
})
