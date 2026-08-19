import { describe, expect, it } from 'vitest'
import {
  D,
  SEED_CHARGEABLE_RULES,
  chargeableWeight,
  kgPerCbm,
  money,
  revenueTons,
  selectBreak,
  totalVolumeCbm,
  volumeCbm,
  withMinimum,
  type ChargeableRule,
  type WeightBreak,
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

describe('the divisor as a rate sheet states it', () => {
  /**
   * Stored as cubic centimetres per kilogram and converted only for display.
   * Air's 6000 divisor is 166.666… kg per cbm, and any decimal approximation
   * of it makes a clean 1.2 cbm consignment weigh 200.00004 kg — which the
   * round-up to the next half kilo then turns into 200.5.
   */
  it('states kilograms per cubic metre for a mode that has a divisor', () => {
    expect(kgPerCbm(rule('air'))!.toFixed(2)).toBe('166.67')
    expect(kgPerCbm(rule('sea_lcl'))!.toFixed(0)).toBe('1000')
  })

  /** FCL is billed per container; volume never enters the calculation. */
  it('has none for a mode billed by the box', () => {
    expect(kgPerCbm(rule('sea_fcl'))).toBeNull()
  })
})

describe('volume from the pieces as booked', () => {
  it('multiplies by the piece count where one is given', () => {
    const one = volumeCbm({ lengthCm: 100, widthCm: 100, heightCm: 100 })
    const ten = volumeCbm({ lengthCm: 100, widthCm: 100, heightCm: 100, pieces: 10 })

    expect(one.toFixed(3)).toBe('1.000')
    expect(ten.toFixed(3)).toBe('10.000')
  })

  /** A booking with no pieces listed has no volume, not a volume of zero cbm
   *  per piece times some assumed count. */
  it('is nothing for a consignment with no pieces listed', () => {
    expect(totalVolumeCbm([]).toFixed()).toBe('0')
  })
})

describe('the cases the volumetric rule has to survive', () => {
  /**
   * FCL has no divisor at all, so the volumetric side is zero and the gross
   * weight always wins. Deriving one anyway would put a made-up figure on a
   * container shipment that is billed per box.
   */
  it('ignores volume entirely for a mode billed by the box', () => {
    const result = chargeableWeight({ grossWeightKg: '18000', volumeCbm: '60' }, rule('sea_fcl'))

    expect(result.volumetricKg.toFixed()).toBe('0')
    expect(result.chargeableKg.toFixed()).toBe('18000')
    expect(result.basis).toBe('gross')
  })

  it('derives the volume from the pieces where none was given directly', () => {
    const result = chargeableWeight(
      { grossWeightKg: '100', pieces: [{ lengthCm: 120, widthCm: 100, heightCm: 100, pieces: 1 }] },
      rule('air'),
    )

    // 1.2 cbm at the 6000 divisor is exactly 200 kg — not 200.00004, which the
    // round-up would turn into 200.5.
    expect(result.volumeCbm.toFixed(3)).toBe('1.200')
    expect(result.chargeableKg.toFixed()).toBe('200')
  })

  /** A consignment with neither is not an error; it is a booking still empty. */
  it('answers zero for a consignment with no volume and no pieces', () => {
    const result = chargeableWeight({ grossWeightKg: '0' }, rule('air'))

    expect(result.volumeCbm.toFixed()).toBe('0')
    // Still floored at the mode's minimum, which is the figure that gets rated.
    expect(result.chargeableKg.toFixed()).toBe('45')
    expect(result.basis).toBe('minimum')
  })

  /**
   * `land` rounds to whole kilograms and has no minimum at all, so the arm
   * where the floor does *not* fire is exercised by a real seeded mode rather
   * than a hypothetical one.
   */
  it('applies no floor where the mode has none', () => {
    const result = chargeableWeight({ grossWeightKg: '0.4', volumeCbm: '0' }, rule('land'))

    expect(result.chargeableKg.toFixed()).toBe('1')
    expect(result.basis).toBe('gross')
  })
})

describe('the revenue ton', () => {
  it('takes tonnes where the cargo is dense', () => {
    expect(revenueTons({ grossWeightKg: '12000', volumeCbm: '4' }).toFixed()).toBe('12')
  })

  it('derives the volume from the pieces where none was given', () => {
    const tons = revenueTons({
      grossWeightKg: '500',
      pieces: [{ lengthCm: 200, widthCm: 100, heightCm: 100, pieces: 2 }],
    })

    // 4 cbm against half a tonne — measure wins, which is the usual LCL case.
    expect(tons.toFixed()).toBe('4')
  })
})

describe('weight breaks, at the edges', () => {
  const currency = 'USD'
  const brk = (from: string, rate: string, minimum?: string): WeightBreak => ({
    fromKg: new D(from),
    ratePerKg: new D(rate),
    ...(minimum ? { minimumCharge: new D(minimum) } : {}),
  })

  /**
   * The band a weight sits in is the *highest* break at or below it. Without
   * that, a 500 kg shipment would also be priced against the +45 and +100
   * bands and quoted at whichever came out lowest — which is not a discount,
   * it is a rate the airline will not honour.
   */
  it('prices against the highest band the weight reaches, not every band below', () => {
    const chosen = selectBreak(
      new D('500'),
      [brk('45', '2.00'), brk('100', '1.50'), brk('300', '1.20')],
      currency,
    )

    expect(chosen!.appliedBreak.fromKg.toFixed()).toBe('300')
    expect(chosen!.billedKg.toFixed()).toBe('500')
    expect(chosen!.roundedUpToBreak).toBe(false)
  })

  /** A minimum charge on the band is a floor under the whole line. */
  it('applies a break’s own minimum charge where the rate falls under it', () => {
    const chosen = selectBreak(new D('10'), [brk('0', '2.00', '75.00')], currency)

    expect(chosen!.amount.amount.toFixed()).toBe('75')
    expect(chosen!.amount.currency).toBe('USD')
  })

  it('leaves a break’s minimum alone where the rate already clears it', () => {
    const chosen = selectBreak(new D('100'), [brk('0', '2.00', '75.00')], currency)

    expect(chosen!.amount.amount.toFixed()).toBe('200')
  })

  /** Unsorted rows out of the rate card must not change the answer. */
  it('reads the breaks in weight order however they were stored', () => {
    const breaks = [brk('300', '1.20'), brk('45', '2.00'), brk('100', '1.50')]

    const forwards = selectBreak(new D('120'), breaks, currency)
    const backwards = selectBreak(new D('120'), [...breaks].reverse(), currency)

    expect(forwards!.appliedBreak.fromKg.toFixed()).toBe(backwards!.appliedBreak.fromKg.toFixed())
    expect(forwards!.amount.amount.toFixed()).toBe(backwards!.amount.amount.toFixed())
  })

  /** A shipment lighter than every break can only declare upwards. */
  it('declares up to the lowest break for a shipment under all of them', () => {
    const chosen = selectBreak(new D('20'), [brk('45', '2.00'), brk('100', '1.50')], currency)

    expect(chosen!.billedKg.toFixed()).toBe('45')
    expect(chosen!.roundedUpToBreak).toBe(true)
    expect(chosen!.amount.amount.toFixed()).toBe('90')
  })
})

describe('a floor expressed as money', () => {
  it('raises a line that came out under it, and leaves one that did not', () => {
    expect(withMinimum(money('12.000', 'KWD'), money('25.000', 'KWD')).amount.toFixed()).toBe('25')
    expect(withMinimum(money('80.000', 'KWD'), money('25.000', 'KWD')).amount.toFixed()).toBe('80')
  })

  it('changes nothing where the charge type configures none', () => {
    expect(withMinimum(money('12.000', 'KWD'), null).amount.toFixed()).toBe('12')
    expect(withMinimum(money('12.000', 'KWD'), undefined).amount.toFixed()).toBe('12')
  })
})
