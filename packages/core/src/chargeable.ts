/**
 * Chargeable quantity — volumetric divisors, break points, minimums.
 *
 * Freight is not billed on what a shipment weighs. It is billed on the greater
 * of weight and volume, converted by a divisor that differs per mode, then
 * rounded up to the mode's increment, then floored at a minimum. Every rating
 * decision downstream depends on this number being right.
 *
 * The divisors themselves are configuration rows (FR-AD-03), not constants —
 * an airline that moves from a 6000 to a 5000 divisor is an admin edit.
 */

import { D, dec, type Money, type Numeric, max as maxMoney, money } from './money'
import type { Decimal } from 'decimal.js'

export type Mode = 'sea_fcl' | 'sea_lcl' | 'air' | 'land' | 'courier'

/**
 * Mirrors a `chargeable_rules` row.
 *
 * The rule is stored as the industry states it — a divisor in cubic
 * centimetres per kilogram — not as a pre-computed kilograms-per-cbm factor.
 * The distinction is not cosmetic: air's 6000 divisor is 166.666… kg per cbm,
 * and any decimal approximation of it makes a clean 1.2 cbm consignment weigh
 * 200.00004 kg, which the round-up to the next half kilo then turns into 200.5.
 * Dividing by 6000 keeps it at 200.
 */
export interface ChargeableRule {
  readonly mode: Mode
  /** Cubic centimetres deemed to weigh one kilogram. Null for FCL. */
  readonly divisorCm3PerKg: Decimal | null
  /** Round the result up to this increment. Air is 0.5 kg; sea LCL 0.001. */
  readonly roundUpToKg: Decimal
  /** Floor. Air consignments are rarely billed under 45 kg. */
  readonly minimumKg: Decimal
}

export const SEED_CHARGEABLE_RULES: readonly ChargeableRule[] = [
  // 6000 cm³/kg — the IATA divisor, 166.67 kg per cbm.
  {
    mode: 'air',
    divisorCm3PerKg: new D('6000'),
    roundUpToKg: new D('0.5'),
    minimumKg: new D('45'),
  },
  // 1000 cm³/kg — the revenue ton, one cbm to one tonne.
  {
    mode: 'sea_lcl',
    divisorCm3PerKg: new D('1000'),
    roundUpToKg: new D('0.001'),
    minimumKg: new D('1000'),
  },
  { mode: 'land', divisorCm3PerKg: new D('3000'), roundUpToKg: new D('1'), minimumKg: new D('0') },
  {
    mode: 'courier',
    divisorCm3PerKg: new D('5000'),
    roundUpToKg: new D('0.5'),
    minimumKg: new D('0.5'),
  },
  // FCL is billed per container; volume never enters the calculation.
  { mode: 'sea_fcl', divisorCm3PerKg: null, roundUpToKg: new D('1'), minimumKg: new D('0') },
]

/** Kilograms one cubic metre is deemed to weigh, for display on a rate sheet. */
export function kgPerCbm(rule: ChargeableRule): Decimal | null {
  return rule.divisorCm3PerKg ? new D(1_000_000).dividedBy(rule.divisorCm3PerKg) : null
}

export interface Dimensions {
  readonly lengthCm: Numeric
  readonly widthCm: Numeric
  readonly heightCm: Numeric
  readonly pieces?: number
}

/** Cubic metres from a piece's dimensions. */
export function volumeCbm(d: Dimensions): Decimal {
  const pieces = dec(d.pieces ?? 1)
  return dec(d.lengthCm)
    .times(dec(d.widthCm))
    .times(dec(d.heightCm))
    .times(pieces)
    .dividedBy(1_000_000)
}

export function totalVolumeCbm(pieces: readonly Dimensions[]): Decimal {
  return pieces.reduce<Decimal>((acc, p) => acc.plus(volumeCbm(p)), new D(0))
}

export interface Consignment {
  readonly grossWeightKg: Numeric
  /** Supply either the volume directly or the piece dimensions. */
  readonly volumeCbm?: Numeric
  readonly pieces?: readonly Dimensions[]
}

export interface ChargeableWeight {
  readonly grossKg: Decimal
  readonly volumetricKg: Decimal
  readonly chargeableKg: Decimal
  /** Which of the two won, or whether the minimum did. */
  readonly basis: 'gross' | 'volumetric' | 'minimum'
  readonly volumeCbm: Decimal
}

function roundUpTo(value: Decimal, increment: Decimal): Decimal {
  if (increment.lessThanOrEqualTo(0)) return value
  return value.dividedBy(increment).ceil().times(increment)
}

/**
 * The greater of actual and volumetric weight, rounded up to the mode's
 * increment, floored at the mode's minimum.
 */
