/**
 * Import duty, estimated before the declaration is filed.
 *
 * We are not in the filing path and will not be — Kuwait customs runs on a
 * concession held by a competitor until 2030, which `adapters/customs.ts`
 * explains at length. That is a fact about the market and not a gap in the
 * roadmap.
 *
 * It is also not a reason to be absent from the customs conversation. The
 * filing click takes thirty seconds; the hours are on either side of it, and
 * one of those hours is the customer asking what the shipment will cost to
 * land and nobody being able to answer until the broker comes back. A quote
 * that says "1,200 KWD, plus duty" has moved the surprise, not removed it.
 *
 * ## The lookup is a prefix match, not an equality match
 *
 * A tariff is a tree. Chapter is two digits, heading four, subheading six,
 * then the national line at eight or ten. Rates are published at whatever
 * depth the exception needs: the GCC common external tariff is 5% across most
 * of the schedule, foodstuffs and medicines are exempted at chapter level, and
 * tobacco carries its own rate at the national line. So the rule is "the
 * longest prefix of this code that has a row", and one table holds all three
 * depths because the prefix rule does.
 *
 * ## An estimate that cannot be reproduced is worthless
 *
 * Every rate is dated. An estimate produced in January and disputed in June is
 * recomputed against the tariff *as it stood in January*, which is why the
 * lookup takes the date and the caller stores what it matched. A tariff table
 * that is edited in place can only ever justify today's number.
 */

import { D, dec, money, round, sum, zero } from './money'
import type { CurrencyCode, CurrencySpec, Money, Numeric } from './money'
import { DomainError } from './errors'

export class DutyError extends DomainError {
  constructor(code: string, message: string) {
    super(code, message)
  }
}

/** A row of `duty_rates`. Core never reads the table; the caller passes them. */
export interface TariffLine {
  readonly country: string
  readonly hsPrefix: string
  readonly ratePercent: Numeric
  readonly descriptionEn: string
  /** ISO date. Compared as a date, not a timestamp — a tariff changes at midnight. */
  readonly effectiveFrom: string
  readonly effectiveTo?: string | null
}

export interface DutiableLine {
  /** Full HS code as declared. Digits only; separators are stripped. */
  readonly hsCode: string | null | undefined
  readonly description: string
  /** The customs value of this line — CIF, in the declaration currency. */
  readonly value: Numeric
}

export interface DutyLineEstimate {
  readonly description: string
  readonly hsCode: string
  /** Which prefix answered — the audit trail of the lookup. */
  readonly matchedPrefix: string
  readonly matchedDescription: string
  readonly ratePercent: string
  readonly value: Money
  readonly duty: Money
}

export interface DutyEstimate {
  readonly currency: CurrencyCode
  readonly customsValue: Money
  readonly duty: Money
  readonly lines: readonly DutyLineEstimate[]
  /**
   * Lines no rate could be found for.
   *
   * Reported rather than defaulted. Applying the general rate to an unknown
   * code produces a number that looks researched and is a guess, and the
   * customer who is told "5%" on a code that turns out to be exempt has been
   * mis-sold. The caller may pass `generalRatePercent` to opt into the
   * fallback explicitly — which is a decision, taken visibly.
   */
  readonly unmatched: readonly DutiableLine[]
  readonly asOf: Date
}

/** Strips separators. HS codes are written 8703.23.90 and stored as digits. */
export function normaliseHsCode(code: string | null | undefined): string {
  return (code ?? '').replace(/\D/g, '')
}

/**
 * The longest prefix of `hsCode` with a rate in force on `on`.
 *
 * Ties cannot occur: `duty_rates` is unique on (country, prefix,
 * effective_from), and the date filter admits at most one row per prefix.
 */
export function findRate(
  tariff: readonly TariffLine[],
  country: string,
  hsCode: string,
  on: Date,
): TariffLine | undefined {
  const code = normaliseHsCode(hsCode)
  if (code === '') return undefined

  const day = isoDate(on)
  const candidates = tariff.filter(
    (t) =>
      t.country === country &&
      code.startsWith(t.hsPrefix) &&
      t.effectiveFrom <= day &&
      (!t.effectiveTo || t.effectiveTo > day),
  )

  return candidates.sort((a, b) => b.hsPrefix.length - a.hsPrefix.length)[0]
}

/**
 * Duty across a shipment's lines.
 *
 * `value` is the customs value — CIF, not the commercial invoice total — which
 * is why `customsValue` below exists and is a separate step. Getting that
 * wrong understates every estimate by the freight, which on an LCL shipment of
 * cheap goods is most of the number.
 */
