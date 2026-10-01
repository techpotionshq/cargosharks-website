import { describe, expect, it } from 'vitest'
import {
  D,
  MissingChargeContextError,
  UnknownCurrencyError,
  applyMargin,
  calcCharge,
  distributeMargin,
  emptyMargin,
  fxRate,
  money,
  priceLine,
  priceLines,
  seedCurrencyLookup,
  summariseMargin,
  toDb,
  type Basis,
  type PriceInput,
  type RateLine,
} from '../src/index'

describe('the six bases (FR-RT-05)', () => {
  it('flat', () => {
    expect(toDb(calcCharge({ basis: 'flat', rate: new D('25'), currency: 'KWD' }))).toBe('25')
  })

  it('per_unit', () => {
    const line = { basis: 'per_unit' as const, rate: new D('3.500'), currency: 'KWD' }
    expect(toDb(calcCharge(line, { units: 4 }))).toBe('14')
  })

  it('per_kg with a minimum', () => {
    const line = {
      basis: 'per_kg' as const,
      rate: new D('0.250'),
      currency: 'KWD',
      minimum: new D('30'),
    }
    expect(toDb(calcCharge(line, { kg: 40 }))).toBe('30')
    expect(toDb(calcCharge(line, { kg: 400 }))).toBe('100')
  })

  it('per_container', () => {
    const line = { basis: 'per_container' as const, rate: new D('45'), currency: 'USD' }
    expect(toDb(calcCharge(line, { containers: 3 }))).toBe('135')
  })

  it('per_day', () => {
    const line = { basis: 'per_day' as const, rate: new D('12.5'), currency: 'USD' }
    expect(toDb(calcCharge(line, { days: 6 }))).toBe('75')
  })

  it('percent takes the currency of the base it applies to', () => {
    const line = { basis: 'percent' as const, rate: new D('15'), currency: 'KWD' }
    const result = calcCharge(line, { of: money('1000', 'USD') })
    expect(result.currency).toBe('USD')
    expect(toDb(result)).toBe('150')
  })

  it('refuses to treat missing context as zero', () => {
    const line = { basis: 'per_kg' as const, rate: new D('0.25'), currency: 'KWD' }
    expect(() => calcCharge(line)).toThrow(MissingChargeContextError)
  })
})

describe('pricing a set of lines', () => {
  const opts = {
    baseCurrency: 'KWD',
    fxRates: [fxRate('USD', 'KWD', '0.30650', new Date('2026-03-04T09:00:00Z'))],
    currencies: seedCurrencyLookup,
    pricedAt: new Date('2026-03-04T09:00:00Z'),
  }

  const inputs: readonly PriceInput[] = [
    {
      chargeTypeKey: 'ocean_freight',
      direction: 'cost',
      line: { basis: 'per_container', rate: new D('1450'), currency: 'USD' },
      ctx: { containers: 2 },
    },
    {
      chargeTypeKey: 'ocean_freight',
      direction: 'revenue',
      line: { basis: 'per_container', rate: new D('1680'), currency: 'USD' },
      ctx: { containers: 2 },
    },
    {
      chargeTypeKey: 'documentation',
      direction: 'revenue',
      line: { basis: 'flat', rate: new D('15.000'), currency: 'KWD' },
    },
  ]

  it('stamps the rate on every line and totals in the base currency', () => {
    const lines = priceLines(inputs, opts)
    expect(lines.every((l) => l.fx.takenAt.getTime() === opts.pricedAt.getTime())).toBe(true)

    const margin = summariseMargin(lines, 'KWD')
    // `toDb` emits the canonical decimal string; numeric(19,6) applies scale.
    expect(toDb(margin.cost)).toBe('888.85')
    expect(toDb(margin.revenue)).toBe('1044.84')
    expect(toDb(margin.gross)).toBe('155.99')
    expect(margin.grossPercent!.toFixed(2)).toBe('14.93')
  })
})

describe('margin rules', () => {
  const cost = money('1000', 'KWD')

  it('percent', () => {
    expect(toDb(applyMargin(cost, { kind: 'percent', value: new D('12.5') }))).toBe('1125')
  })

  it('absolute', () => {
    expect(toDb(applyMargin(cost, { kind: 'absolute', value: new D('80'), currency: 'KWD' }))).toBe(
      '1080',
    )
  })

  it('target sell', () => {
    expect(
      toDb(applyMargin(cost, { kind: 'target_sell', value: new D('1200'), currency: 'KWD' })),
    ).toBe('1200')
  })
})

