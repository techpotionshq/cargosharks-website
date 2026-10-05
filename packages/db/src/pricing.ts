/**
 * Pricing an enquiry off a rate card, and writing the draft quotation it
 * produces — FR-EQ-05, FR-RT-01…06.
 *
 * This was the core of the web ledger's `priceEnquiry` action. It moved here the
 * day auto-draft became a second caller: the service drafts a quotation for an
 * enquiry whose buy rate has just been awarded, with no coordinator clicking
 * "Price it", and the quote it writes — the margin rule, the frozen snapshot,
 * the numbering — must be the quote the button writes. This is the sell side of
 * the ledger; one copy of it, not two.
 *
 * ## Where the sell price comes from, in order
 *
 * 1. A **sell card** covering the lane. Its rates are the price; nothing is
 *    added, because somebody already decided what this customer pays.
 * 2. Failing that, a **buy card** plus the house margin on
 *    `customer_branch_terms` — configuration, not a number invented here.
 * 3. Failing both, a refusal. An uncovered lane is an agent RFQ, not a guess.
 *
 * Nothing is recomputed afterwards: the whole decision is frozen into
 * `quotes.priced_snapshot`, which is what makes a later invoice reconcile to the
 * booking and stops a rate-card edit rewriting history. A revision is a new row.
 */

import { sql } from 'drizzle-orm'
import {
  chargeableWeight,
  currencyLookup,
  dayIn,
  dec,
  distributeMargin,
  draftConcerns,
  fxRate,
  identityRate,
  priceLines,
  roundWith,
  selectBreak,
  summariseMargin,
  toScale,
  todayIn,
  staleConversions,
  type Basis,
  type ChargeContext,
  type MarginRule,
  type PriceInput,
  type PricedLine,
  type PricingOptions,
  type RateLine,
} from '@qabandi/core'
import { chargeableRuleFor } from './chargeable'
import { ratesOnto } from './fx-feed'
import { findCoveringRateCard, type CoveringRateCard, type CoveringRateLine } from './rate-cards'
import { newerRateReplies } from './rate-promotion'
import type { Tx } from './actor'

/** What pricing can answer with — the caller turns each into a sentence. */
export type PricingRefusal =
  | 'not_found'
  | 'no_mode'
  | 'no_container_count'
  | 'no_cover'
  | 'no_margin'
  | 'cannot_price'
  /** A version of this enquiry's quotation was accepted; it is never superseded (S2). */
  | 'quote_accepted'
  /** Auto-draft only: somebody priced the enquiry first (S19). */
  | 'already_quoted'

export type PriceOutcome =
  { readonly reference: string } | { readonly error: PricingRefusal; readonly detail?: string }

export interface PriceEnquiryHooks {
  /** Called before superseding an existing quotation — the `quote.revise` gate. */
  readonly assertRevise?: () => void
  /**
   * Write only a first quotation — refuse `already_quoted` if any exists. The
   * auto-draft sweep's: it picked the enquiry because it had no quote, and a
   * coordinator who priced it meanwhile must not have that draft superseded
   * by the machine's (S19).
   */
  readonly firstOnly?: boolean
}

/** How long an instant quotation stands. Beyond this it expires by itself. */
const VALIDITY_DAYS = 14

/**
 * Price an enquiry and write the draft quotation it produces.
 *
 * Returns a refusal rather than throwing when there is no cover: "no rate card
 * covers this lane" is an answer a coordinator acts on by raising an RFQ, not a
 * fault. The caller owns the actor (RLS scopes the enquiry to the branch) and
 * who prepared it; everything else — the card lookup, the arithmetic, the
 * snapshot, the numbering — is decided here.
 */
