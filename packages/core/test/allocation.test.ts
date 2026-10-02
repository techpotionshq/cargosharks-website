import { describe, expect, it } from 'vitest'
import {
  AllocationError,
  SEED_CURRENCIES,
  allocate,
  dec,
  explain,
  money,
  reverse,
  sharesTotal,
  withMargin,
  type AllocationTarget,
  type CurrencySpec,
} from '../src/index'

const spec = (code: string): CurrencySpec => SEED_CURRENCIES.find((c) => c.code === code)!
const KWD = spec('KWD')
const USD = spec('USD')

/** The refusal a call throws, so its code and values can be asserted on. */
function catchAllocation(run: () => unknown): AllocationError {
  try {
    run()
  } catch (error) {
    if (error instanceof AllocationError) return error
    throw error
  }
  throw new Error('expected the allocation to be refused')
}

const house = (jobId: string, volumeCbm: number, extra: Partial<AllocationTarget> = {}) => ({
  jobId,
  volumeCbm,
  ...extra,
})

describe('proportional allocation', () => {
  it('splits an LCL freight cost by volume', () => {
    // 300.000 KWD of ocean freight over 10, 6 and 4 CBM.
    const result = allocate(
      money('300', 'KWD'),
      [house('A', 10), house('B', 6), house('C', 4)],
      'volume',
      KWD,
    )

    expect(result.shares.map((s) => s.share.amount.toString())).toEqual(['150', '90', '60'])
    expect(sharesTotal(result).amount.toString()).toBe('300')
  })

  it('sums exactly when the split does not divide', () => {
    // 100.000 KWD across three equal houses is 33.333 each and one fils over.
    // The fils must land somewhere and must land there every time.
    const result = allocate(
      money('100', 'KWD'),
      [house('A', 1), house('B', 1), house('C', 1)],
      'volume',
      KWD,
    )

    expect(sharesTotal(result).amount.toString()).toBe('100')
    expect(result.shares.map((s) => s.share.amount.toString()).sort()).toEqual([
      '33.333',
      '33.333',
      '33.334',
    ])
  })

  it('gives the odd unit to the largest fractional remainder', () => {
    // Drivers 1, 1, 1 over 100.00 USD: two cents spare across three houses.
    const result = allocate(
      money('100', 'USD'),
      [house('A', 1), house('B', 1), house('C', 1)],
      'volume',
      USD,
    )
    expect(sharesTotal(result).amount.toString()).toBe('100')
  })

  it('is reproducible regardless of how the odd unit could have fallen', () => {
    const targets = [house('A', 1), house('B', 1), house('C', 1)]
    const first = allocate(money('100', 'KWD'), targets, 'volume', KWD)
    const again = allocate(money('100', 'KWD'), targets, 'volume', KWD)

    expect(first.shares.map((s) => [s.jobId, s.share.amount.toString()])).toEqual(
      again.shares.map((s) => [s.jobId, s.share.amount.toString()]),
    )
  })

  it('never moves a share more than one minor unit from its exact entitlement', () => {
    const targets = [house('A', 7), house('B', 11), house('C', 13), house('D', 17)]
    const total = money('1000', 'KWD')
    const result = allocate(total, targets, 'volume', KWD)

    for (const share of result.shares) {
      const exact = dec(total.amount).times(share.proportion)
      expect(dec(share.share.amount).minus(exact).abs().lessThanOrEqualTo(dec('0.001'))).toBe(true)
    }
    expect(sharesTotal(result).amount.toString()).toBe('1000')
  })

  it('gives a zero-volume house nothing without failing the split', () => {
    const result = allocate(
      money('120', 'KWD'),
      [house('A', 10), house('B', 0), house('C', 10)],
      'volume',
      KWD,
    )

    expect(result.shares.map((s) => s.share.amount.toString())).toEqual(['60', '0', '60'])
  })
})

describe('bases', () => {
  const targets: AllocationTarget[] = [
    { jobId: 'A', volumeCbm: 2, grossWeightKg: 500, chargeableWeightKg: 800, packages: 10 },
    { jobId: 'B', volumeCbm: 6, grossWeightKg: 500, chargeableWeightKg: 200, packages: 30 },
  ]

  it('splits air freight by chargeable weight, not gross', () => {
    const result = allocate(money('100', 'KWD'), targets, 'chargeable_weight', KWD)
    expect(result.shares.map((s) => s.share.amount.toString())).toEqual(['80', '20'])
  })

  it('splits by gross weight where the carrier billed on it', () => {
    const result = allocate(money('100', 'KWD'), targets, 'gross_weight', KWD)
    expect(result.shares.map((s) => s.share.amount.toString())).toEqual(['50', '50'])
  })

  it('splits by packages', () => {
    const result = allocate(money('100', 'KWD'), targets, 'packages', KWD)
    expect(result.shares.map((s) => s.share.amount.toString())).toEqual(['25', '75'])
  })

  it('splits equally for a flat fee with no sensible driver', () => {
    const result = allocate(money('100', 'KWD'), targets, 'equal', KWD)
    expect(result.shares.map((s) => s.share.amount.toString())).toEqual(['50', '50'])
  })
})

