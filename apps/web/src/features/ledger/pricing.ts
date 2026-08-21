'use server'

/**
 * Pricing an enquiry off a rate card — FR-EQ-05, FR-RT-01…06.
 *
 * The half of the product the rest of it was built around, and the one that
 * had never been connected: `@qabandi/core` has carried a complete charge
 * engine since Release One — `calcCharge`, `priceLines`, `selectBreak`,
 * `applyMargin`, all covered by unit tests that run against no infrastructure
 * — and nothing outside the package called any of it. Rate cards could be
 * imported and listed; nothing read `rate_card_lines` back. Every quotation in
 * the system was typed by hand.
 *
 * ## What "no human input" means (FR-EQ-05)
 *
 * A covered enquiry produces a complete option: the lane's sell card is found,
 * every line on it is calculated against the consignment, and the result is a
 * draft quotation with its lines, its total and its validity. Where a buy card
 * also covers the lane the cost is priced alongside, so the internal
 * comparison (FR-EQ-07) has a margin to show rather than a column of dashes.
 *
 * ## Where the sell price comes from, in order
 *
 * 1. A **sell card** covering the lane. Its rates are the price; nothing is
 *    added to them, because somebody already decided what this customer pays.
 * 2. Failing that, a **buy card** plus the house margin on
 *    `customer_branch_terms` — the column whose comment has said "House margin
 *    for instant quotes — FR-EQ-05" since the schema was written.
 * 3. Failing both, nothing. An uncovered lane is an agent RFQ (FR-RT-10), and
 *    inventing a price for it would be worse than saying there is no cover.
 *
 * ## Nothing is recomputed afterwards
 *
 * The whole decision is frozen into `quotes.priced_snapshot` — the resolved
 * lines, the chargeable weight and the divisor that produced it, the FX rate
 * and its timestamp, the margin rule applied. That is what makes a June
 * invoice reconcile to a March booking (FR-RT-06), and what stops a rate card
 * edit rewriting history. A revision is a new row (FR-RT-08); this never edits
 * one.
 */

import { revalidatePath } from 'next/cache'
import { sql } from 'drizzle-orm'
import {
  applyMargin,
  chargeableWeight,
  currencyLookup,
  dec,
  fxRate,
  priceLines,
  selectBreak,
  summariseMargin,
  toScale,
  type Basis,
  type ChargeContext,
  type MarginRule,
  type PriceInput,
  type PricedLine,
  type PricingOptions,
  type RateLine,
} from '@qabandi/core'
import {
  chargeableRuleFor,
  findCoveringRateCard,
  withActor,
  type CoveringRateCard,
  type CoveringRateLine,
} from '@qabandi/db'
import { requireSession } from '@/lib/session'
import { assertCan, assertInBranch } from '@/lib/permissions'
import { failWith, succeed, type ActionState } from '@/lib/form-state'

/**
 * What pricing can answer with.
 *
 * Declared rather than inferred so a new refusal has to be given a message in
 * `REFUSALS` below — an unmatched key would otherwise fall through to the
 * generic sentence, which is how a specific, actionable refusal turns into
 * "that could not be priced" without anybody noticing.
 */
type Refusal = 'not_found' | 'no_mode' | 'no_cover' | 'no_margin' | 'cannot_price'

type PriceOutcome =
  | { readonly reference: string }
  | { readonly error: Refusal; readonly detail?: string }

/** How long an instant quotation stands. Beyond this it expires by itself. */
const VALIDITY_DAYS = 14