export async function priceEnquiryToQuote(
  tx: Tx,
  enquiryId: string,
  preparedById: string,
  hooks: PriceEnquiryHooks = {},
): Promise<PriceOutcome> {
  const [enquiry] = await tx
    .execute(
      sql`
      select e.id, e.branch_id as "branchId", e.customer_id as "customerId",
             e.mode::text as mode, e.origin_id as "originId",
             e.destination_id as "destinationId", e.ready_on::text as "readyOn",
             e.gross_weight_kg::text as "grossWeightKg",
             e.volume_cbm::text as "volumeCbm", e.pieces,
             e.container_count as "containerCount",
             b.base_currency as "baseCurrency",
             b.default_exclusions_en as "exclusionsEn",
             b.default_exclusions_ar as "exclusionsAr",
             t.default_margin_kind::text as "marginKind",
             t.default_margin_value::text as "marginValue"
        from enquiries e
        join branches b on b.id = e.branch_id
        left join customer_branch_terms t
               on t.customer_id = e.customer_id and t.branch_id = e.branch_id
       where e.id = ${enquiryId}
       limit 1
    `,
    )
    .then((r) => r.rows as unknown as EnquiryRow[])

  if (!enquiry) return { error: 'not_found' }
  if (!enquiry.mode) return { error: 'no_mode' }
  /*
    A FCL lane is priced per container, and only the enquiry's own container
    count says how many. It used to fall back to `pieces` — packages — so 200
    cartons in two boxes were quoted as 200 × 40HC (F39). Refused instead: a
    refusal a coordinator answers by entering the count beats a price that is
    wrong by two orders of magnitude, and the auto-draft sweep skips it the same
    way it skips a lane with no cover.
  */
  if (enquiry.mode === 'sea_fcl' && enquiry.containerCount === null) {
    return { error: 'no_container_count' }
  }

  // Cover is asked for on the readiness date, not today — a shipment ready in
  // six weeks is priced against the card that will be live then.
  const on = enquiry.readyOn ?? todayIn()

  const lane = {
    mode: enquiry.mode,
    originId: enquiry.originId,
    destinationId: enquiry.destinationId,
    on,
    customerId: enquiry.customerId,
  }

  /*
    The buy side is the rate this enquiry's agent reply was awarded as, when
    one was (F67). Several agents can hold a buy card on one lane, and the
    lane lookup alone picked whichever sorted first — QUO-2026-00004 was costed
    off an older MAERSK card while the enquiry page said the SHACO reply was
    accepted and made a card. Awarding a rate is the decision about what the
    shipment costs; pricing that ignores it contradicts the screen.

    Decided here rather than passed in by the auto-draft sweep, so that a
    coordinator clicking "Price it" after awarding a rate gets the same buy
    card the machine would — one rule, both callers, which is why this
    function exists. Only the cost side moves: a sell card, where there is one,
    is still the price, and without one the margin is laid on the awarded cost.
    The newest award wins if a lane was re-awarded.
  */
  const [awarded] = await tx
    .execute(
      sql`
      select r.rate_card_id as "rateCardId"
        from rate_requests r
       where r.enquiry_id = ${enquiryId}
         and r.status = 'accepted'
         and r.rate_card_id is not null
       order by r.updated_at desc, r.created_at desc
       limit 1
    `,
    )
    .then((r) => r.rows as unknown as { rateCardId: string }[])

  const sellCard = await findCoveringRateCard(tx, { ...lane, direction: 'sell' })
  const buyCard = await findCoveringRateCard(tx, {
    ...lane,
    direction: 'buy',
    preferCardId: awarded?.rateCardId ?? null,
  })

  if (!sellCard && !buyCard) return { error: 'no_cover' }

  const rule = await chargeableRuleFor(tx, enquiry.mode, enquiry.branchId)
  const derived =
    rule && (enquiry.grossWeightKg || enquiry.volumeCbm)
      ? chargeableWeight(
          { grossWeightKg: enquiry.grossWeightKg ?? 0, volumeCbm: enquiry.volumeCbm ?? 0 },
          rule,
        )
      : null
  const chargeableKg = derived ? derived.chargeableKg.toString() : null

  const ctx = contextFor(enquiry.mode, enquiry, chargeableKg)

  const currencies = await tx
    .execute(sql`select code, minor_units as "minorUnits" from currencies`)
    .then((r) => r.rows as unknown as { code: string; minorUnits: number }[])
  const lookup = currencyLookup(currencies)

  /*
    The newest rate on or before the pricing date, never a later one (FR-RT-06).

    Through `ratesOnto`, the one query the rate-reply comparison and the
    auto-award sweep use too, so a reply ranked cheapest is ranked at the rate
    this then prices at. Its order is the shared one in `fx-feed.ts`: on a day
    holding a feed row and a hand-entered one, the person's wins. Here it used
    to be `effective_on desc` alone, so `distinct on` returned whichever row
    the scan met first. Source and moment come along so the screen can say
    whose rate it was.
  */
  const rates = [
    ...(
      await ratesOnto(
        tx,
        currencies.map((c) => c.code),
        enquiry.baseCurrency,
        on,
      )
    ).rates.values(),
  ]

  const pricedAt = new Date()
  const opts: PricingOptions = {
    baseCurrency: enquiry.baseCurrency,
    fxRates: rates.map((r) => fxRate(r.from, r.to, dec(r.rate), pricedAt)),
    currencies: lookup,
    pricedAt,
  }

  let priced: PricedLine[]
  let cost: PricedLine[] = []
  let marginRule: MarginRule | null = null

  try {
    cost = buyCard ? priceLines(inputsFor(buyCard, 'cost', chargeableKg, ctx), opts) : []

    if (sellCard) {
      priced = [...cost, ...priceLines(inputsFor(sellCard, 'revenue', chargeableKg, ctx), opts)]
    } else {
      marginRule = houseMargin(enquiry, opts.baseCurrency)
      if (!marginRule) return { error: 'no_margin' }
      /*
        The margin is laid on the base-currency cost, once for the quotation
        (R2). It used to be applied to each line's card-currency `amount` too,
        which threw a currency mismatch for an absolute or target rule (base)
        on a USD card, and applied that rule once per line. `distributeMargin`
        decides how a whole-quote rule is shared across the lines and rounds
        each one; see its comment for why in proportion to cost.

        The sell line's rate is its sell amount over its quantity, in base —
        never the buy rate it was costed at, which printed beside the margined
        amount on the customer's quotation (qty 2 × our buy rate ≠ the amount)
        and handed the customer the rate we buy at.
      */
      const sells = distributeMargin(
        cost.map((line) => line.amountInBase),
        marginRule,
        lookup,
      )
      priced = [
        ...cost,
        ...cost.map((line, index) => ({
          ...line,
          direction: 'revenue' as const,
          rate: line.quantity.isZero()
            ? sells[index]!.amount
            : sells[index]!.amount.dividedBy(line.quantity),
          amount: sells[index]!,
          amountInBase: sells[index]!,
          fx: identityRate(opts.baseCurrency, pricedAt),
        })),
      ]
    }
  } catch (error) {
    return { error: 'cannot_price', detail: (error as Error).message }
  }

  const revenue = priced.filter((line) => line.direction === 'revenue')
  if (revenue.length === 0) return { error: 'no_cover' }

  /*
    Totals from the lines as they are stored — each rounded to the currency
    first — so the lines on the quotation add up to the total beneath them.
    Rounding the unrounded sum instead could differ from the printed lines by
    a fil per few lines.
  */
  const rounded = priced.map((line) => ({
    direction: line.direction,
    amountInBase: roundWith(line.amountInBase, lookup),
  }))
  const totals = summariseMargin(rounded, opts.baseCurrency)
  /*
    The totals are in the entity's base currency — `summariseMargin` adds each
    line's `amountInBase` — so that is the currency the quotation carries.
    This used to take the first sell line's currency instead: a USD card priced
    for a KWD branch stored KWD totals labelled USD, to three decimals, on the
    register, the comparison page and the quotation. Lines keep their own
    currency; quoting a customer in the card's currency is a separate choice.
  */
  const sellCurrency = opts.baseCurrency

  /*
    Whether this draft needs a person before it is sent (ai-13): a charge sold
    below its cost, or sold with nothing bought for it — outside the scope the
    awarded rate quoted. `draftConcerns` in core states the rule and why it is
    per charge type. Frozen with the rest of the decision, so the quotation
    screen shows the reasons as they were when it was priced.
  */
  const concerns = sellCard
    ? draftConcerns({
        revenue: revenue.map((line) => ({
          chargeTypeKey: line.chargeTypeKey,
          amountInBase: roundWith(line.amountInBase, lookup),
        })),
        cost: cost.map((line) => ({
          chargeTypeKey: line.chargeTypeKey,
          amountInBase: roundWith(line.amountInBase, lookup),
        })),
      })
    : // Buy plus house margin sells exactly what was bought, each above cost.
      []

  /*
    A reply on this enquiry newer than the buy card (R3): the card may be
    stale, so the draft is held for a person and says which reply to look at.
  */
  const newer = buyCard ? await newerRateReplies(tx, enquiryId, buyCard.id) : []

  /*
    The rates lines were actually converted at, once: the stale check below
    and the snapshot's `converted` (which decides the customer's footnote)
    must agree about which rates those were.
  */
  const convertedRates = rates.filter((r) => priced.some((line) => line.amount.currency === r.from))
  const today = todayIn()
  const stale = staleConversions(convertedRates, on < today ? on : today)

  const reviewConcerns = [
    ...concerns,
    ...stale.map((rate) => ({
      kind: 'stale_rate' as const,
      currency: rate.currency,
      effectiveOn: rate.effectiveOn,
      ageDays: rate.ageDays,
    })),
    ...newer.map((reply) => ({
      kind: 'newer_reply' as const,
      partnerEn: reply.partnerEn,
      partnerAr: reply.partnerAr,
      quotedTotal: reply.quotedTotal,
      quotedCurrency: reply.quotedCurrency,
      respondedOn: reply.respondedOn,
    })),
  ]

  const validUntil = new Date(pricedAt)
  validUntil.setUTCDate(validUntil.getUTCDate() + VALIDITY_DAYS)

  return writeQuote(
    tx,
    {
      enquiryId,
      branchId: enquiry.branchId,
      preparedById,
      currency: sellCurrency,
      totalSell: toScale(totals.revenue, lookup),
      totalCost: toScale(totals.cost, lookup),
      validUntil: dayIn(validUntil),
      snapshot: {
        pricedAt: pricedAt.toISOString(),
        marginPct: totals.grossPercent ? Number(totals.grossPercent.toFixed(2)) : 0,
        source: sellCard ? 'sell_card' : 'buy_card_plus_margin',
        sellCardId: sellCard?.id ?? null,
        buyCardId: buyCard?.id ?? null,
        marginRule: marginRule
          ? { kind: marginRule.kind, value: marginRule.value.toString() }
          : null,
        chargeableKg,
        chargeableBasis: derived?.basis ?? null,
        divisorCm3PerKg: rule?.divisorCm3PerKg?.toString() ?? null,
        baseCurrency: opts.baseCurrency,
        /*
          Every rate onto the base that was on file, with whose rate it was and
          when it was taken — so the quotation screen can show the person
          pricing "USD→KWD 0.30918 · ExchangeRate-API · 05 Oct" before they
          send it. `rate` stays the first key readers look for.
        */
        fx: rates.map((r) => ({
          from: r.from,
          to: r.to,
          rate: dec(r.rate).toString(),
          source: r.source,
          effectiveOn: r.effectiveOn,
          takenAt: new Date(r.takenAt).toISOString(),
        })),
        /*
          The rates a line was actually converted at, which is what decides
          whether the customer's quotation carries the conversion footnote
          (`quoteConversionDate` in core). A card already in the base currency
          converts nothing, and a footnote there would be noise.
        */
        converted: convertedRates.map((r) => ({
          from: r.from,
          to: r.to,
          rate: dec(r.rate).toString(),
          source: r.source,
          effectiveOn: r.effectiveOn,
          takenAt: new Date(r.takenAt).toISOString(),
        })),
        inclusions: revenue.map((line) => nameFor(line.chargeTypeKey, sellCard ?? buyCard!)),
        /*
          The buy side line by line, in the quotation's currency and converted
          the way the sell lines are, so the internal comparison can put a buy
          rate beside each sell rate instead of only a buy total (F41). Keyed by
          charge type because that is what joins a buy line to its sell line;
          a sell charge with no buy counterpart simply has no entry. Empty when
          no buy card covered the lane. Quotations priced before this have no
          `lineCosts` at all, and the comparison shows their buy rate as unknown.
        */
        lineCosts: cost.map((line) => ({
          chargeTypeKey: line.chargeTypeKey,
          basis: line.basis,
          quantity: line.quantity.toString(),
          rate: line.rate.times(line.fx.rate).toDecimalPlaces(6).toString(),
          amount: toScale(line.amountInBase, lookup),
          currency: line.amountInBase.currency,
          /*
            The cost as the partner will bill it: the charge, the card's own
            currency, rate and amount, and the rate it was converted at. Booking
            the quotation carries these into the job's cost lines (D13), so the
            accrual sits in the currency a supplier invoice is matched in and
            its base amount is exactly the one this quotation totalled.
          */
          chargeTypeId: buyCard ? chargeTypeIdFor(line.chargeTypeKey, buyCard) : null,
          partnerId: buyCard?.partnerId ?? null,
          cardCurrency: line.amount.currency,
          cardRate: line.rate.toString(),
          cardAmount: toScale(line.amount, lookup),
          fxRate: line.fx.rate.toString(),
        })),
        exclusions: splitLines(enquiry.exclusionsEn),
        exclusionsAr: splitLines(enquiry.exclusionsAr),
        review: { needed: reviewConcerns.length > 0, concerns: reviewConcerns },
      },
      /*
        Lines in the quotation's currency, like its total.

        They were written in the card's currency (USD) under a quotation in the
        base currency (KWD), and the quotation PDF formats every amount in the
        quotation's currency — so a customer was sent "KWD 1,856.000" per
        container for a 1,856 USD rate, five lines summing to 5,281 above a
        total of 1,629.955. Converted at the rate each line was priced at; that
        rate and the card's own currency stay in `priced_snapshot`.
      */
      lines: revenue.map((line, index) => ({
        chargeTypeId: chargeTypeIdFor(line.chargeTypeKey, sellCard ?? buyCard!),
        basis: line.basis,
        quantity: line.quantity.toString(),
        rate: line.rate.times(line.fx.rate).toDecimalPlaces(6).toString(),
        amount: toScale(line.amountInBase, lookup),
        currency: line.amountInBase.currency,
        sortOrder: index,
      })),
    },
    hooks,
  )
}