export function chargeableWeight(c: Consignment, rule: ChargeableRule): ChargeableWeight {
  const grossKg = dec(c.grossWeightKg)
  const cbm = c.volumeCbm !== undefined ? dec(c.volumeCbm) : totalVolumeCbm(c.pieces ?? [])
  const volumetricKg = rule.divisorCm3PerKg
    ? cbm.times(1_000_000).dividedBy(rule.divisorCm3PerKg)
    : new D(0)

  const greater = volumetricKg.greaterThan(grossKg) ? volumetricKg : grossKg
  const rounded = roundUpTo(greater, rule.roundUpToKg)
  const chargeable = rounded.lessThan(rule.minimumKg) ? rule.minimumKg : rounded

  const basis: ChargeableWeight['basis'] =
    chargeable.equals(rule.minimumKg) && rule.minimumKg.greaterThan(rounded)
      ? 'minimum'
      : volumetricKg.greaterThan(grossKg)
        ? 'volumetric'
        : 'gross'

  return { grossKg, volumetricKg, chargeableKg: chargeable, basis, volumeCbm: cbm }
}

/**
 * Sea LCL bills the revenue ton: whichever of cubic metres and metric tonnes
 * is greater, "weight or measure". Kept separate from `chargeableWeight`
 * because the unit is not kilograms and pretending otherwise invites a rate
 * applied against the wrong quantity.
 */
export function revenueTons(c: Consignment): Decimal {
  const tonnes = dec(c.grossWeightKg).dividedBy(1000)
  const cbm = c.volumeCbm !== undefined ? dec(c.volumeCbm) : totalVolumeCbm(c.pieces ?? [])
  return cbm.greaterThan(tonnes) ? cbm : tonnes
}

// --- break points ----------------------------------------------------------

/**
 * A weight break from a rate card line: "+100 kg at 0.850, +300 kg at 0.720".
 * `fromKg` is inclusive.
 */
export interface WeightBreak {
  readonly fromKg: Decimal
  readonly ratePerKg: Decimal
  readonly minimumCharge?: Decimal
}

export interface BreakSelection {
  readonly appliedBreak: WeightBreak
  /** May exceed the shipment's own weight — see below. */
  readonly billedKg: Decimal
  readonly amount: Money
  /** True where it is cheaper to declare up to the next break's threshold. */
  readonly roundedUpToBreak: boolean
}

/**
 * Picks the break that produces the lowest total, not merely the break the
 * weight falls into.
 *
 * A 95 kg air shipment at the +45 rate can cost more than declaring 100 kg at
 * the +100 rate. Airlines and forwarders bill the lower of the two, and a
 * quote that does not is visibly wrong to the customer. Evaluating every break
 * at `max(actualWeight, break.fromKg)` and taking the cheapest is the whole
 * rule.
 */
export function selectBreak(
  chargeableKg: Decimal,
  breaks: readonly WeightBreak[],
  currency: string,
): BreakSelection | null {
  const applicable = [...breaks].sort((a, b) => a.fromKg.comparedTo(b.fromKg))
  if (applicable.length === 0) return null

  let best: BreakSelection | null = null

  for (const brk of applicable) {
    // A break below the shipment's weight is only usable if it is the band the
    // weight falls into; a break above it is usable by declaring up to it.
    const billedKg = chargeableKg.greaterThan(brk.fromKg) ? chargeableKg : brk.fromKg
    const isBandForWeight = chargeableKg.greaterThanOrEqualTo(brk.fromKg)
    const isReachableUpwards = brk.fromKg.greaterThan(chargeableKg)
    if (!isBandForWeight && !isReachableUpwards) continue

    // The band a weight sits in is the highest break at or below it.
    if (isBandForWeight) {
      const higherBandExists = applicable.some(
        (other) =>
          other.fromKg.greaterThan(brk.fromKg) && chargeableKg.greaterThanOrEqualTo(other.fromKg),
      )
      if (higherBandExists) continue
    }

    const raw = billedKg.times(brk.ratePerKg)
    const amount = brk.minimumCharge && raw.lessThan(brk.minimumCharge) ? brk.minimumCharge : raw
    const candidate: BreakSelection = {
      appliedBreak: brk,
      billedKg,
      amount: money(amount, currency),
      roundedUpToBreak: brk.fromKg.greaterThan(chargeableKg),
    }
    if (!best || candidate.amount.amount.lessThan(best.amount.amount)) best = candidate
  }

  return best
}

/** Applies a floor expressed as money — the `minimum` column on a rate line. */
export function withMinimum(amount: Money, minimum: Money | null | undefined): Money {
  return minimum ? maxMoney(amount, minimum) : amount
}
