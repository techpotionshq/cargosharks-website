/**
 * Splitting a master cost across the houses under it — the groupage engine.
 *
 * A consolidator buys one ocean freight, one terminal handling, one customs
 * entry, and sells twenty house bills. Per-job profitability is a fiction
 * until that one cost lands on those twenty jobs, and it is *only* the
 * allocation that decides whether the margin on house eleven is real.
 *
 * Three properties matter, in this order.
 *
 * **It sums.** The shares add up to the master cost exactly, to the last fils.
 * Not approximately, not after a rounding line: exactly. A split that loses
 * 0.003 KWD twenty times a week produces a cost account nobody can reconcile,
 * and the reconciliation is somebody's Thursday for the rest of the year.
 *
 * **It is reproducible.** The same cost over the same houses gives the same
 * shares every time, on every machine, in any order the rows arrive in. That
 * is why the remainder rule below is deterministic rather than "spread it
 * around" — an allocation that varies by input order cannot be re-run to
 * defend a number six months later.
 *
 * **It is explainable.** Every share carries the driver it was computed from
 * and the proportion that produced it, because the question is never "what is
 * the number" — it is "why is it 62.400 and not 58.000", asked by a customer
 * who has their own CBM figure.
 *
 * ## The remainder rule
 *
 * Exact proportional shares almost never land on whole minor units. 100.000
 * KWD across three equal houses is 33.333 each and one fils left over.
 * Dropping it loses money; giving it to everybody creates it. So: floor every
 * share to the currency's minor unit, then hand the remaining units out one at
 * a time to the largest fractional remainders, ties broken by driver size and
 * then by position.
 *
 * This is the largest-remainder method, and it is the same rule parliaments
 * use to turn vote shares into seats. It is not a rounding convenience — it is
 * the only distribution that both sums exactly and never gives a house a share
 * more than one minor unit away from its exact entitlement.
 */

import { D, add, dec, money, multiply, negate, round, sum, zero } from './money'
import type { CurrencySpec, Money, Numeric } from './money'
import { DomainError } from './errors'
import type { Decimal } from 'decimal.js'

/**
 * How the split is driven. Mirrors the `allocation_basis` enum in 0012, and
 * every value except `manual` is a number the system already holds per house —
 * which is what makes an allocation auditable rather than negotiable.
 */
export type AllocationBasis =
  'chargeable_weight' | 'volume' | 'gross_weight' | 'packages' | 'equal' | 'manual'

/** One house, and the figures any basis might read from it. */
export interface AllocationTarget {
  readonly jobId: string
  readonly chargeableWeightKg?: Numeric | null
  readonly volumeCbm?: Numeric | null
  readonly grossWeightKg?: Numeric | null
  readonly packages?: number | null
}

export interface AllocationShare {
  readonly jobId: string
  readonly share: Money
  /** The figure this house contributed to the basis — 12.5 CBM, 840 kg. */
  readonly driver: Decimal
  /** driver ÷ total driver, before rounding. Printed as the explanation. */
  readonly proportion: Decimal
}

export interface Allocation {
  readonly basis: AllocationBasis
  readonly total: Money
  readonly driverTotal: Decimal
  readonly shares: readonly AllocationShare[]
}

export class AllocationError extends DomainError {
  constructor(code: string, message: string) {
    super(code, message)
  }
}

/**
 * The figure a basis reads from a house.
 *
 * `equal` and `manual` return 1 so the caller does not special-case them: an
 * equal split is a proportional split where every driver is the same, and a
 * manual split does not consult a driver at all but still reports one so the
 * shape of the result never changes.
 */
export function driverFor(target: AllocationTarget, basis: AllocationBasis): Decimal {
  switch (basis) {
    case 'chargeable_weight':
      return dec(target.chargeableWeightKg ?? 0)
    case 'volume':
      return dec(target.volumeCbm ?? 0)
    case 'gross_weight':
      return dec(target.grossWeightKg ?? 0)
    case 'packages':
      return dec(target.packages ?? 0)
    case 'equal':
    case 'manual':
      return D(1)
  }
}