function read(form: FormData, key: string): string | undefined {
  const value = form.get(key)
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

/**
 * What the six bases are calculated against, from the enquiry's own figures.
 *
 * `containers` comes from `pieces` on a full-container enquiry and that is a
 * judgement, not an accident: an FCL enquiry states its count in the only
 * numeric field the form offers, and a customer writing "2" means two boxes.
 * On every other mode `pieces` is cartons and is offered as `units`, which is
 * what a per-unit line means there. Getting this wrong is a quotation that is
 * out by a factor of the container count, so it is stated once, here.
 */
function contextFor(
  mode: string,
  cargo: { grossWeightKg: string | null; volumeCbm: string | null; pieces: number | null },
  chargeableKg: string | null,
): ChargeContext {
  const pieces = cargo.pieces ?? 1
  return {
    // The rated weight where one was derived, and the gross where it was not.
    // A `per_kg` line must never quietly bill actual weight on an air
    // consignment that is billed on volume.
    kg: chargeableKg ?? cargo.grossWeightKg ?? 0,
    units: pieces,
    containers: mode === 'sea_fcl' ? pieces : 1,
    // Free time is not consumed at quoting time; a `per_day` line on a rate
    // card is a demurrage tariff, and it prices at one day so the line appears
    // on the quotation with its rate visible rather than vanishing.
    days: 1,
  }
}

/**
 * A rate card line becomes a `RateLine` the engine can calculate, and the
 * context that line is calculated against.
 *
 * Both, because a weight break changes the quantity as well as the rate.
 * `selectBreak` may bill *more* kilograms than the consignment weighs: a 95 kg
 * air shipment at the +45 rate can cost more than declaring 100 kg at the +100
 * rate, and airlines and forwarders bill the lower of the two. Returning only
 * the rate and pricing it against the actual weight would take the cheaper
 * rate without the declaration that earns it, and undercharge every
 * consignment sitting just below a break.
 *
 * Resolved here rather than inside `calcCharge` because choosing a band is a
 * lookup and the charge engine is arithmetic.
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
      /*
        The band's own floor wins over the line's where it has one — a 100 kg
        band carrying a minimum charge is the minimum for that band. Applied
        through `minimum` rather than by taking `selection.amount` directly,
        so the quotation still shows a rate and a weight rather than one
        opaque figure the customer cannot check.
      */
      minimum: selection.appliedBreak.minimumCharge ?? base.minimum,
    },
    // The weight actually declared, which is what makes the cheaper band
    // legitimate. Equal to the consignment's weight except where rounding up
    // to the next break was the lower total.
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

/**
 * Price an enquiry and write the quotation it produces.
 *
 * Returns a message rather than throwing when there is no cover: "no rate card
 * covers this lane" is an answer a coordinator acts on by raising an RFQ, not
 * a fault.
 */