describe('refusals', () => {
  it('refuses to split across no houses', () => {
    expect(() => allocate(money('100', 'KWD'), [], 'volume', KWD)).toThrow(/no houses/)
  })

  it('refuses the same job twice', () => {
    expect(() =>
      allocate(money('100', 'KWD'), [house('A', 1), house('A', 2)], 'volume', KWD),
    ).toThrow(/twice/)
  })

  it('refuses rather than splitting equally when every driver is zero', () => {
    // The tempting fallback. Splitting equally here produces a number that
    // looks considered and is not: the cargo figures were never captured.
    expect(() =>
      allocate(money('100', 'KWD'), [house('A', 0), house('B', 0)], 'volume', KWD),
    ).toThrow(/nothing to split by/)
  })

  /*
    The code and values are what the screen translates; the English above is
    for the log. Pinned separately so a reworded message cannot quietly drop
    the basis the Arabic sentence is chosen by.
  */
  it('says which basis came up empty, as data', () => {
    const refused = catchAllocation(() =>
      allocate(money('100', 'KWD'), [house('A', 0), house('B', 0)], 'volume', KWD),
    )
    expect(refused.code).toBe('allocation_zero_driver')
    expect(refused.refusal).toEqual({ code: 'allocation_zero_driver', values: { basis: 'volume' } })
  })

  it('refuses a negative driver', () => {
    expect(() =>
      allocate(money('100', 'KWD'), [house('A', -5), house('B', 5)], 'volume', KWD),
    ).toThrow(/negative/)
  })
})

describe('manual shares', () => {
  const targets = [house('A', 10), house('B', 10)]

  it('accepts a stated split that adds up', () => {
    const result = allocate(
      money('100', 'KWD'),
      targets,
      'manual',
      KWD,
      new Map([
        ['A', money('70', 'KWD')],
        ['B', money('30', 'KWD')],
      ]),
    )

    expect(result.shares.map((s) => s.share.amount.toString())).toEqual(['70', '30'])
  })

  it('refuses a stated split that does not, to the fils', () => {
    expect(() =>
      allocate(
        money('100', 'KWD'),
        targets,
        'manual',
        KWD,
        new Map([
          ['A', money('70', 'KWD')],
          ['B', money('29.999', 'KWD')],
        ]),
      ),
    ).toThrow(/but the cost is/)
  })

  it('reports the two totals as strings to the currency’s places', () => {
    const refused = catchAllocation(() =>
      allocate(
        money('100', 'KWD'),
        targets,
        'manual',
        KWD,
        new Map([
          ['A', money('70', 'KWD')],
          ['B', money('29.999', 'KWD')],
        ]),
      ),
    )
    // `100.000`, not `100` — the dinar keeps its third place on the screen.
    expect(refused.values).toEqual({ stated: '99.999', expected: '100.000', currency: 'KWD' })
  })

  it('refuses when a house has no stated share', () => {
    expect(() =>
      allocate(money('100', 'KWD'), targets, 'manual', KWD, new Map([['A', money('100', 'KWD')]])),
    ).toThrow(/No share was stated/)
  })

  it('refuses a manual basis with no shares at all', () => {
    expect(() => allocate(money('100', 'KWD'), targets, 'manual', KWD)).toThrow(/needs a share/)
  })
})

describe('reversal', () => {
  it('negates every share and still sums', () => {
    const original = allocate(
      money('300', 'KWD'),
      [house('A', 10), house('B', 6), house('C', 4)],
      'volume',
      KWD,
    )
    const reversed = reverse(original)

    expect(reversed.shares.map((s) => s.share.amount.toString())).toEqual(['-150', '-90', '-60'])
    expect(sharesTotal(reversed).amount.toString()).toBe('-300')
  })

  it('splits a credit the same way the cost it reverses was split', () => {
    const targets = [house('A', 7), house('B', 11), house('C', 13)]
    const cost = allocate(money('1000', 'KWD'), targets, 'volume', KWD)
    const credit = allocate(money('-1000', 'KWD'), targets, 'volume', KWD)

    expect(credit.shares.map((s) => s.share.amount.toString())).toEqual(
      cost.shares.map((s) => dec(s.share.amount).negated().toString()),
    )
  })
})

describe('presentation and margin', () => {
  it('explains a share in the terms the customer will argue in', () => {
    const result = allocate(money('300', 'KWD'), [house('A', 15), house('B', 5)], 'volume', KWD)
    expect(explain(result)[0]).toBe('A: 15 of 20 (75%) = 225')
  })

  it('adds a groupage margin to an allocated cost', () => {
    expect(withMargin(money('100', 'KWD'), 17.5, KWD).amount.toString()).toBe('117.5')
  })

  it('rounds the margin at the currency, not at two decimals', () => {
    // KWD carries three. A global toFixed(2) would lose the last fils here.
    expect(withMargin(money('33.333', 'KWD'), 10, KWD).amount.toString()).toBe('36.666')
  })
})