/**
 * Divide `total` across `targets`.
 *
 * `manual` requires `shares` — one entry per house, summing to the total. The
 * check is the point of allowing it at all: an operator who states the split
 * by hand is overriding the cargo figures, and the one thing they must not be
 * able to do is state a split that does not add up.
 */
export function allocate(
  total: Money,
  targets: readonly AllocationTarget[],
  basis: AllocationBasis,
  spec: CurrencySpec,
  manualShares?: ReadonlyMap<string, Money>,
): Allocation {
  if (targets.length === 0) {
    throw new AllocationError('allocation_no_targets', 'A cost cannot be split across no houses')
  }

  const duplicate = findDuplicate(targets.map((t) => t.jobId))
  if (duplicate) {
    throw new AllocationError(
      'allocation_duplicate_target',
      `Job ${duplicate} appears twice in the same allocation`,
    )
  }

  if (basis === 'manual') {
    return manualAllocation(total, targets, spec, manualShares)
  }

  const drivers = targets.map((t) => driverFor(t, basis))

  if (drivers.some((d) => d.isNegative())) {
    throw new AllocationError(
      'allocation_negative_driver',
      `A negative ${basis.replace('_', ' ')} cannot drive an allocation`,
    )
  }

  const driverTotal = drivers.reduce((acc, d) => acc.plus(d), D(0))

  /*
    Refused rather than fallen back on.

    Every house showing zero CBM means the cargo figures have not been
    captured, and quietly splitting equally would produce a number that looks
    considered and is not. `equal` is available and is one word — the operator
    should have to choose it.
  */
  if (driverTotal.isZero()) {
    throw new AllocationError(
      'allocation_zero_driver',
      `Every house has a zero ${basis.replace('_', ' ')}, so there is nothing to split by. ` +
        'Capture the cargo figures, or allocate equally.',
    )
  }

  const shares = largestRemainder(total, drivers, driverTotal, spec).map((share, i) => ({
    jobId: targets[i]!.jobId,
    share,
    driver: drivers[i]!,
    proportion: drivers[i]!.div(driverTotal),
  }))

  return { basis, total, driverTotal, shares }
}

/**
 * The distribution itself.
 *
 * Works in minor units — fils, cents — as integers, because that is the level
 * at which "it sums exactly" is a statement about arithmetic rather than about
 * rounding. Negative totals (a rebate, a credit from the co-loader) are
 * allocated on the absolute value and re-signed, so a refund splits the same
 * way the cost it reverses did.
 */
function largestRemainder(
  total: Money,
  drivers: readonly Decimal[],
  driverTotal: Decimal,
  spec: CurrencySpec,
): Money[] {
  const negative = dec(total.amount).isNegative()
  const scale = D(10).pow(spec.minorUnits)
  const totalUnits = dec(round({ ...total, amount: dec(total.amount).abs() }, spec).amount)
    .times(scale)
    .toDecimalPlaces(0)

  const exact = drivers.map((d) => totalUnits.times(d).div(driverTotal))
  const floors = exact.map((e) => e.floor())
  const distributed = floors.reduce((acc, f) => acc.plus(f), D(0))

  let remaining = totalUnits.minus(distributed)

  /*
    Ordered by fractional remainder, then by driver, then by position.

    The second and third keys are what make this reproducible rather than
    merely correct. Two houses with identical remainders — which is the common
    case, not the exotic one, because identical cartons produce identical
    figures — must be separated by something stable, or the same allocation
    re-run tomorrow hands the odd fils to a different house and the ledger
    disagrees with itself.
  */
  const order = exact
    .map((e, i) => ({ i, remainder: e.minus(e.floor()), driver: drivers[i]! }))
    .sort(
      (a, b) => b.remainder.comparedTo(a.remainder) || b.driver.comparedTo(a.driver) || a.i - b.i,
    )

  const units = [...floors]
  for (const entry of order) {
    if (remaining.lessThanOrEqualTo(0)) break
    units[entry.i] = units[entry.i]!.plus(1)
    remaining = remaining.minus(1)
  }

  return units.map((u) => {
    const amount = u.div(scale)
    const m = money(negative ? amount.negated() : amount, total.currency)
    return round(m, spec)
  })
}