export async function priceEnquiry(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const session = await requireSession()
  assertCan(session, 'quote.send')

  const enquiryId = read(form, 'enquiryId')
  if (!enquiryId) return failWith('Nothing to price.')

  const outcome: PriceOutcome = await withActor(session.actor, async (tx): Promise<PriceOutcome> => {
    const [enquiry] = await tx.execute(sql`
      select e.id, e.branch_id as "branchId", e.customer_id as "customerId",
             e.mode::text as mode, e.origin_id as "originId",
             e.destination_id as "destinationId", e.ready_on::text as "readyOn",
             e.gross_weight_kg::text as "grossWeightKg",
             e.volume_cbm::text as "volumeCbm", e.pieces,
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
    `).then((r) => r.rows as unknown as EnquiryRow[])

    if (!enquiry) return { error: 'not_found' as const }
    assertInBranch(session, enquiry.branchId)
    if (!enquiry.mode) return { error: 'no_mode' as const }

    /*
      Cover is asked for on the readiness date, not today.

      A shipment ready in six weeks is priced against the card that will be
      live then — quoting it off today's tariff and watching it lapse before
      the booking is the exact failure `validity` exists to prevent.
    */
    const on = enquiry.readyOn ?? new Date().toISOString().slice(0, 10)

    const lane = {
      mode: enquiry.mode,
      originId: enquiry.originId,
      destinationId: enquiry.destinationId,
      on,
      customerId: enquiry.customerId,
    }

    /*
      Sequential, and on the caller's transaction.

      Both were once `Promise.all` over lookups that each opened a transaction
      of their own — three connections held at once by a single price run, and
      a pool that could not supply the third waited rather than failed. Reading
      inside the transaction that writes the quotation is also the correct
      isolation: the card that priced it is the card as it stood at that
      instant.
    */
    const sellCard = await findCoveringRateCard(tx, { ...lane, direction: 'sell' })
    const buyCard = await findCoveringRateCard(tx, { ...lane, direction: 'buy' })

    if (!sellCard && !buyCard) return { error: 'no_cover' as const }

    /*
      The chargeable weight, and the rule that produced it.

      Both go into the snapshot. "Why is this 200kg when the shipment weighs
      100" is a question somebody asks about an air quotation roughly once a
      week, and the answer is the divisor — which is configuration and can
      change (FR-AD-03), so recording the number without the rule that made it
      answers the question with a number nobody can check.
    */
    const rule = await chargeableRuleFor(tx, enquiry.mode, enquiry.branchId)
    const derived =
      rule && (enquiry.grossWeightKg || enquiry.volumeCbm)
        ? chargeableWeight(
            {
              grossWeightKg: enquiry.grossWeightKg ?? 0,
              volumeCbm: enquiry.volumeCbm ?? 0,
            },
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
      One FX rate per currency, resolved once and stamped on every line.

      The newest rate on or before the pricing date, never a later one: a quote
      priced in March must not silently re-rate when April's feed lands, which
      is the whole of FR-RT-06.
    */
    const rates = await tx
      .execute(sql`
        select distinct on (from_currency)
               from_currency as "from", to_currency as "to", rate::text as rate,
               effective_on::text as "effectiveOn"
          from fx_rates
         where to_currency = ${enquiry.baseCurrency}
           and effective_on <= ${on}::date
         order by from_currency, effective_on desc
      `)
      .then((r) => r.rows as unknown as { from: string; to: string; rate: string }[])

    const pricedAt = new Date()
    const opts: PricingOptions = {
      baseCurrency: enquiry.baseCurrency,
      fxRates: rates.map((r) => fxRate(r.from, r.to, dec(r.rate), pricedAt)),
      currencies: lookup,
      pricedAt,
    }

    let priced: PricedLine[]
    let marginRule: MarginRule | null = null

    try {
      const cost = buyCard ? priceLines(inputsFor(buyCard, 'cost', chargeableKg, ctx), opts) : []

      if (sellCard) {
        // A sell card is the price. Nothing is added to it — somebody has
        // already decided what this customer pays for this lane.
        priced = [...cost, ...priceLines(inputsFor(sellCard, 'revenue', chargeableKg, ctx), opts)]
      } else {
        marginRule = houseMargin(enquiry, opts.baseCurrency)
        if (!marginRule) return { error: 'no_margin' as const }
        // Buy card plus the house rule: every cost line becomes a revenue line
        // at the marked-up amount, so the customer sees the same breakdown
        // rather than one opaque total.
        priced = [
          ...cost,
          ...cost.map((line) => ({
            ...line,
            direction: 'revenue' as const,
            amount: applyMargin(line.amount, marginRule!),
            amountInBase: applyMargin(line.amountInBase, marginRule!),
          })),
        ]
      }
    } catch (error) {
      // `MissingChargeContextError` and `UnknownCurrencyError` are both the
      // operator's to fix — a card line billing per container against an
      // enquiry with no count, or a currency with no rate to base.
      return { error: 'cannot_price' as const, detail: (error as Error).message }
    }

    const revenue = priced.filter((line) => line.direction === 'revenue')
    if (revenue.length === 0) return { error: 'no_cover' as const }

    const totals = summariseMargin(priced, opts.baseCurrency)
    const sellCurrency = revenue[0]!.amount.currency

    const validUntil = new Date(pricedAt)
    validUntil.setUTCDate(validUntil.getUTCDate() + VALIDITY_DAYS)

    const reference = await writeQuote(tx, {
      enquiryId,
      branchId: enquiry.branchId,
      preparedById: session.principal.id,
      currency: sellCurrency,
      /*
        Scaled by the currency table, not `toScale`'s seeded default.

        A deployment that added a currency by hand has it in `currencies` and
        not in `SEED_CURRENCIES`, and the default lookup would throw on it —
        after the quotation had been priced. KWD's third decimal is the same
        argument from the other end.
      */
      totalSell: toScale(totals.revenue, lookup),
      totalCost: toScale(totals.cost, lookup),
      validUntil: validUntil.toISOString().slice(0, 10),
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
        fx: opts.fxRates.map((r) => ({ from: r.from, to: r.to, rate: r.rate.toString() })),
        // Derived from what was actually priced, so the block on the PDF can
        // never disagree with the table above it.
        inclusions: revenue.map((line) => nameFor(line.chargeTypeKey, sellCard ?? buyCard!)),
        exclusions: splitLines(enquiry.exclusionsEn),
        exclusionsAr: splitLines(enquiry.exclusionsAr),
      },
      lines: revenue.map((line, index) => ({
        chargeTypeId: chargeTypeIdFor(line.chargeTypeKey, sellCard ?? buyCard!),
        basis: line.basis,
        quantity: line.quantity.toString(),
        rate: line.rate.toString(),
        amount: toScale(line.amount, lookup),
        currency: line.amount.currency,
        sortOrder: index,
      })),
    }, () => assertCan(session, 'quote.revise'))

    return { reference }
  })

  if ('error' in outcome) return failWith(REFUSALS[outcome.error])

  revalidatePath('/quotes')
  revalidatePath(`/enquiries/${enquiryId}`)
  revalidatePath('/dashboard')
  return succeed(outcome.reference)
}