describe('distributeMargin — the house margin over a whole quotation (R2)', () => {
  const kwd = (v: string) => money(v, 'KWD')
  const amounts = (lines: ReturnType<typeof distributeMargin>) => lines.map((l) => toDb(l))
  const total = (lines: ReturnType<typeof distributeMargin>) =>
    toDb(lines.reduce((a, b) => money(a.amount.plus(b.amount), 'KWD'), kwd('0')))

  it('rounds each percent line before the total, so the lines add up to it', () => {
    // 1.234 × 1.1 = 1.3574 each. Rounded per line: 1.357 × 3 = 4.071 — and
    // that, not the 4.072 of the rounded sum, is the quotation's total.
    const lines = distributeMargin(
      [kwd('1.234'), kwd('1.234'), kwd('1.234')],
      { kind: 'percent', value: new D('10') },
      seedCurrencyLookup,
    )
    expect(amounts(lines)).toEqual(['1.357', '1.357', '1.357'])
    expect(total(lines)).toBe('4.071')
  })

  it('applies a target sell once to the quotation, not once per line', () => {
    // Six lines under a 500 KWD target used to quote 3,000.
    const lines = distributeMargin(
      Array.from({ length: 6 }, () => kwd('50')),
      { kind: 'target_sell', value: new D('500'), currency: 'KWD' },
      seedCurrencyLookup,
    )
    expect(total(lines)).toBe('500')
    expect(lines).toHaveLength(6)
  })

  it('adds an absolute uplift once, shared in proportion to cost', () => {
    const lines = distributeMargin(
      [kwd('300'), kwd('100')],
      { kind: 'absolute', value: new D('80'), currency: 'KWD' },
      seedCurrencyLookup,
    )
    expect(amounts(lines)).toEqual(['360', '120'])
  })

  it('puts the rounding remainder on the largest line', () => {
    const odd = distributeMargin(
      [kwd('1'), kwd('1'), kwd('1.001')],
      { kind: 'target_sell', value: new D('1'), currency: 'KWD' },
      seedCurrencyLookup,
    )
    expect(total(odd)).toBe('1')
    expect(amounts(odd)).toEqual(['0.333', '0.333', '0.334'])
  })

  it('refuses an absolute rule in another currency rather than add dollars to dinars', () => {
    expect(() =>
      distributeMargin(
        [kwd('100')],
        { kind: 'absolute', value: new D('10'), currency: 'USD' },
        seedCurrencyLookup,
      ),
    ).toThrow()
  })
})

describe('the floor and the cap', () => {
  const line = (over: Partial<RateLine> = {}): RateLine => ({
    basis: 'per_kg',
    rate: new D('0.850'),
    currency: 'KWD',
    ...over,
  })

  /**
   * Both are optional on the row, and the arms where they are absent matter as
   * much as the arms where they fire: a charge type with no cap configured
   * must not be capped at anything, and one with no floor must not be raised.
   */
  it('leaves a charge alone where neither is configured', () => {
    expect(toDb(calcCharge(line(), { kg: 1000 }))).toBe('850')
  })

  it('caps a charge that ran over the maximum', () => {
    expect(toDb(calcCharge(line({ maximum: new D('500') }), { kg: 1000 }))).toBe('500')
  })

  it('leaves a charge that came in under the maximum', () => {
    expect(toDb(calcCharge(line({ maximum: new D('5000') }), { kg: 1000 }))).toBe('850')
  })

  /** Floor first, then cap — a floor above the cap is a configuration fault. */
  it('applies the floor before the cap', () => {
    const capped = calcCharge(line({ minimum: new D('900'), maximum: new D('700') }), { kg: 1 })

    expect(toDb(capped)).toBe('700')
  })
})

describe('a basis without the figure it needs', () => {
  /**
   * Refused rather than defaulted, on every basis. Treating a missing weight
   * as zero prices the shipment at nothing and it goes out of the door — the
   * only failure here that costs money rather than time.
   */
  it('names the basis and the field it wanted', () => {
    expect(() => calcCharge({ basis: 'per_unit', rate: new D('1'), currency: 'KWD' })).toThrow(
      MissingChargeContextError,
    )
    expect(() => calcCharge({ basis: 'per_container', rate: new D('1'), currency: 'KWD' })).toThrow(
      MissingChargeContextError,
    )
    expect(() => calcCharge({ basis: 'per_day', rate: new D('1'), currency: 'KWD' })).toThrow(
      MissingChargeContextError,
    )
    expect(() => calcCharge({ basis: 'percent', rate: new D('5'), currency: 'KWD' })).toThrow(
      MissingChargeContextError,
    )
  })

  /** `null` is what a form hands back for an empty field, and it is not zero. */
  it('treats a null figure the same as a missing one', () => {
    expect(() =>
      calcCharge({ basis: 'per_kg', rate: new D('1'), currency: 'KWD' }, { kg: null as never }),
    ).toThrow(MissingChargeContextError)
  })
})