function manualAllocation(
  total: Money,
  targets: readonly AllocationTarget[],
  spec: CurrencySpec,
  manualShares?: ReadonlyMap<string, Money>,
): Allocation {
  if (!manualShares) {
    throw new AllocationError(
      'allocation_manual_missing',
      'A manual allocation needs a share for every house',
    )
  }

  const shares = targets.map((t) => {
    const stated = manualShares.get(t.jobId)
    if (!stated) {
      throw new AllocationError(
        'allocation_manual_incomplete',
        `No share was stated for job ${t.jobId}`,
      )
    }
    return round(stated, spec)
  })

  const stated = sum(shares, total.currency)
  const expected = round(total, spec)

  /*
    Exact equality, and no tolerance.

    A tolerance is a decision that some amount of money is small enough not to
    matter, made once here and inherited by every deployment. The operator who
    typed the shares is looking at the screen and can fix the difference in
    five seconds; nobody reading the cost account in November can.
  */
  if (!dec(stated.amount).equals(dec(expected.amount))) {
    throw new AllocationError(
      'allocation_manual_mismatch',
      `Stated shares total ${stated.amount.toString()} but the cost is ${expected.amount.toString()}`,
    )
  }

  return {
    basis: 'manual',
    total: expected,
    driverTotal: D(targets.length),
    shares: shares.map((share, i) => ({
      jobId: targets[i]!.jobId,
      share,
      driver: D(1),
      proportion: D(1).div(targets.length),
    })),
  }
}

/**
 * Reversing an allocation.
 *
 * Posting the negative of every share rather than deleting the rows, because
 * the charge lines it produced may already sit on an issued invoice. A cost
 * that was invoiced and then vanished is a reconciliation nobody can perform;
 * a cost that was invoiced and then reversed is one line of explanation.
 */
export function reverse(allocation: Allocation): Allocation {
  return {
    ...allocation,
    total: negate(allocation.total),
    shares: allocation.shares.map((s) => ({ ...s, share: negate(s.share) })),
  }
}

/** What each house pays, as a proportion — for the preview screen. */
export function explain(allocation: Allocation): string[] {
  return allocation.shares.map(
    (s) =>
      `${s.jobId}: ${s.driver.toString()} of ${allocation.driverTotal.toString()} ` +
      `(${s.proportion.times(100).toDecimalPlaces(2).toString()}%) = ${s.share.amount.toString()}`,
  )
}

/**
 * Applying a margin to a share, where the consolidator sells space rather than
 * passing cost through. Kept here rather than in `rating.ts` because it is the
 * groupage case specifically: the sell is derived from the *allocated* cost,
 * not from a rate card.
 */
export function withMargin(share: Money, marginPercent: Numeric, spec: CurrencySpec): Money {
  return round(add(share, multiply(share, dec(marginPercent).div(100))), spec)
}

/** Total of an allocation's shares — the assertion every test makes. */
export function sharesTotal(allocation: Allocation): Money {
  return allocation.shares.length === 0
    ? zero(allocation.total.currency)
    : sum(
        allocation.shares.map((s) => s.share),
        allocation.total.currency,
      )
}

function findDuplicate(ids: readonly string[]): string | undefined {
  const seen = new Set<string>()
  for (const id of ids) {
    if (seen.has(id)) return id
    seen.add(id)
  }
  return undefined
}
