import { describe, expect, it } from 'vitest'
import {
  D,
  MissingChargeContextError,
  applyMargin,
  calcCharge,
  fxRate,
  money,
  priceLines,
  seedCurrencyLookup,
  summariseMargin,
  toDb,
  type PriceInput,
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
    expect(
      toDb(applyMargin(cost, { kind: 'absolute', value: new D('80'), currency: 'KWD' })),
    ).toBe('1080')
  })

  it('target sell', () => {
    expect(
      toDb(applyMargin(cost, { kind: 'target_sell', value: new D('1200'), currency: 'KWD' })),
    ).toBe('1200')
  })
})
