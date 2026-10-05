/**
 * The checks a feed rate must pass before it is written.
 *
 * Every figure below is close to a real one from October 2026, so a case reads
 * as the situation it models: KWD at about 3.24 USD, AED on its 3.6725 peg.
 */

import { describe, expect, it } from 'vitest'
import {
  D,
  checkPegs,
  crossCheck,
  daysBetween,
  fxStaleness,
  isPeggedPair,
  moveProblem,
  parseRate,
  quoteConversionDate,
  convertToBase,
} from '../src/index'

const map = (entries: Record<string, string>) =>
  new Map(Object.entries(entries).map(([code, rate]) => [code, new D(rate)]))

describe('parseRate', () => {
  it('keeps the digits the provider sent', () => {
    expect(parseRate('3.2343660000000001')?.toString()).toBe('3.2343660000000001')
    expect(parseRate(3.234366)?.toString()).toBe('3.234366')
    expect(parseRate('1.2e-5')?.toString()).toBe('0.000012')
  })

  it('refuses anything that is not a finite rate above zero', () => {
    for (const bad of ['0', '-1', 'NaN', 'Infinity', '', 'abc', null, undefined, {}, 0, -2]) {
      expect(parseRate(bad)).toBeNull()
    }
    expect(parseRate(Number.POSITIVE_INFINITY)).toBeNull()
    expect(parseRate(Number.NaN)).toBeNull()
  })
})

describe('crossCheck', () => {
  it('uses the primary where the two agree within 1%', () => {
    const { agreed, diverged } = crossCheck(map({ USD: '3.234366' }), map({ USD: '3.237409' }), [
      'USD',
    ])
    expect(diverged).toEqual([])
    expect(agreed.get('USD')).toMatchObject({ from: 'primary' })
    expect(agreed.get('USD')?.rate.toString()).toBe('3.234366')
  })

  it('refuses a pair the two disagree on by more than 1%', () => {
    const { agreed, diverged } = crossCheck(
      map({ USD: '3.234366', EUR: '2.78' }),
      map({ USD: '3.30', EUR: '2.781' }),
      ['USD', 'EUR'],
    )
    expect(agreed.has('USD')).toBe(false)
    expect(agreed.has('EUR')).toBe(true)
    expect(diverged).toEqual([
      { code: 'USD', primary: '3.234366', fallback: '3.3', percent: '2.03' },
    ])
  })

  it('takes a currency from whichever provider quoted it', () => {
    const { agreed } = crossCheck(map({ USD: '3.23' }), map({ INR: '287.1' }), ['USD', 'INR'])
    expect(agreed.get('USD')?.from).toBe('primary')
    expect(agreed.get('INR')?.from).toBe('fallback')
  })
})

describe('checkPegs', () => {
  it('passes a KWD batch with the Gulf currencies on their pegs', () => {
    const rates = map({
      USD: '3.234366',
      AED: '11.87812', // 3.6724 per USD
      SAR: '12.1289',
      QAR: '11.7731',
      BHD: '1.21612',
      OMR: '1.24361',
      EUR: '2.78',
    })
    expect(checkPegs('KWD', rates)).toEqual(new Map())
  })

  it('refuses a pegged currency more than 1% off its peg', () => {
    const refused = checkPegs('KWD', map({ USD: '3.234366', AED: '12.5', SAR: '12.1289' }))
    expect([...refused.keys()]).toEqual(['AED'])
    expect(refused.get('AED')).toMatch(/AED at 3\.86.* per USD, peg 3\.6725/)
  })

  it('refuses the whole batch when the base itself is off its peg', () => {
    const refused = checkPegs('AED', map({ USD: '0.25', KWD: '0.0842' }))
    expect(refused.get('*')).toMatch(/AED at 4 per USD/)
  })

  it('refuses KWD outside 3.0 to 3.5 USD, from either side', () => {
    // An inverted rate: 0.31 USD per KWD.
    expect(checkPegs('KWD', map({ USD: '0.309', AED: '1.1348' })).get('*')).toMatch(/KWD at 0\.309/)
    // From an AED base: 1 AED = 0.0842 KWD and 0.2723 USD gives 3.234 USD/KWD, fine.
    expect(checkPegs('AED', map({ USD: '0.27229', KWD: '0.08419' }))).toEqual(new Map())
    // And 1 AED = 0.0542 KWD gives 5.02 USD/KWD, refused.
    expect(checkPegs('AED', map({ USD: '0.27229', KWD: '0.0542' })).get('KWD')).toMatch(/outside/)
  })

  it('refuses what it cannot verify when the batch carries no dollar', () => {
    const refused = checkPegs('KWD', map({ AED: '11.87', EUR: '2.78' }))
    expect(refused.get('AED')).toMatch(/no USD/)
    expect(refused.has('EUR')).toBe(false)
    expect(refused.get('*')).toMatch(/no USD/)
  })
})

