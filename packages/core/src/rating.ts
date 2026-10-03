/**
 * Rate basis per mode, accessorial calculation, margin rules — Architecture §7.1.
 *
 * FR-RT-05 lists eighteen accessorial types: terminal handling, documentation,
 * fuel, security, clearance, delivery order, haulage, DG, out-of-gauge, reefer,
 * inspection, legalisation, permit, insurance, demurrage, detention, storage.
 *
 * They are eighteen rows against the six functions below, each row carrying its
 * own basis, currency and minimum. A nineteenth accessorial in 2027 is an admin
 * screen entry, not a release.
 */

import {
  type CurrencyCode,
  type CurrencyLookup,
  type FxRate,
  type Money,
  type Numeric,
  add,
  applyMinimum,
  convert,
  dec,
  identityRate,
  money,
  multiply,
  percentOf,
  round,
  sum,
  zero,
} from './money'
import { MissingChargeContextError, UnknownCurrencyError } from './errors'
import type { Decimal } from 'decimal.js'

/**
 * The calculation shapes. Everything in FR-RT-05 is one of these.
 *
 * `per_cbm` and `per_wm` are the LCL pair, and were missing: an agent's "EUR 85
 * per cbm" had nowhere to go but `per_unit`, which multiplies by the package
 * count, so 8 cbm on 6 pallets was priced as 6 and every per-cbm LCL charge came
 * out short by the ratio of pallets to cubic metres, silently (N1). `per_wm` is
 * "weight or measure", the revenue ton: the greater of cubic metres and metric
 * tonnes, which is how most LCL freight is actually quoted.
 */
export type Basis =
  'flat' | 'per_unit' | 'per_kg' | 'per_cbm' | 'per_wm' | 'per_container' | 'per_day' | 'percent'

export const BASES: readonly Basis[] = [
  'flat',
  'per_unit',
  'per_kg',
  'per_cbm',
  'per_wm',
  'per_container',
  'per_day',
  'percent',
]

/** A rate card line, or a manually entered charge. */
export interface RateLine {
  readonly basis: Basis
  readonly rate: Decimal
  readonly currency: CurrencyCode
  readonly minimum?: Decimal | null
  readonly maximum?: Decimal | null
}

/**
 * Everything the bases can need. Fields are optional because a given line
 * consumes exactly one of them — a `per_kg` line asks for `kg` and throws if
 * the caller has not supplied it, rather than quietly treating absence as zero
 * and producing a free shipment.
 */
export interface ChargeContext {
  readonly units?: Numeric
  readonly kg?: Numeric
  /** Cubic metres, for `per_cbm` and the measure half of `per_wm`. */
  readonly cbm?: Numeric
  /**
   * Actual gross kilograms, for the weight half of `per_wm`. Not `kg`: on an
   * air or courier lane `kg` is the chargeable weight, which already contains
   * the volume, and a revenue ton counted from it would count the volume twice.
   */
  readonly grossKg?: Numeric
  readonly containers?: Numeric
  readonly days?: Numeric
  /** The base a `percent` line applies to — insurance on declared value, say. */
  readonly of?: Money
}

function require_(value: Numeric | undefined, basis: Basis, field: string): Decimal {
  if (value === undefined || value === null) throw new MissingChargeContextError(basis, field)
  return dec(value)
}

/**
 * Revenue tons: the greater of cubic metres and gross tonnes.
 *
 * Only the volume is required. An LCL enquiry nearly always states its cbm and
 * often omits the weight, and a rate per W/M on 8 cbm is 8 revenue tons unless
 * the cargo is heavier than 8 tonnes, which a missing weight cannot claim. A
 * missing volume is refused, as every other missing quantity is, because
 * tonnes alone would undercharge a light, bulky consignment.
 */
export function revenueTonsFor(ctx: ChargeContext): Decimal {
  const cbm = require_(ctx.cbm, 'per_wm', 'cbm')
  if (ctx.grossKg === undefined || ctx.grossKg === null) return cbm
  const tonnes = dec(ctx.grossKg).dividedBy(1000)
  return tonnes.greaterThan(cbm) ? tonnes : cbm
}

/**
 * One branch per basis. This is the whole charge engine.
 *
 * The result is unrounded: rounding is per currency and belongs at the invoice
 * line (NFR-02), so callers finish with `round`/`roundWith`. Rounding here
 * would round twice on any charge that is later converted.
 */
