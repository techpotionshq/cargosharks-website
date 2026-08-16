import { describe, expect, it } from 'vitest'
import {
  add,
  convert,
  CurrencyMismatchError,
  fxRate,
  money,
  percentOf,
  round,
  seedCurrencyLookup,
  roundWith,
  sum,
  toDb,
  zero,
} from '../src/index'

const KWD = seedCurrencyLookup('KWD')!
const USD = seedCurrencyLookup('USD')!

describe('rounding is per currency, at the line (NFR-02)', () => {
  it('keeps three decimals for KWD', () => {
    expect(round(money('12.3456', 'KWD'), KWD).amount.toFixed()).toBe('12.346')
  })

  it('keeps two for USD', () => {
    expect(round(money('12.345', 'USD'), USD).amount.toFixed()).toBe('12.35')
  })

  it('does not lose the third decimal when a KWD total is summed', () => {
    // Three lines at 0.335 KWD: rounding each line then summing must equal
    // 1.005, not the 1.01 a two-decimal system would produce.
    const lines = ['0.335', '0.335', '0.335'].map((a) => roundWith(money(a, 'KWD'), seedCurrencyLookup))
    expect(toDb(sum(lines, 'KWD'))).toBe('1.005')
  })
})

describe('currency safety', () => {
  it('refuses to add across currencies', () => {
    expect(() => add(money(1, 'KWD'), money(1, 'USD'))).toThrow(CurrencyMismatchError)
  })

  it('sums an empty list into a currency-bearing zero', () => {
    expect(sum([], 'KWD')).toEqual(zero('KWD'))
  })
})

describe('FX travels with the line (FR-RT-06)', () => {
  it('reconciles a March quote against a June invoice using the stored rate', () => {
    const marchRate = fxRate('USD', 'KWD', '0.30650', new Date('2026-03-04T09:00:00Z'))
    const quoted = money('4250.00', 'USD')

    const invoiced = roundWith(convert(quoted, marchRate), seedCurrencyLookup)

    // Months later the spot rate has moved; the line still reconciles because
    // the rate used is the one stamped on it, not today's.
    expect(toDb(invoiced)).toBe('1302.625')
    expect(marchRate.takenAt.toISOString()).toBe('2026-03-04T09:00:00.000Z')
  })
})

describe('percentages', () => {
  it('treats 12.5 as 12.5 per cent', () => {
    expect(toDb(percentOf(money('200', 'USD'), '12.5'))).toBe('25')
  })
})