// --- the pieces `priceEnquiry` was built from --------------------------------

interface EnquiryRow {
  readonly id: string
  readonly branchId: string
  readonly customerId: string | null
  readonly mode: string | null
  readonly originId: string | null
  readonly destinationId: string | null
  readonly readyOn: string | null
  readonly grossWeightKg: string | null
  readonly volumeCbm: string | null
  readonly pieces: number | null
  readonly containerCount: number | null
  readonly baseCurrency: string
  readonly exclusionsEn: string | null
  readonly exclusionsAr: string | null
  readonly marginKind: string | null
  readonly marginValue: string | null
}

/**
 * What the bases are calculated against, from the enquiry's own figures.
 *
 * `containers` is the enquiry's container count on a FCL lane, never `pieces`,
 * which counts packages (F39). The caller has already refused a FCL enquiry
 * without one; the `?? 1` is only for the type. Other modes keep one container,
 * as they always have: a per-container line on an LCL or air card is a flat fee.
 *
 * `cbm` and `grossKg` are the enquiry's volume and actual weight, for the LCL
 * bases `per_cbm` and `per_wm`. Before they existed an agent's per-cbm rate was
 * stored as `per_unit` and multiplied by `pieces`: 8 cbm on 6 pallets at EUR 85
 * was EUR 510, not 680 (N1). A missing volume is left missing, so a per-cbm
 * line refuses to price rather than pricing as free.
 */