export function calcCharge(line: RateLine, ctx: ChargeContext = {}): Money {
  let amount: Money

  switch (line.basis) {
    case 'flat':
      amount = money(line.rate, line.currency)
      break
    case 'per_unit':
      amount = multiply(money(line.rate, line.currency), require_(ctx.units, 'per_unit', 'units'))
      break
    case 'per_kg':
      amount = multiply(money(line.rate, line.currency), require_(ctx.kg, 'per_kg', 'kg'))
      break
    case 'per_cbm':
      amount = multiply(money(line.rate, line.currency), require_(ctx.cbm, 'per_cbm', 'cbm'))
      break
    case 'per_wm':
      amount = multiply(money(line.rate, line.currency), revenueTonsFor(ctx))
      break
    case 'per_container':
      amount = multiply(
        money(line.rate, line.currency),
        require_(ctx.containers, 'per_container', 'containers'),
      )
      break
    case 'per_day':
      amount = multiply(money(line.rate, line.currency), require_(ctx.days, 'per_day', 'days'))
      break
    case 'percent': {
      if (!ctx.of) throw new MissingChargeContextError('percent', 'of')
      // A percentage line takes the currency of the base it applies to; a fuel
      // surcharge on a USD freight line is a USD charge whatever the rate row
      // is denominated in.
      amount = percentOf(ctx.of, line.rate)
      break
    }
  }

  if (line.minimum) amount = applyMinimum(amount, money(line.minimum, amount.currency))
  if (line.maximum) {
    const cap = money(line.maximum, amount.currency)
    if (amount.amount.greaterThan(cap.amount)) amount = cap
  }

  return amount
}

/**
 * How far ahead coverage is warned about — FR-RT-11's thirty days.
 *
 * Here rather than in the worker that sends the digest, because the screen
 * that shows "expiring" and the mail that says so must mean the same window.
 * They did not have to be told twice about free time either; `clocks.ts` holds
 * that one for the same reason.
 */
export const RATE_CARD_EXPIRY_HORIZON_DAYS = 30

// --- charge lines ----------------------------------------------------------

export type Direction = 'cost' | 'revenue'

/**
 * A priced line, in the shape it is written to `charge_lines`.
 *
 * `fxRate` and `fxRateAt` are carried on the line, not looked up later —
 * FR-RT-06. Everything needed to reconcile a June invoice against a March
 * booking is on the row.
 */
export interface PricedLine {
  readonly chargeTypeKey: string
  readonly direction: Direction
  readonly basis: Basis
  readonly quantity: Decimal
  readonly rate: Decimal
  readonly amount: Money
  readonly fx: FxRate
  readonly amountInBase: Money
}

export interface PriceInput {
  readonly chargeTypeKey: string
  readonly direction: Direction
  readonly line: RateLine
  readonly ctx?: ChargeContext
}

function quantityFor(basis: Basis, ctx: ChargeContext): Decimal {
  switch (basis) {
    case 'per_unit':
      return dec(ctx.units ?? 1)
    case 'per_kg':
      return dec(ctx.kg ?? 1)
    case 'per_cbm':
      return dec(ctx.cbm ?? 1)
    case 'per_wm':
      return ctx.cbm === undefined || ctx.cbm === null ? dec(1) : revenueTonsFor(ctx)
    case 'per_container':
      return dec(ctx.containers ?? 1)
    case 'per_day':
      return dec(ctx.days ?? 1)
    case 'flat':
    case 'percent':
      return dec(1)
  }
}

export interface PricingOptions {
  /** The branch's base currency — invoices and margin are stated in it. */
  readonly baseCurrency: CurrencyCode
  /** One rate per foreign currency, resolved once and stamped on every line. */
  readonly fxRates: readonly FxRate[]
  readonly currencies: CurrencyLookup
  readonly pricedAt: Date
}

function rateFor(from: CurrencyCode, opts: PricingOptions): FxRate {
  if (from === opts.baseCurrency) return identityRate(from, opts.pricedAt)
  const found = opts.fxRates.find((r) => r.from === from && r.to === opts.baseCurrency)
  if (!found) throw new UnknownCurrencyError(from)
  return found
}

export function priceLine(input: PriceInput, opts: PricingOptions): PricedLine {
  const ctx = input.ctx ?? {}
  const spec = opts.currencies(input.line.currency)
  if (!spec) throw new UnknownCurrencyError(input.line.currency)

  const gross = calcCharge(input.line, ctx)
  const amount = round(gross, spec)
  const fx = rateFor(amount.currency, opts)
  const baseSpec = opts.currencies(opts.baseCurrency)
  if (!baseSpec) throw new UnknownCurrencyError(opts.baseCurrency)

  return {
    chargeTypeKey: input.chargeTypeKey,
    direction: input.direction,
    basis: input.line.basis,
    quantity: quantityFor(input.line.basis, ctx),
    rate: input.line.rate,
    amount,
    fx,
    amountInBase: round(convert(amount, fx), baseSpec),
  }
}

export function priceLines(inputs: readonly PriceInput[], opts: PricingOptions): PricedLine[] {
  return inputs.map((input) => priceLine(input, opts))
}

// --- margin ----------------------------------------------------------------

/**
 * Margin is either a percentage of cost, a fixed uplift, or a target sell.
 * Mirrors a `margin_rules` row so a change to the house rule is configuration.
 */
export type MarginRule =
  | { readonly kind: 'percent'; readonly value: Decimal }
  | { readonly kind: 'absolute'; readonly value: Decimal; readonly currency: CurrencyCode }
  | { readonly kind: 'target_sell'; readonly value: Decimal; readonly currency: CurrencyCode }

