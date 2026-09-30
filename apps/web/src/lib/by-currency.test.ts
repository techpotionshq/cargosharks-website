/**
 * Per-currency totals — the fix for every summary that added dinars to dirhams.
 *
 * No database: this is the arithmetic the fixtures and the unbilled register
 * run over rows already in hand, and it is where a `Number` sum would come
 * back. KWD carries three decimals, so the cases use values a float gets
 * wrong (`0.1 + 0.2`) and check the strings, not a rounded number.
 */

import { describe, expect, it } from 'vitest'
import { formatByCurrency, sumByCurrency } from './by-currency'

describe('sumByCurrency', () => {
  it('keeps each currency its own figure', () => {
    const totals = sumByCurrency([
      { currency: 'KWD', amount: '100.500' },
      { currency: 'AED', amount: '350.00' },
      { currency: 'KWD', amount: '20.250' },
    ])

    expect(totals).toEqual([
      { currency: 'AED', amount: '350.000000' },
      { currency: 'KWD', amount: '120.750000' },
    ])
  })

  it('adds exactly, as strings, never through a float', () => {
    const [kwd] = sumByCurrency([
      { currency: 'KWD', amount: '0.1' },
      { currency: 'KWD', amount: '0.2' },
    ])

    expect(kwd).toEqual({ currency: 'KWD', amount: '0.300000' })
    expect(typeof kwd!.amount).toBe('string')
  })

  it('orders largest first, then by code, as the SQL summaries do', () => {
    const totals = sumByCurrency([
      { currency: 'USD', amount: '10' },
      { currency: 'EUR', amount: '10' },
      { currency: 'KWD', amount: '900.125' },
    ])

    expect(totals.map((entry) => entry.currency)).toEqual(['KWD', 'EUR', 'USD'])
  })

  it('treats a missing amount as zero rather than failing the whole total', () => {
    expect(
      sumByCurrency([
        { currency: 'KWD', amount: null },
        { currency: 'KWD', amount: '5.005' },
      ]),
    ).toEqual([{ currency: 'KWD', amount: '5.005000' }])
  })

  it('is empty for no rows', () => {
    expect(sumByCurrency([])).toEqual([])
  })
})

describe('formatByCurrency', () => {
  it('prints each currency with its own places, side by side', () => {
    const text = formatByCurrency(
      [
        { currency: 'KWD', amount: '1200.5' },
        { currency: 'AED', amount: '350' },
      ],
      'en',
    )

    const [kwd, aed] = text.split(' · ')
    // Three places for the dinar, two for the dirham — never one sum.
    expect(kwd).toContain('KWD')
    expect(kwd).toContain('1,200.500')
    expect(aed).toContain('AED')
    expect(aed).toContain('350.00')
  })

  it('says nothing rather than a zero in an invented currency', () => {
    expect(formatByCurrency([], 'en')).toBe('—')
  })
})