function contextFor(
  mode: string,
  cargo: {
    grossWeightKg: string | null
    volumeCbm: string | null
    pieces: number | null
    containerCount: number | null
  },
  chargeableKg: string | null,
): ChargeContext {
  const pieces = cargo.pieces ?? 1
  return {
    kg: chargeableKg ?? cargo.grossWeightKg ?? 0,
    ...(cargo.volumeCbm === null ? {} : { cbm: cargo.volumeCbm }),
    ...(cargo.grossWeightKg === null ? {} : { grossKg: cargo.grossWeightKg }),
    units: pieces,
    containers: mode === 'sea_fcl' ? (cargo.containerCount ?? 1) : 1,
    days: 1,
  }
}

/**
 * A rate card line becomes a `RateLine` the engine can calculate, and the
 * context that line is calculated against — a weight break changes both. See the
 * `selectBreak` note the web original carried: it may bill more kilograms than
 * the consignment weighs where the higher declaration is the lower total.
 */
function rateLineFor(
  line: CoveringRateLine,
  ctx: ChargeContext,
  chargeableKg: string | null,
): { line: RateLine; ctx: ChargeContext } {
  const base: RateLine = {
    basis: line.basis as Basis,
    rate: dec(line.rate),
    currency: line.currency,
    minimum: line.minimum === null ? null : dec(line.minimum),
    maximum: line.maximum === null ? null : dec(line.maximum),
  }

  if (line.basis !== 'per_kg' || !line.weightBreaks?.length || chargeableKg === null) {
    return { line: base, ctx }
  }

  const selection = selectBreak(
    dec(chargeableKg),
    line.weightBreaks.map((b) => ({
      fromKg: dec(b.fromKg),
      ratePerKg: dec(b.ratePerKg),
      ...(b.minimumCharge === undefined ? {} : { minimumCharge: dec(b.minimumCharge) }),
    })),
    line.currency,
  )
  if (!selection) return { line: base, ctx }

  return {
    line: {
      ...base,
      rate: selection.appliedBreak.ratePerKg,
      minimum: selection.appliedBreak.minimumCharge ?? base.minimum,
    },
    ctx: { ...ctx, kg: selection.billedKg },
  }
}

