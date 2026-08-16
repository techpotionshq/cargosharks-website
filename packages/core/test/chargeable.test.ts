import { describe, expect, it } from 'vitest'
import {
  D,
  SEED_CHARGEABLE_RULES,
  chargeableWeight,
  revenueTons,
  selectBreak,
  totalVolumeCbm,
  type ChargeableRule,
} from '../src/index'

const rule = (mode: string): ChargeableRule => SEED_CHARGEABLE_RULES.find((r) => r.mode === mode)!

describe('volumetric weight', () => {
  it('bills air on volume when the cargo is light and bulky', () => {
    // 1.2 cbm of cushions: 120 kg actual, 200 kg volumetric at the 6000 divisor.
    // Exactly 200 — the divisor must not introduce a fraction that the
    // round-up to the next half kilo then inflates to 200.5.
    const result = chargeableWeight({ grossWeightKg: 120, volumeCbm: 1.2 }, rule('air'))
    expect(result.basis).toBe('volumetric')
    expect(result.chargeableKg.toFixed(1)).toBe('200.0')
  })

  it('bills air on gross when the cargo is dense', () => {
    const result = chargeableWeight({ grossWeightKg: 900, volumeCbm: 1.2 }, rule('air'))
    expect(result.basis).toBe('gross')
    expect(result.chargeableKg.toFixed(1)).toBe('900.0')
  })

  it('rounds air up to the next half kilo', () => {
    const result = chargeableWeight({ grossWeightKg: '210.2', volumeCbm: 0 }, rule('air'))
    expect(result.chargeableKg.toFixed(1)).toBe('210.5')
  })

  it('applies the mode minimum', () => {
    const result = chargeableWeight({ grossWeightKg: 3, volumeCbm: 0.01 }, rule('air'))
    expect(result.basis).toBe('minimum')
    expect(result.chargeableKg.toFixed(0)).toBe('45')
  })

  it('derives volume from piece dimensions', () => {
    const cbm = totalVolumeCbm([{ lengthCm: 120, widthCm: 100, heightCm: 100, pieces: 2 }])
    expect(cbm.toFixed(2)).toBe('2.40')
  })
})

describe('sea LCL revenue ton', () => {
  it('takes the greater of cubic metres and tonnes', () => {
    expect(revenueTons({ grossWeightKg: 800, volumeCbm: 3 }).toFixed(2)).toBe('3.00')
    expect(revenueTons({ grossWeightKg: 5200, volumeCbm: 3 }).toFixed(2)).toBe('5.20')
  })
})

describe('weight breaks pick the cheapest total, not the matching band', () => {
  const breaks = [
    { fromKg: new D(45), ratePerKg: new D('1.100') },
    { fromKg: new D(100), ratePerKg: new D('0.850') },
    { fromKg: new D(300), ratePerKg: new D('0.720') },
  ]

  it('declares up to the next break where that costs less', () => {
    // 95 kg at 1.100 = 104.50; 100 kg at 0.850 = 85.00. The customer is billed 85.
    const selected = selectBreak(new D(95), breaks, 'USD')!
    expect(selected.billedKg.toFixed(0)).toBe('100')
    expect(selected.amount.amount.toFixed(2)).toBe('85.00')
    expect(selected.roundedUpToBreak).toBe(true)
  })

  it('uses the actual weight where its own band is cheapest', () => {
    const selected = selectBreak(new D(150), breaks, 'USD')!
    expect(selected.billedKg.toFixed(0)).toBe('150')
    expect(selected.amount.amount.toFixed(2)).toBe('127.50')
    expect(selected.roundedUpToBreak).toBe(false)
  })

  it('returns null where the card has no breaks', () => {
    expect(selectBreak(new D(150), [], 'USD')).toBeNull()
  })
})