export function applyMargin(cost: Money, rule: MarginRule): Money {
  switch (rule.kind) {
    case 'percent':
      return add(cost, percentOf(cost, rule.value))
    case 'absolute':
      return add(cost, money(rule.value, rule.currency))
    case 'target_sell':
      return money(rule.value, rule.currency)
  }
}

/**
 * The house margin laid over a whole quotation's cost lines, one sell amount
 * per line, each already rounded to the currency and summing to the sell total.
 *
 * `applyMargin` is a rule applied to one figure; a quotation is several lines,
 * and only a percentage means the same thing per line as it does for the
 * whole. A 500 KWD `target_sell` applied line by line quoted a six-line card at
 * 3,000, and an `absolute` uplift was added once per line. So the rule is
 * applied to the quotation, once:
 *
 *   percent      each line carries the same percentage — the per-line and the
 *                whole-quote readings agree, so nothing needs distributing.
 *   absolute     the sell total is the cost total plus the uplift once; the
 *                uplift is shared across the lines in proportion to their cost.
 *   target_sell  the sell total is the target; it is shared across the lines in
 *                proportion to their cost.
 *
 * Proportional to cost because that keeps every line's own margin percentage
 * equal, which is what a customer comparing lines across two quotations would
 * expect, and no line can go negative. Each line is rounded to the currency's
 * minor units *before* the total is taken, and the few fils of rounding left
 * over land on the largest line — so the lines printed on the quotation add up
 * to the total printed beneath them, which rounding the sum separately did not
 * (three lines of 1.357 under a total of 4.072). With no cost at all to weigh
 * by, the whole sell lands on the first line.
 *
 * Every cost must be in one currency — the caller's base — and so must an
 * absolute or target rule; anything else is a programming error and throws
 * through `add`, rather than adding dollars to dinars.
 */
export function distributeMargin(
  costs: readonly Money[],
  rule: MarginRule,
  lookup: CurrencyLookup,
): Money[] {
  if (costs.length === 0) return []
  const currency = costs[0]!.currency
  const spec = lookup(currency)
  if (!spec) throw new Error(`Unknown currency ${currency}`)
  const scale = (m: Money) => round(m, spec)

  if (rule.kind === 'percent') return costs.map((cost) => scale(applyMargin(cost, rule)))

  const totalCost = sum(costs, currency)
  const target =
    rule.kind === 'absolute'
      ? scale(add(scale(totalCost), money(rule.value, rule.currency)))
      : scale(money(rule.value, rule.currency))

  const shares = totalCost.amount.isZero()
    ? costs.map((_, index) => (index === 0 ? target : zero(currency)))
    : costs.map((cost) =>
        scale(money(target.amount.times(cost.amount).dividedBy(totalCost.amount), currency)),
      )

  // The rounding remainder, onto the largest line.
  const remainder = target.amount.minus(sum(shares, currency).amount)
  if (!remainder.isZero()) {
    const largest = shares.reduce(
      (best, share, index) => (share.amount.greaterThan(shares[best]!.amount) ? index : best),
      0,
    )
    shares[largest] = money(shares[largest]!.amount.plus(remainder), currency)
  }
  return shares
}

export interface MarginSummary {
  readonly cost: Money
  readonly revenue: Money
  readonly gross: Money
  /** Percentage of revenue. Null where revenue is zero. */
  readonly grossPercent: Decimal | null
}

/**
 * Totals a priced set in the branch's base currency — the job P&L.
 *
 * Takes the two fields it reads rather than a whole `PricedLine`, so the same
 * arithmetic serves both callers. Quoting hands it lines it has just priced;
 * `margin.ts` hands it rows out of the charge ledger, which were priced weeks
 * ago and carry no basis or quantity any more. One definition of gross margin
 * is the point — two would eventually disagree, and the disagreement would be
 * between the number on the quote and the number on the job.
 */
export function summariseMargin(
  lines: readonly Pick<PricedLine, 'direction' | 'amountInBase'>[],
  baseCurrency: CurrencyCode,
): MarginSummary {
  const cost = sum(
    lines.filter((l) => l.direction === 'cost').map((l) => l.amountInBase),
    baseCurrency,
  )
  const revenue = sum(
    lines.filter((l) => l.direction === 'revenue').map((l) => l.amountInBase),
    baseCurrency,
  )
  const gross = { amount: revenue.amount.minus(cost.amount), currency: baseCurrency }
  const grossPercent = revenue.amount.isZero()
    ? null
    : gross.amount.dividedBy(revenue.amount).times(100)

  return { cost, revenue, gross, grossPercent }
}

export function emptyMargin(baseCurrency: CurrencyCode): MarginSummary {
  return {
    cost: zero(baseCurrency),
    revenue: zero(baseCurrency),
    gross: zero(baseCurrency),
    grossPercent: null,
  }
}