const inputsFor = (
  card: CoveringRateCard,
  direction: 'cost' | 'revenue',
  chargeableKg: string | null,
  ctx: ChargeContext,
): PriceInput[] =>
  card.lines.map((cardLine) => {
    const resolved = rateLineFor(cardLine, ctx, chargeableKg)
    return {
      chargeTypeKey: cardLine.chargeTypeKey,
      direction,
      line: resolved.line,
      ctx: resolved.ctx,
    }
  })

/** The customer's house margin, where they have one — FR-EQ-05. */
function houseMargin(row: EnquiryRow, baseCurrency: string): MarginRule | null {
  if (!row.marginKind || !row.marginValue) return null
  const value = dec(row.marginValue)
  return row.marginKind === 'percent'
    ? { kind: 'percent', value }
    : row.marginKind === 'absolute'
      ? { kind: 'absolute', value, currency: baseCurrency }
      : { kind: 'target_sell', value, currency: baseCurrency }
}

/** One exclusion per line, blank lines dropped. */
function splitLines(value: string | null): string[] {
  return (value ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
}

const lineFor = (key: string, card: CoveringRateCard): CoveringRateLine | undefined =>
  card.lines.find((line) => line.chargeTypeKey === key)

const nameFor = (key: string, card: CoveringRateCard): string =>
  lineFor(key, card)?.chargeNameEn ?? key

const chargeTypeIdFor = (key: string, card: CoveringRateCard): string =>
  lineFor(key, card)!.chargeTypeId

interface QuoteWrite {
  readonly enquiryId: string
  readonly branchId: string
  readonly preparedById: string
  readonly currency: string
  readonly totalSell: string
  readonly totalCost: string
  readonly validUntil: string
  readonly snapshot: Record<string, unknown>
  readonly lines: readonly {
    chargeTypeId: string
    basis: string
    quantity: string
    rate: string
    amount: string
    currency: string
    sortOrder: number
  }[]
}

/**
 * Write the quotation and its lines, superseding the previous version — the same
 * numbering and versioning `createQuote` performs, because it is the same act.
 */
async function writeQuote(
  tx: Tx,
  write: QuoteWrite,
  hooks: PriceEnquiryHooks,
): Promise<PriceOutcome> {
  const next = await nextQuoteVersion(tx, write.enquiryId, hooks)
  if (!next.ok) return { error: next.reason }

  const inserted = await tx
    .execute(
      sql`
    insert into quotes (reference, enquiry_id, branch_id, version, status, currency,
                        total_sell, total_cost, valid_until, priced_snapshot,
                        rate_card_version_id, prepared_by_id)
    values (${next.reference}, ${write.enquiryId},
            ${write.branchId}, ${next.version}, 'draft', ${write.currency},
            ${write.totalSell}, ${write.totalCost}, ${write.validUntil}::date,
            ${JSON.stringify(write.snapshot)}::jsonb,
            ${(write.snapshot.sellCardId as string | null) ?? null}, ${write.preparedById})
    returning id, reference
  `,
    )
    .then((r) => r.rows[0] as { id: string; reference: string })

  for (const line of write.lines) {
    await tx.execute(sql`
      insert into quote_lines (quote_id, charge_type_id, basis, quantity, rate,
                               amount, currency, sort_order)
      values (${inserted.id}, ${line.chargeTypeId}, ${line.basis}, ${line.quantity},
              ${line.rate}, ${line.amount}, ${line.currency}, ${line.sortOrder})
    `)
  }

  await retireQuoteVersion(tx, next.previousId, inserted.id)

  // The enquiry has been answered — a priced quotation is a first reply.
  await tx.execute(sql`
    update enquiries
       set status = case when status in ('new', 'assigned') then 'quoted'::enquiry_status
                         else status end,
           first_responded_at = coalesce(first_responded_at, now()),
           updated_at = now()
     where id = ${write.enquiryId}
  `)

  return { reference: inserted.reference }
}

// --- versioning, shared with the manual "New quotation" form ----------------

export type QuoteVersionOutcome =
  | {
      readonly ok: true
      readonly version: number
      readonly reference: string
      /** The version this one replaces, or null for a first quotation. */
      readonly previousId: string | null
    }
  | { readonly ok: false; readonly reason: 'quote_accepted' | 'already_quoted' }

/**
 * The next version and reference for an enquiry's quotation — the numbering
 * `priceEnquiryToQuote` and the web's `createQuote` both perform, because they
 * are the same act and drifted apart as two copies.
 *
 * Three rules, each a bug it once was:
 *
 * - **The enquiry row is locked first.** Auto-draft and a coordinator's "Price
 *   it" in the same minute both read "no quote yet", both computed version 1,
 *   and the second died on `quotes_version_unique` (S19). `for update` on the
 *   enquiry makes the second wait for the first and then number after it.
 * - **An accepted quotation is never superseded.** Re-pricing used to retire
 *   whatever the latest version was, accepted or not, with no machine check —
 *   one click un-accepted the offer a job may already be booked against (S2).
 *   The customer said yes to that version; a different price now is a new
 *   enquiry, not a revision.
 * - **The reference is the first version's stem.** `createQuote` stemmed from
 *   the previous reference whole, so v7 was `QUO-2026-00006-v2-v3-v4-v5-v6-v7`
 *   (S6). Every trailing `-vN` is stripped, which also stops references
 *   already compounded that way from growing further.
 */
export async function nextQuoteVersion(
  tx: Tx,
  enquiryId: string,
  hooks: PriceEnquiryHooks = {},
): Promise<QuoteVersionOutcome> {
  await tx.execute(sql`select id from enquiries where id = ${enquiryId} for update`)

  const [latest] = await tx
    .execute(
      sql`
    select id, version, reference,
           exists (select 1 from quotes a
                    where a.enquiry_id = ${enquiryId} and a.status = 'accepted') as "hasAccepted"
      from quotes
     where enquiry_id = ${enquiryId}
     order by version desc limit 1
  `,
    )
    .then(
      (r) => r.rows as { id: string; version: number; reference: string; hasAccepted: boolean }[],
    )

  if (latest?.hasAccepted) return { ok: false, reason: 'quote_accepted' }
  if (latest && hooks.firstOnly) return { ok: false, reason: 'already_quoted' }
  if (latest) hooks.assertRevise?.()

  const version = (latest?.version ?? 0) + 1
  let stem = latest?.reference.replace(/(-v\d+)+$/, '')
  if (!stem) {
    const seqRow = await tx.execute(sql`select nextval('quote_reference_seq')::text as seq`)
    const seq = (seqRow.rows[0] as { seq: string }).seq
    stem = `QUO-${new Date().getUTCFullYear()}-${seq.padStart(5, '0')}`
  }

  return {
    ok: true,
    version,
    reference: version === 1 ? stem : `${stem}-v${version}`,
    previousId: latest?.id ?? null,
  }
}

/**
 * Point the replaced version at its replacement, and retire it where the quote
 * machine allows.
 *
 * `superseded_by_id` is what every "current quotation" read filters on — the
 * enquiry queue, the comparison page — and nothing wrote it, so an enquiry
 * priced seven times appeared seven times in the queue and withdrawn versions
 * were offered as options, one of them "Recommended" (S3). It is set whatever
 * the old status: a rejected or expired version is no more current than a
 * superseded one. The *status* moves only from `draft` or `sent`, the two
 * states `quoteMachine` lets a revision supersede; a rejected quote stays
 * rejected, because that is what the customer said.
 */
export async function retireQuoteVersion(
  tx: Tx,
  previousId: string | null,
  replacementId: string,
): Promise<void> {
  if (!previousId) return
  await tx.execute(sql`
    update quotes
       set superseded_by_id = ${replacementId},
           status = case when status in ('draft', 'sent') then 'superseded'::quote_status
                         else status end,
           updated_at = now()
     where id = ${previousId}
  `)
}
