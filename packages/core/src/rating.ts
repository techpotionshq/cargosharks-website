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

/** The six calculation shapes. Everything in FR-RT-05 is one of these. */
export type Basis = 'flat' | 'per_unit' | 'per_kg' | 'per_container' | 'per_day' | 'percent'

export const BASES: readonly Basis[] = [
  'flat',
  'per_unit',
  'per_kg',
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
 * Everything the six bases can need. Fields are optional because a given line
 * consumes exactly one of them — a `per_kg` line asks for `kg` and throws if
 * the caller has not supplied it, rather than quietly treating absence as zero
 * and producing a free shipment.
 */
export interface ChargeContext {
  readonly units?: Numeric
  readonly kg?: Numeric
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
 * Six branches. This is the whole charge engine.
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

export interface MarginSummary {
  readonly cost: Money
  readonly revenue: Money
  readonly gross: Money
  /** Percentage of revenue. Null where revenue is zero. */
  readonly grossPercent: Decimal | null
}

/** Totals a priced set in the branch's base currency — the job P&L. */
export function summariseMargin(
  lines: readonly PricedLine[],
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