describe('moveProblem', () => {
  it('accepts a move within 10%, and any rate with no baseline', () => {
    expect(moveProblem('KWD', 'USD', new D('3.40'), new D('3.234'))).toBeNull()
    expect(moveProblem('KWD', 'USD', new D('9.99'), null)).toBeNull()
  })

  it('refuses a move of more than 10%', () => {
    expect(moveProblem('KWD', 'USD', new D('3.60'), new D('3.234'))).toMatch(
      /KWD→USD moved 11\.32%.*limit 10%/,
    )
  })

  it('holds a pair pegged on both sides to 1%', () => {
    expect(isPeggedPair('AED', 'SAR')).toBe(true)
    expect(isPeggedPair('USD', 'AED')).toBe(true)
    expect(isPeggedPair('KWD', 'USD')).toBe(false)
    expect(moveProblem('USD', 'AED', new D('3.72'), new D('3.6725'))).toMatch(/limit 1%/)
    expect(moveProblem('USD', 'AED', new D('3.68'), new D('3.6725'))).toBeNull()
  })
})

describe('fxStaleness', () => {
  it('is fresh within three days, so a weekend does not alarm anybody', () => {
    expect(daysBetween('2026-10-02', '2026-10-05')).toBe(3)
    const result = fxStaleness([{ from: 'USD', to: 'KWD', newest: '2026-10-02' }], '2026-10-05')
    expect(result).toEqual({ stale: false, ageDays: 3, newest: '2026-10-02', stalePairs: [] })
  })

  it('is stale past three days, naming the pair and its age', () => {
    const result = fxStaleness(
      [
        { from: 'USD', to: 'KWD', newest: '2026-10-05' },
        { from: 'EUR', to: 'KWD', newest: '2026-10-01' },
      ],
      '2026-10-05',
    )
    expect(result.stale).toBe(true)
    expect(result.ageDays).toBe(4)
    expect(result.stalePairs).toEqual(['EUR→KWD'])
  })

  it('counts a tracked pair the feed never wrote as stale', () => {
    const result = fxStaleness([{ from: 'INR', to: 'KWD', newest: null }], '2026-10-05')
    expect(result).toMatchObject({ stale: true, ageDays: null, stalePairs: ['INR→KWD'] })
  })
})

describe('quoteConversionDate', () => {
  it('is the newest rate day among the conversions recorded', () => {
    const snapshot = {
      converted: [
        { from: 'USD', to: 'KWD', effectiveOn: '2026-10-04' },
        { from: 'EUR', to: 'KWD', effectiveOn: '2026-10-05' },
      ],
    }
    expect(quoteConversionDate(snapshot, 'KWD')).toBe('2026-10-05')
  })

  it('is null when nothing was converted', () => {
    expect(quoteConversionDate({ converted: [] }, 'KWD')).toBeNull()
    expect(quoteConversionDate({}, 'KWD')).toBeNull()
    expect(quoteConversionDate(null, 'KWD')).toBeNull()
  })

  it('falls back to the pricing day for a quotation priced before it was recorded', () => {
    const legacy = {
      pricedAt: '2026-09-30T08:00:00.000Z',
      lineCosts: [{ cardCurrency: 'USD' }],
    }
    expect(quoteConversionDate(legacy, 'KWD')).toBe('2026-09-30')
    expect(quoteConversionDate({ ...legacy, lineCosts: [{ cardCurrency: 'KWD' }] }, 'KWD')).toBe(
      null,
    )
  })
})

describe('convertToBase', () => {
  it('converts a USD reply into KWD in decimals, to three places exactly', () => {
    expect(convertToBase('1850.00', 'USD', 'KWD', '0.30917960428721', 3)).toBe('571.982')
    // Half-up at the fils: 0.0005 rounds away from zero.
    expect(convertToBase('1', 'USD', 'KWD', '0.3085', 3)).toBe('0.309')
    // A float multiply gives 0.1 * 3 = 0.30000000000000004; decimals do not.
    expect(convertToBase('0.1', 'USD', 'KWD', '3', 6)).toBe('0.300000')
  })

  it('needs no rate for the base, and refuses a missing or unusable one', () => {
    expect(convertToBase('900', 'KWD', 'KWD', null, 3)).toBe('900.000')
    expect(convertToBase('900', 'USD', 'KWD', null, 3)).toBeNull()
    expect(convertToBase('900', 'USD', 'KWD', '0', 3)).toBeNull()
    expect(convertToBase(null, 'USD', 'KWD', '0.3', 3)).toBeNull()
    expect(convertToBase('abc', 'USD', 'KWD', '0.3', 3)).toBeNull()
  })
})