describe('the quantity written onto the line', () => {
  const opts = {
    baseCurrency: 'KWD',
    fxRates: [fxRate('USD', 'KWD', '0.30650', new Date('2026-03-04T09:00:00Z'))],
    currencies: seedCurrencyLookup,
    pricedAt: new Date('2026-03-04T09:00:00Z'),
  }

  const priced = (basis: Basis, ctx?: Record<string, unknown>) =>
    priceLine(
      {
        chargeTypeKey: 'test',
        direction: 'cost',
        line: { basis, rate: new D('10'), currency: 'KWD' },
        ...(ctx ? { ctx: ctx as never } : {}),
      },
      opts,
    )

  it('is the figure the basis consumed', () => {
    expect(priced('per_unit', { units: 7 }).quantity.toFixed()).toBe('7')
    expect(priced('per_kg', { kg: '1250.500' }).quantity.toFixed()).toBe('1250.5')
    expect(priced('per_container', { containers: 3 }).quantity.toFixed()).toBe('3')
    expect(priced('per_day', { days: 12 }).quantity.toFixed()).toBe('12')
  })

  /**
   * One for a flat line, because the charge column reads `quantity × rate` and
   * a blank quantity beside a figure looks like a missing number rather than
   * an inapplicable one.
   */
  it('is one for a flat line and for a percentage', () => {
    expect(priced('flat').quantity.toFixed()).toBe('1')
    expect(priced('percent', { of: money('100.000', 'KWD') }).quantity.toFixed()).toBe('1')
  })
})

describe('the rate stamped on a priced line', () => {
  const at = new Date('2026-03-04T09:00:00Z')
  const opts = {
    baseCurrency: 'KWD',
    fxRates: [fxRate('USD', 'KWD', '0.30650', at)],
    currencies: seedCurrencyLookup,
    pricedAt: at,
  }

  const input: PriceInput = {
    chargeTypeKey: 'documentation',
    direction: 'revenue',
    line: { basis: 'flat', rate: new D('15.000'), currency: 'KWD' },
  }

  /** So a base-currency line carries a rate like every other line. */
  it('is the identity rate for a line already in the base currency', () => {
    const line = priceLine(input, opts)

    expect(line.fx.rate.toFixed()).toBe('1')
    expect(line.fx.takenAt).toBe(at)
    expect(toDb(line.amountInBase)).toBe('15')
  })

  /**
   * Refused, not assumed to be one. A missing rate silently treated as parity
   * prices a USD line as though a dollar were a dinar — about three times the
   * real figure, on a document nobody would question.
   */
  it('refuses a foreign line with no rate supplied for it', () => {
    expect(() =>
      priceLine({ ...input, line: { basis: 'flat', rate: new D('100'), currency: 'EUR' } }, opts),
    ).toThrow(UnknownCurrencyError)
  })

  it('refuses a currency the deployment never described', () => {
    expect(() =>
      priceLine({ ...input, line: { basis: 'flat', rate: new D('100'), currency: 'XYZ' } }, opts),
    ).toThrow(UnknownCurrencyError)
  })

  it('refuses a base currency the deployment never described', () => {
    expect(() => priceLine(input, { ...opts, baseCurrency: 'XYZ' })).toThrow(UnknownCurrencyError)
  })
})

describe('the job P&L', () => {
  /**
   * Null rather than zero or infinity. A job with cost and no revenue yet has
   * no margin percentage — it is not a hundred per cent loss, it is a figure
   * that does not exist until something is billed, and the screen says so.
   */
  it('has no margin percentage until something is billed', () => {
    const summary = summariseMargin(
      [{ direction: 'cost', amountInBase: money('500.000', 'KWD') }],
      'KWD',
    )

    expect(toDb(summary.revenue)).toBe('0')
    expect(toDb(summary.gross)).toBe('-500')
    expect(summary.grossPercent).toBeNull()
  })

  it('is zero in the branch’s currency for a job with nothing on it', () => {
    const summary = summariseMargin([], 'KWD')

    expect(summary).toEqual(emptyMargin('KWD'))
    expect(emptyMargin('KWD').cost.currency).toBe('KWD')
  })
})