export function estimateDuty(
  lines: readonly DutiableLine[],
  tariff: readonly TariffLine[],
  options: {
    readonly country: string
    readonly currency: CurrencyCode
    readonly on: Date
    readonly spec: CurrencySpec
    /** Opt in to the general rate for codes with no row. Never assumed. */
    readonly generalRatePercent?: Numeric
    readonly generalRateDescription?: string
  },
): DutyEstimate {
  const { country, currency, on, spec } = options
  const estimated: DutyLineEstimate[] = []
  const unmatched: DutiableLine[] = []

  for (const line of lines) {
    const code = normaliseHsCode(line.hsCode)
    const value = round(money(line.value, currency), spec)
    const match = code === '' ? undefined : findRate(tariff, country, code, on)

    if (!match) {
      if (options.generalRatePercent === undefined) {
        unmatched.push(line)
        continue
      }
      estimated.push({
        description: line.description,
        hsCode: code,
        matchedPrefix: '',
        matchedDescription: options.generalRateDescription ?? 'General rate',
        ratePercent: dec(options.generalRatePercent).toString(),
        value,
        duty: dutyOn(value, options.generalRatePercent, currency, spec),
      })
      continue
    }

    estimated.push({
      description: line.description,
      hsCode: code,
      matchedPrefix: match.hsPrefix,
      matchedDescription: match.descriptionEn,
      ratePercent: dec(match.ratePercent).toString(),
      value,
      duty: dutyOn(value, match.ratePercent, currency, spec),
    })
  }

  return {
    currency,
    customsValue:
      estimated.length === 0
        ? zero(currency)
        : sum(
            estimated.map((l) => l.value),
            currency,
          ),
    duty:
      estimated.length === 0
        ? zero(currency)
        : sum(
            estimated.map((l) => l.duty),
            currency,
          ),
    lines: estimated,
    unmatched,
    asOf: on,
  }
}

function dutyOn(
  value: Money,
  ratePercent: Numeric,
  currency: CurrencyCode,
  spec: CurrencySpec,
): Money {
  return round(money(dec(value.amount).times(dec(ratePercent)).div(100), currency), spec)
}

/**
 * Customs value — CIF, built from what the job already knows.
 *
 * The commercial invoice is the goods. Kuwait, like the rest of the GCC,
 * assesses on cost, insurance and freight, so the freight we are charging and
 * the insurance the customer bought are part of the value duty is computed on.
 * Forgetting them is the single most common way an estimate comes in low, and
 * it comes in low by exactly the amount the customer is least expecting.
 */
export function customsValue(
  parts: {
    readonly goods: Numeric
    readonly freight?: Numeric
    readonly insurance?: Numeric
    /** Anything else the authority adds: royalties, assists, packing. */
    readonly additions?: Numeric
  },
  currency: CurrencyCode,
  spec: CurrencySpec,
): Money {
  const total = dec(parts.goods)
    .plus(dec(parts.freight ?? 0))
    .plus(dec(parts.insurance ?? 0))
    .plus(dec(parts.additions ?? 0))

  if (total.isNegative()) {
    throw new DutyError('duty_negative_value', 'A customs value cannot be negative')
  }

  return round(money(total, currency), spec)
}

/**
 * Landed cost — what the customer actually asked.
 *
 * Duty, plus our charges, plus the goods. The reason this is one function
 * rather than a sum at the call site is that it names what is included, and
 * "does that include clearance?" is the question every landed-cost figure in
 * this industry is met with.
 */
export function landedCost(
  parts: {
    readonly customsValue: Money
    readonly duty: Money
    readonly ourCharges?: Money
  },
  spec: CurrencySpec,
): Money {
  const currency = parts.customsValue.currency
  const items = [parts.customsValue, parts.duty, parts.ourCharges].filter(
    (m): m is Money => m !== undefined,
  )
  return round(sum(items, currency), spec)
}

/**
 * The Kuwait tariff, as far as a generic seed can honestly go.
 *
 * Three rows and no more, because the fourth would be a guess. The GCC common
 * external tariff is 5% ad valorem across the schedule; the exemptions that
 * matter to most importers here are the chapter-level ones on food and
 * medicine. A deployment that needs the full national schedule loads it as
 * reference data — that is the whole point of it being a table.
 *
 * `effectiveFrom` is deliberately old: these are long-standing rates, and
 * dating them to the day of the seed would make every historical estimate
 * unreproducible.
 */
export const SEED_KW_TARIFF: readonly TariffLine[] = [
  {
    country: 'KW',
    hsPrefix: '01',
    ratePercent: '0',
    descriptionEn: 'Live animals — exempt',
    effectiveFrom: '2003-01-01',
  },
  {
    country: 'KW',
    hsPrefix: '30',
    ratePercent: '0',
    descriptionEn: 'Pharmaceutical products — exempt',
    effectiveFrom: '2003-01-01',
  },
  {
    country: 'KW',
    hsPrefix: '24',
    ratePercent: '100',
    descriptionEn: 'Tobacco and manufactured tobacco substitutes',
    effectiveFrom: '2017-01-01',
  },
]

/** The GCC general rate. Passed explicitly by a caller that wants it. */
export const GCC_GENERAL_RATE_PERCENT = '5'

export function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

/** Total of an estimate, for the screen that shows one number. */
export function estimateTotal(estimate: DutyEstimate, spec: CurrencySpec): Money {
  return round(
    money(dec(estimate.customsValue.amount).plus(dec(estimate.duty.amount)), estimate.currency),
    spec,
  )
}

/** Has anything been left out? The check before an estimate is quoted. */
export function isComplete(estimate: DutyEstimate): boolean {
  return estimate.unmatched.length === 0 && estimate.lines.length > 0
}

/** Rate as a fraction, where a caller needs it for its own arithmetic. */
export function rateFraction(ratePercent: Numeric): ReturnType<typeof D> {
  return dec(ratePercent).div(100)
}
