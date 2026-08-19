/**
 * Settlement ceilings.
 *
 * The regression block is the reason this module exists: every case in it
 * passes the ceiling by exact decimal arithmetic and fails it by floating
 * point, which is how the rule was written before. They are not exotic —
 * three decimal places and subtraction is the whole recipe.
 */

import { describe, expect, it } from 'vitest'
import {
  SettlementError,
  checkSettlement,
  outstanding,
  positionFromDb,
  unallocated,
  toScale,
  type SettlementPosition,
} from '../src/index'

/** The shape `numeric(19,6)` comes back as. */
const position = (
  received: string,
  allocated: string,
  invoiced: string,
  settled: string,
): SettlementPosition => ({ received, allocated, invoiced, settled })

describe('remaining balances', () => {
  it('reports what is left of a receipt', () => {
    expect(toScale(unallocated('500.000000', '120.000000', 'KWD'))).toBe('380.000')
  })

  it('reports what is left outstanding on an invoice', () => {
    expect(toScale(outstanding('120.000000', '120.000000', 'KWD'))).toBe('0.000')
  })

  it('treats an absent sum as zero — the first allocation against a receipt', () => {
    const p = positionFromDb(
      { received: '500.000000', allocated: null, invoiced: '120.000000', settled: null },
      'KWD',
    )
    expect(checkSettlement('120.000000', p, 'KWD')).toEqual({ ok: true })
  })
})

describe('the two ceilings', () => {
  it('allows an allocation within both', () => {
    expect(checkSettlement('100.000', position('500', '0', '120', '0'), 'KWD')).toEqual({
      ok: true,
    })
  })

  it('refuses more of a receipt than was received', () => {
    const verdict = checkSettlement('200.000', position('500', '400', '900', '0'), 'KWD')
    expect(verdict.ok).toBe(false)
    if (verdict.ok) return
    expect(verdict.reason).toBe('over_allocated')
    expect(toScale(verdict.available)).toBe('100.000')
  })

  it('refuses more than the invoice still owes', () => {
    const verdict = checkSettlement('200.000', position('500', '0', '120', '0'), 'KWD')
    expect(verdict.ok).toBe(false)
    if (verdict.ok) return
    expect(verdict.reason).toBe('over_invoiced')
    expect(toScale(verdict.available)).toBe('120.000')
  })

  /**
   * Order matters for the message, not the outcome. Both ceilings are broken
   * here; the receipt is the one the operator has in front of them.
   */
  it('reports the receipt ceiling first when both are broken', () => {
    const verdict = checkSettlement('900.000', position('500', '0', '120', '0'), 'KWD')
    expect(verdict.ok).toBe(false)
    if (verdict.ok) return
    expect(verdict.reason).toBe('over_allocated')
  })

  it('refuses an allocation against a fully settled invoice', () => {
    const verdict = checkSettlement('0.001', position('500', '0', '120', '120'), 'KWD')
    expect(verdict.ok).toBe(false)
    if (verdict.ok) return
    expect(verdict.reason).toBe('over_invoiced')
  })

  it('refuses a non-positive amount outright', () => {
    expect(() => checkSettlement('0', position('500', '0', '120', '0'), 'KWD')).toThrow(
      SettlementError,
    )
    expect(() => checkSettlement('-5', position('500', '0', '120', '0'), 'KWD')).toThrow(
      SettlementError,
    )
  })
})

describe('paying to the last fils', () => {
  /**
   * The normal case, and the one the float version got wrong. Each of these
   * settles an invoice exactly: the amount asked for is precisely what is
   * outstanding, so every one of them must pass.
   *
   * Computed as floats, `8.700 - 8.600` is 0.09999999999999964 and the last
   * 100 fils is refused as "more than is still outstanding" — an invoice that
   * can never reach `paid`, on a value a forwarder bills every day.
   */
  const exact: ReadonlyArray<readonly [string, string, string]> = [
    ['8.700000', '8.600000', '0.100000'],
    ['0.300000', '0.100000', '0.200000'],
    ['1000.300000', '1000.100000', '0.200000'],
    ['100.300000', '100.100000', '0.200000'],
    ['2.675000', '2.670000', '0.005000'],
    ['1.005000', '1.000000', '0.005000'],
    ['4.350000', '4.340000', '0.010000'],
    ['1234.567000', '1234.566000', '0.001000'],
  ]

  it.each(exact)('settles an invoice of %s with %s already paid by %s', (total, paid, rest) => {
    expect(checkSettlement(rest, position('100000', '0', total, paid), 'KWD')).toEqual({ ok: true })
  })

  it.each(exact)(
    'allocates the last %s of a receipt already drawn to %s, paying %s',
    (received, drawn, rest) => {
      expect(checkSettlement(rest, position(received, drawn, '100000', '0'), 'KWD')).toEqual({
        ok: true,
      })
    },
  )

  /** One fils past exact is still refused. The fix must not open the gate. */
  it.each(exact)('still refuses one unit past the last of %s / %s / %s', (total, paid, rest) => {
    const overshoot = String(Number(rest) + 0.001)
    const verdict = checkSettlement(overshoot, position('100000', '0', total, paid), 'KWD')
    expect(verdict.ok).toBe(false)
  })
})

describe('currencies with different minor units', () => {
  /**
   * KWD carries three decimals and USD two. The ceiling is exact arithmetic
   * either way — this is here so that a future change rounding to the minor
   * unit has to think about it rather than discover it.
   */
  it('settles a USD invoice to the cent', () => {
    expect(checkSettlement('0.01', position('1000', '0', '19.99', '19.98'), 'USD')).toEqual({
      ok: true,
    })
  })

  it('settles a KWD invoice to the fils', () => {
    expect(checkSettlement('0.001', position('1000', '0', '19.999', '19.998'), 'KWD')).toEqual({
      ok: true,
    })
  })
})

describe('accumulating allocations', () => {
  /**
   * A receipt drawn down in many small pieces. Floats accumulate error across
   * a sequence; decimals do not, and the last piece must still fit exactly.
   */
  it('draws a receipt down to zero in tenths without drift', () => {
    const received = '10.000000'
    let allocated = 0
    for (let i = 0; i < 100; i++) {
      const drawn = (allocated / 1000).toFixed(6)
      const verdict = checkSettlement('0.100000', position(received, drawn, '100000', '0'), 'KWD')
      expect(verdict).toEqual({ ok: true })
      allocated += 100
    }
    // Fully drawn: the hundred-and-first tenth has nothing left to take.
    const exhausted = checkSettlement(
      '0.100000',
      position(received, '10.000000', '100000', '0'),
      'KWD',
    )
    expect(exhausted.ok).toBe(false)
  })
})
