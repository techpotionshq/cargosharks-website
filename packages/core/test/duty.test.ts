import { describe, expect, it } from 'vitest'
import {
  GCC_GENERAL_RATE_PERCENT,
  SEED_CURRENCIES,
  SEED_KW_TARIFF,
  customsValue,
  estimateDuty,
  findRate,
  isComplete,
  landedCost,
  money,
  normaliseHsCode,
  type CurrencySpec,
  type TariffLine,
} from '../src/index'

const KWD: CurrencySpec = SEED_CURRENCIES.find((c) => c.code === 'KWD')!
const on = new Date('2026-03-15T00:00:00Z')

const tariff: TariffLine[] = [
  ...SEED_KW_TARIFF,
  {
    country: 'KW',
    hsPrefix: '8703',
    ratePercent: '5',
    descriptionEn: 'Motor cars',
    effectiveFrom: '2003-01-01',
  },
  {
    country: 'KW',
    hsPrefix: '870323',
    ratePercent: '7',
    descriptionEn: 'Motor cars, spark-ignition, 1500–3000cc',
    effectiveFrom: '2025-01-01',
  },
  {
    country: 'AE',
    hsPrefix: '8703',
    ratePercent: '5',
    descriptionEn: 'Motor cars — UAE',
    effectiveFrom: '2003-01-01',
  },
]

describe('the lookup', () => {
  it('takes the longest matching prefix, not the first', () => {
    const match = findRate(tariff, 'KW', '8703239000', on)
    expect(match?.hsPrefix).toBe('870323')
    expect(match?.ratePercent).toBe('7')
  })

  it('falls back to the heading when no national line exists', () => {
    const match = findRate(tariff, 'KW', '8703100000', on)
    expect(match?.hsPrefix).toBe('8703')
  })

  it('answers at chapter level for an exemption', () => {
    expect(findRate(tariff, 'KW', '3004901000', on)?.ratePercent).toBe('0')
  })

  it("does not read another country's schedule", () => {
    expect(findRate(tariff, 'AE', '8703239000', on)?.descriptionEn).toBe('Motor cars — UAE')
  })

  it('ignores separators in the declared code', () => {
    expect(findRate(tariff, 'KW', '8703.23.90', on)?.hsPrefix).toBe('870323')
    expect(normaliseHsCode('8703.23.90')).toBe('87032390')
  })

  it('reads the tariff as it stood on the day, not as it stands now', () => {
    // The 7% national line came into force in 2025. An estimate dated 2024
    // must still answer 5%, or a dispute can never be settled.
    const before = new Date('2024-06-01T00:00:00Z')
    expect(findRate(tariff, 'KW', '8703239000', before)?.ratePercent).toBe('5')
  })

  it('ignores a rate that has since been withdrawn', () => {
    const withdrawn: TariffLine[] = [
      {
        country: 'KW',
        hsPrefix: '9999',
        ratePercent: '15',
        descriptionEn: 'Withdrawn',
        effectiveFrom: '2003-01-01',
        effectiveTo: '2025-12-31',
      },
    ]
    expect(findRate(withdrawn, 'KW', '99991111', on)).toBeUndefined()
  })

  it('finds nothing for an empty code rather than matching everything', () => {
    expect(findRate(tariff, 'KW', '', on)).toBeUndefined()
  })
})

describe('the estimate', () => {
  it('computes duty per line at the rate its own code carries', () => {
    const estimate = estimateDuty(
      [
        { hsCode: '8703239000', description: 'Motor car', value: '10000' },
        { hsCode: '3004901000', description: 'Medicines', value: '2000' },
      ],
      tariff,
      { country: 'KW', currency: 'KWD', on, spec: KWD },
    )

    expect(estimate.lines[0]!.duty.amount.toString()).toBe('700')
    expect(estimate.lines[1]!.duty.amount.toString()).toBe('0')
    expect(estimate.duty.amount.toString()).toBe('700')
    expect(estimate.customsValue.amount.toString()).toBe('12000')
  })

  it('reports an unknown code instead of guessing at it', () => {
    const estimate = estimateDuty(
      [{ hsCode: '1234567890', description: 'Something new', value: '500' }],
      tariff,
      { country: 'KW', currency: 'KWD', on, spec: KWD },
    )

    expect(estimate.unmatched).toHaveLength(1)
    expect(estimate.duty.amount.toString()).toBe('0')
    expect(isComplete(estimate)).toBe(false)
  })

  it('applies the general rate only when the caller opts in', () => {
    const estimate = estimateDuty(
      [{ hsCode: '1234567890', description: 'Something new', value: '500' }],
      tariff,
      {
        country: 'KW',
        currency: 'KWD',
        on,
        spec: KWD,
        generalRatePercent: GCC_GENERAL_RATE_PERCENT,
      },
    )

    expect(estimate.unmatched).toHaveLength(0)
    expect(estimate.duty.amount.toString()).toBe('25')
    expect(estimate.lines[0]!.matchedPrefix).toBe('')
  })

  it('carries the prefix that answered, so the number can be defended', () => {
    const estimate = estimateDuty(
      [{ hsCode: '8703239000', description: 'Motor car', value: '10000' }],
      tariff,
      { country: 'KW', currency: 'KWD', on, spec: KWD },
    )

    expect(estimate.lines[0]).toMatchObject({
      matchedPrefix: '870323',
      matchedDescription: 'Motor cars, spark-ignition, 1500–3000cc',
      ratePercent: '7',
    })
  })

  it('rounds duty at the currency, so KWD keeps its third decimal', () => {
    const estimate = estimateDuty(
      [{ hsCode: '8703100000', description: 'Motor car', value: '333.333' }],
      tariff,
      { country: 'KW', currency: 'KWD', on, spec: KWD },
    )
    expect(estimate.lines[0]!.duty.amount.toString()).toBe('16.667')
  })

  it('treats a missing code as unmatched, not as exempt', () => {
    const estimate = estimateDuty(
      [{ hsCode: null, description: 'Unclassified', value: '900' }],
      tariff,
      { country: 'KW', currency: 'KWD', on, spec: KWD },
    )
    expect(estimate.unmatched).toHaveLength(1)
  })
})

describe('customs value and landed cost', () => {
  it('assesses on CIF, not on the commercial invoice', () => {
    // The freight is most of the number on cheap LCL goods, and leaving it out
    // is how an estimate comes in low by exactly what the customer least
    // expects.
    const value = customsValue({ goods: '1000', freight: '250', insurance: '15' }, 'KWD', KWD)
    expect(value.amount.toString()).toBe('1265')
  })

  it('refuses a negative value', () => {
    expect(() => customsValue({ goods: '-10' }, 'KWD', KWD)).toThrow(/cannot be negative/)
  })

  it('adds our own charges to reach what the customer actually asked for', () => {
    const total = landedCost(
      {
        customsValue: money('1265', 'KWD'),
        duty: money('63.25', 'KWD'),
        ourCharges: money('180', 'KWD'),
      },
      KWD,
    )
    expect(total.amount.toString()).toBe('1508.25')
  })
})