const REFUSALS: Record<Refusal, string> = {
  not_found: 'No such enquiry, or it is not one you can see.',
  no_mode: 'The enquiry has no transport mode, so there is nothing to price it against.',
  no_cover:
    'No rate card covers this lane and mode on the readiness date. Ask an agent for a rate, or load the card.',
  no_margin:
    'Only a buying rate covers this lane, and this customer has no house margin set. Add one on their account, or load a selling card.',
  cannot_price:
    'The card needs a figure this enquiry does not carry — a container count, or a currency with no rate to the base.',
}

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
  readonly baseCurrency: string
  readonly exclusionsEn: string | null
  readonly exclusionsAr: string | null
  readonly marginKind: string | null
  readonly marginValue: string | null
}

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
 * Writes the quotation and its lines, superseding the previous version.
 *
 * The same numbering and versioning `createQuote` performs, because it is the
 * same act — a quotation is a quotation whether a person typed it or a rate
 * card produced it, and two ways of numbering one would put two series in the
 * register.
 */
async function writeQuote(
  // The transaction the caller is already inside; this must be atomic with the
  // supersede above it, or two live versions exist for an instant.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx: any,
  write: QuoteWrite,
  /** Called before superseding, so the permission check happens once. */
  assertRevise: () => void,
): Promise<string> {
  const [latest] = await tx.execute(sql`
    select id, version, reference from quotes
     where enquiry_id = ${write.enquiryId}
     order by version desc limit 1
  `).then((r: { rows: unknown[] }) => r.rows as { id: string; version: number; reference: string }[])

  /*
    Superseding an existing quotation is a revision, and needs its own key.

    `quote.revise` is declared on the machine's `sent → superseded` edge and
    was checked nowhere: pricing an enquiry a second time withdrew a quotation
    the customer was holding, on `quote.send` alone. Raising the first one is
    still `quote.send` — there is nothing to withdraw.
  */
  if (latest) assertRevise()

  const version = (latest?.version ?? 0) + 1
  const seqRow = await tx.execute(sql`select nextval('quote_reference_seq')::text as seq`)
  const seq = (seqRow.rows[0] as { seq: string }).seq
  const year = new Date().getUTCFullYear()
  const stem = latest?.reference?.replace(/-v\d+$/, '') ?? `QUO-${year}-${seq.padStart(5, '0')}`

  const inserted = await tx.execute(sql`
    insert into quotes (reference, enquiry_id, branch_id, version, status, currency,
                        total_sell, total_cost, valid_until, priced_snapshot,
                        rate_card_version_id, prepared_by_id)
    values (${version === 1 ? stem : `${stem}-v${version}`}, ${write.enquiryId},
            ${write.branchId}, ${version}, 'draft', ${write.currency},
            ${write.totalSell}, ${write.totalCost}, ${write.validUntil}::date,
            ${JSON.stringify(write.snapshot)}::jsonb,
            ${(write.snapshot.sellCardId as string | null) ?? null}, ${write.preparedById})
    returning id, reference
  `).then((r: { rows: unknown[] }) => r.rows[0] as { id: string; reference: string })

  for (const line of write.lines) {
    await tx.execute(sql`
      insert into quote_lines (quote_id, charge_type_id, basis, quantity, rate,
                               amount, currency, sort_order)
      values (${inserted.id}, ${line.chargeTypeId}, ${line.basis}, ${line.quantity},
              ${line.rate}, ${line.amount}, ${line.currency}, ${line.sortOrder})
    `)
  }

  if (latest) {
    await tx.execute(sql`
      update quotes set status = 'superseded', updated_at = now() where id = ${latest.id}
    `)
  }

  // The enquiry has been answered — the SLA clock stops on the first reply,
  // and a priced quotation is one.
  await tx.execute(sql`
    update enquiries
       set status = case when status in ('new', 'assigned') then 'quoted'::enquiry_status
                         else status end,
           first_responded_at = coalesce(first_responded_at, now()),
           updated_at = now()
     where id = ${write.enquiryId}
  `)

  return inserted.reference
}
