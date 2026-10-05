/**
 * Promoting a parsed agent reply into a versioned buy rate card — FR-RT-10.
 *
 * This lived in `apps/web` when a coordinator clicking "accept" was the only
 * caller. It moved here the day auto-promotion became a second caller: the
 * service picks the cheapest reply and promotes it without a click, and the
 * card it writes must be byte-for-byte the card the button writes — same
 * grouping, same code resolution, same renewal clamp. This is the money side of
 * the ledger, and two copies of it is two places for a buy rate to come out
 * different depending on who awarded it.
 *
 * The lines are replayed through `groupRateCards` — the reply stored them in
 * exactly that shape — and the codes are resolved to ids here, so a location or
 * charge type retired since the reply arrived fails loudly rather than writing a
 * card that points at nothing. The caller supplies the actored transaction and
 * who is awarding the rate; everything else is decided here.
 */

import { and, eq, inArray, sql } from 'drizzle-orm'
import { type Basis, rateReplyContext, rateReplyReview, summariseRateReply } from '@qabandi/core'
import { groupRateCards, type ImportRow, type RateRowValues } from '@qabandi/core/import'
import {
  chargeTypes,
  enquiries,
  locations,
  rateCardLines,
  rateCards,
  rateRequests,
} from './schema/index'
import type { Tx } from './actor'
import { chargeableRuleFor } from './chargeable'

/**
 * Why a reply was not promoted, as a stable code.
 *
 * The code is what a screen translates — `acceptRateReply` maps each one to a
 * catalogue message, and its `never` default fails the typecheck when one is
 * added here without a sentence there. `message` stays beside it in English for
 * the callers that are not a person: the service's auto-promote sweep and a
 * log line, which have no locale and want the fact as written.
 */
export type PromoteRefusal =
  | 'request_gone'
  | 'already_promoted'
  | 'not_parsed'
  | 'declined'
  | 'no_clean_lines'
  | 'port_missing'
  | 'renewal_ends_early'
  | 'charge_missing'
  /** The model read a different lane from the one asked about (S14). */
  | 'lane_mismatch'
  /** The agent has a card on this lane starting on or after this one (S5). */
  | 'overlaps_card'
  /** A line is kept as "other" and nobody has named the charge yet (R1). */
  | 'unclassified_charge'

export type PromoteResult =
  | { readonly ok: true; readonly cardId: string }
  | {
      readonly ok: false
      readonly reason: PromoteRefusal
      /** The figures the sentence names, for the codes that name any. */
      readonly values?: Readonly<Record<string, string>>
      readonly message: string
    }

export interface PromoteOptions {
  /**
   * Replace the agent's own cards on this lane that start on or after the new
   * one, instead of refusing (R3). Only a person sets it, having been told
   * which card it replaces: the auto-award never supersedes a rate.
   */
  readonly supersede?: boolean
}

/** Half-open `[from,to)`, written explicitly because the column is not null. */
function dateRangeLiteral(from: string, to: string | null): string {
  return `[${from},${to ?? ''})`
}

/**
 * Turn one parsed reply into a buy card, and mark the request accepted.
 *
 * Refuses anything the caller should see refused: a reply that declined, did
 * not parse cleanly, or was already promoted. A renewal (`source_rate_card_id`)
 * has its start clamped to no earlier than the card it renews ends, because
 * clamping is what "your new rate takes over when the current one lapses"
 * means. `options.supersede` is the other way to make room: a person replacing
 * the agent's card that starts on or after this one (R3).
 */
export async function promoteRateReply(
  tx: Tx,
  rateRequestId: string,
  createdById: string,
  options: PromoteOptions = {},
): Promise<PromoteResult> {
  const [request] = await tx
    .select({
      id: rateRequests.id,
      branchId: rateRequests.branchId,
      partnerId: rateRequests.partnerId,
      status: rateRequests.status,
      rateCardId: rateRequests.rateCardId,
      sourceRateCardId: rateRequests.sourceRateCardId,
      response: rateRequests.response,
    })
    .from(rateRequests)
    .where(eq(rateRequests.id, rateRequestId))
    .limit(1)

  if (!request) return { ok: false, reason: 'request_gone', message: 'That rate request is gone.' }
  if (request.rateCardId) {
    return {
      ok: false,
      reason: 'already_promoted',
      message: 'This reply is already a rate card.',
    }
  }
  if (request.status !== 'parsed') {
    return {
      ok: false,
      reason: 'not_parsed',
      message: 'Only a parsed reply can become a rate card.',
    }
  }

  const response = (request.response ?? {}) as {
    ok?: boolean
    declined?: boolean
    laneMismatch?: string
    rows?: RateRowValues[]
  }
  if (response.declined) {
    return { ok: false, reason: 'declined', message: 'The agent declined this lane.' }
  }
  /*
    A reply that priced another lane is not this enquiry's buy rate (S14).
    The comparison showed the mismatch and still offered Accept, and the
    auto-award never looked: it awarded a card for a lane nobody asked to
    cover, and pricing then found no cover for the one that was.
  */
  if (response.laneMismatch) {
    return {
      ok: false,
      reason: 'lane_mismatch',
      values: { lane: response.laneMismatch },
      message: `The reply priced a different lane (${response.laneMismatch}).`,
    }
  }
  if (response.ok !== true || !Array.isArray(response.rows) || response.rows.length === 0) {
    return {
      ok: false,
      reason: 'no_clean_lines',
      message: 'This reply has no clean lines to promote.',
    }
  }

  /*
    A line kept as "other" is money nobody has named (R1). The comparison
    showed a note asking for a name "before making a rate card" and the
    button made the card anyway, with an unnamed line every later quote
    priced from (live run 6). Refused here so the click and the auto-award
    are held to the same rule; the sweep already skips flagged replies.
  */
  const unnamed = rateReplyReview(request.response).unclassified
  if (unnamed.length > 0) {
    const first = unnamed[0]!
    return {
      ok: false,
      reason: 'unclassified_charge',
      values: { charge: first.description, line: String(first.line) },
      message: `Line ${first.line}${first.description ? ` (${first.description})` : ''} has no charge type. Name it before making a rate card.`,
    }
  }

  const importRows: ImportRow<RateRowValues>[] = response.rows.map((values, index) => ({
    line: index + 1,
    values,
  }))
  const cards = groupRateCards(importRows)

  // Resolve the codes the reply carries to ids, once for the whole set.
  const locationCodes = new Set<string>()
  const chargeCodes = new Set<string>()
  for (const card of cards) {
    locationCodes.add(card.originCode)
    locationCodes.add(card.destinationCode)
    for (const line of card.lines) chargeCodes.add(line.chargeCode)
  }
  const locationIds = await resolveCodes(tx, [...locationCodes])
  const chargeIds = await resolveCharges(tx, [...chargeCodes])

  const renewalFloor = request.sourceRateCardId
    ? ((
        await tx
          .select({ validTo: rateCards.validTo })
          .from(rateCards)
          .where(eq(rateCards.id, request.sourceRateCardId))
          .limit(1)
      )[0]?.validTo ?? null)
    : null

  /*
    Every card is checked before any is written.

    A reply can group into several cards, and this used to insert each one as
    it passed its checks — so a refusal on the third card *returned* with the
    first two already inserted, the transaction committed them, and the
    request stayed unaccepted: orphan buy cards that the next attempt would
    then collide with on the no-overlap constraint. A refusal is a return, not
    a throw, because the caller shows it as a sentence; returning is only safe
    if nothing has been written yet.
  */
  const prepared = []
  for (const card of cards) {
    const originId = locationIds.get(card.originCode.toUpperCase())
    const destinationId = locationIds.get(card.destinationCode.toUpperCase())
    if (!originId || !destinationId) {
      return {
        ok: false,
        reason: 'port_missing',
        values: { origin: card.originCode, destination: card.destinationCode },
        message: `A port on the reply (${card.originCode}→${card.destinationCode}) is no longer on file.`,
      }
    }

    const validFrom = renewalFloor && card.validFrom < renewalFloor ? renewalFloor : card.validFrom
    if (card.validTo && validFrom >= card.validTo) {
      /*
        `lapses` is the clamped start rather than `renewalFloor` itself. They
        are the same date whenever the clamp fired, and when it did not the
        card simply ends on or before its own start — naming the start is then
        the true figure, where the floor would print "null" into the sentence.
      */
      return {
        ok: false,
        reason: 'renewal_ends_early',
        values: { validTo: card.validTo, lapses: validFrom },
        message: `This quote ends ${card.validTo}, before the current rate lapses ${renewalFloor}. It cannot renew the lane.`,
      }
    }

    // A charge type retired between the reply and the promotion. Once an
    // exception thrown mid-insert; now a refusal, because nothing is written yet.
    const lines = []
    for (const line of card.lines) {
      const chargeTypeId = chargeIds.get(line.chargeCode.toUpperCase())
      if (!chargeTypeId) {
        return {
          ok: false,
          reason: 'charge_missing',
          values: { charge: line.chargeCode },
          message: `Charge ${line.chargeCode} is no longer on file.`,
        }
      }
      lines.push({ line, chargeTypeId })
    }

    /*
      The agent's own live card on this lane (S5).

      `rate_cards_no_overlap` holds one card per partner, lane and window, and
      only a renewal was clamped to start where the old card ends — so an
      ordinary RFQ award to an agent who already had a card on the lane threw
      23P01, and a reply with no end date, stored open-ended, blocked every
      later award from that agent on that lane for good. The newer rate is the
      decision, so a card that started earlier is *ended* where this one
      starts: its earlier window still answers enquiries ready before then,
      which is why it is ended rather than marked superseded (pricing skips a
      superseded card on every date). Nothing is deleted. A card starting on
      or after this one cannot be ended before it began, so that is refused
      with the date, for a person to settle.

      Scoped to the request's branch, as the constraint is once it carries
      `branch_id` (S15): another branch's card on the same agent and lane is
      that branch's business and its RLS hides it from this one anyway.
    */
    const overlapping = await tx
      .execute(
        sql`
        select id, valid_from::text as "validFrom"
          from rate_cards
         where direction = 'buy'
           and partner_id is not distinct from ${request.partnerId}
           and customer_id is null
           and branch_id = ${request.branchId}
           and mode = ${card.mode}::transport_mode
           and origin_id = ${originId}
           and destination_id = ${destinationId}
           and superseded_by_id is null
           and validity && daterange(${validFrom}::date, ${card.validTo}::date, '[)')
      `,
      )
      .then((r) => r.rows as { id: string; validFrom: string }[])

    /*
      A card starting on or after this one cannot be ended before it began.
      Live run 5 (R3): RTMAG's second reply on a lane the same day was
      refused here, and Price it went on costing from the first card with no
      word on the quotation. Refused still by default, with the date, but a
      person can now choose to replace it: the old card is marked superseded
      by the new one — kept, with its window and lines, as history; every
      read of live cover already skips it (0066).
    */
    const later = overlapping.filter((existing) => existing.validFrom >= validFrom)
    if (later.length > 0 && !options.supersede) {
      const first = later.reduce((a, b) => (a.validFrom <= b.validFrom ? a : b))
      return {
        ok: false,
        reason: 'overlaps_card',
        values: { validFrom: first.validFrom },
        message: `This agent already has a rate on this lane from ${first.validFrom}; it would overlap.`,
      }
    }
    const laterIds = new Set(later.map((existing) => existing.id))

    prepared.push({
      card,
      originId,
      destinationId,
      validFrom,
      lines,
      toEnd: overlapping.filter((existing) => !laterIds.has(existing.id)).map((e) => e.id),
      toSupersede: [...laterIds],
    })
  }

  let firstCardId: string | null = null
  for (const { card, originId, destinationId, validFrom, lines, toEnd, toSupersede } of prepared) {
    /*
      The old card has to leave the overlap key before the new one can take
      its window, and `superseded_by_id` is a foreign key, so it cannot name
      the new card before that card exists. So it is retired in two steps in
      this one transaction: first pointed at itself (out of the key, which
      counts live cards only, 0066), then at its replacement once that is
      written. The audit log shows both; the second is the one that stands.
    */
    if (toSupersede.length > 0) {
      await tx
        .update(rateCards)
        .set({ supersededById: sql`${rateCards.id}`, updatedAt: new Date() })
        .where(inArray(rateCards.id, toSupersede))
    }
    if (toEnd.length > 0) {
      await tx
        .update(rateCards)
        .set({ validTo: validFrom, updatedAt: new Date() })
        .where(inArray(rateCards.id, toEnd))
    }

    const [inserted] = await tx
      .insert(rateCards)
      .values({
        direction: 'buy' as const,
        partnerId: request.partnerId,
        customerId: null,
        branchId: request.branchId,
        mode: card.mode as 'sea_fcl' | 'sea_lcl' | 'air' | 'land' | 'courier',
        originId,
        destinationId,
        validity: dateRangeLiteral(validFrom, card.validTo),
        validFrom,
        validTo: card.validTo,
        currency: card.currency,
        notes: card.notes,
        createdById,
      })
      .returning({ id: rateCards.id })

    firstCardId ??= inserted!.id

    if (toSupersede.length > 0) {
      await tx
        .update(rateCards)
        .set({ supersededById: inserted!.id, updatedAt: new Date() })
        .where(inArray(rateCards.id, toSupersede))
    }

    await tx.insert(rateCardLines).values(
      lines.map(({ line, chargeTypeId }) => {
        return {
          rateCardId: inserted!.id,
          chargeTypeId,
          basis: line.basis as Basis,
          rate: line.rate,
          currency: line.currency,
          minimum: line.minimum,
          maximum: line.maximum,
          containerType: line.containerType,
          sortOrder: line.sortOrder,
        }
      }),
    )
  }

  await tx
    .update(rateRequests)
    .set({ status: 'accepted', rateCardId: firstCardId })
    .where(eq(rateRequests.id, rateRequestId))

  return { ok: true, cardId: firstCardId ?? '' }
}

/**
 * Re-price the replies already read on an enquiry against its current figures
 * — R1.
 *
 * A reply's headline total and its unpriced count are frozen when the model
 * reads it. One that arrived before a coordinator entered the container count
 * had every per-container line unpriced, stayed "partial" after the count was
 * set, and was never ranked or auto-awarded. Called when the count changes;
 * the stored `response.rows` are exactly what `summariseRateReply` reads, so
 * nothing is re-extracted and no model is asked again.
 */
export async function resummariseRateReplies(tx: Tx, enquiryId: string): Promise<number> {
  const [enquiry] = await tx
    .select({
      mode: enquiries.mode,
      branchId: enquiries.branchId,
      grossWeightKg: enquiries.grossWeightKg,
      volumeCbm: enquiries.volumeCbm,
      pieces: enquiries.pieces,
      containerCount: enquiries.containerCount,
    })
    .from(enquiries)
    .where(eq(enquiries.id, enquiryId))
    .limit(1)
  if (!enquiry) return 0
  // The branch's own volumetric rule, as pricing reads it, so a reply ranks on
  // the chargeable weight the quote will be struck on (N3).
  const ctx = rateReplyContext(enquiry, await chargeableRuleFor(tx, enquiry.mode, enquiry.branchId))

  const replies = await tx
    .select({ id: rateRequests.id, response: rateRequests.response })
    .from(rateRequests)
    .where(and(eq(rateRequests.enquiryId, enquiryId), eq(rateRequests.status, 'parsed')))

  let updated = 0
  for (const reply of replies) {
    const response = (reply.response ?? {}) as Record<string, unknown>
    if (!Array.isArray(response.rows)) continue
    const rows = (response.rows as RateRowValues[]).map((values, index) => ({
      line: index + 1,
      values,
    }))
    const summary = summariseRateReply(rows, ctx)
    await tx
      .update(rateRequests)
      .set({
        quotedCurrency: summary.primary?.currency ?? null,
        quotedTotal: summary.primary ? summary.primary.amount.amount.toString() : null,
        response: {
          ...response,
          totals: summary.totals.map((t) => ({
            currency: t.currency,
            amount: t.amount.amount.toString(),
          })),
          unpriced: summary.unpriced,
          partial: summary.partial,
        },
      })
      .where(eq(rateRequests.id, reply.id))
    updated += 1
  }
  return updated
}

async function resolveCodes(tx: Tx, codes: readonly string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>()
  if (codes.length === 0) return map
  const rows = await tx.select({ id: locations.id, code: locations.unlocode }).from(locations)
  const wanted = new Set(codes.map((c) => c.toUpperCase()))
  for (const row of rows) {
    if (row.code && wanted.has(row.code.toUpperCase())) map.set(row.code.toUpperCase(), row.id)
  }
  return map
}

async function resolveCharges(tx: Tx, keys: readonly string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>()
  if (keys.length === 0) return map
  const rows = await tx.select({ id: chargeTypes.id, key: chargeTypes.key }).from(chargeTypes)
  const wanted = new Set(keys.map((k) => k.toUpperCase()))
  for (const row of rows) {
    if (wanted.has(row.key.toUpperCase())) map.set(row.key.toUpperCase(), row.id)
  }
  return map
}

/** An agent reply on the enquiry that arrived after the buy card pricing used. */
export interface NewerRateReply {
  readonly rateRequestId: string
  readonly partnerEn: string
  readonly partnerAr: string | null
  readonly quotedTotal: string | null
  readonly quotedCurrency: string | null
  /** `YYYY-MM-DD`, the day the reply came in. */
  readonly respondedOn: string
}

/**
 * Replies on this enquiry that are newer than the buy card it is being priced
 * from — R3.
 *
 * Live run 5: RTMAG's second reply could not become a card, so Price it costed
 * the enquiry from RTMAG's older card at KWD 165.501 while the same page showed
 * the new reply at KWD 172.494, and the quotation said nothing. Pricing still
 * uses the card — a reply is a proposal until somebody accepts it — but a
 * parsed, unpromoted reply on the right lane that arrived after the card was
 * written is a sign the card may be stale, and the draft says so.
 *
 * A declined reply, one on another lane, and one already made into a card are
 * not counted: the first two are not prices for this lane, and the last is a
 * card pricing would have chosen (`preferCardId`) if it covered the date.
 */
export async function newerRateReplies(
  tx: Tx,
  enquiryId: string,
  buyCardId: string,
): Promise<NewerRateReply[]> {
  const result = await tx.execute(sql`
    select r.id as "rateRequestId",
           p.legal_name_en as "partnerEn",
           p.legal_name_ar as "partnerAr",
           r.quoted_total::text as "quotedTotal",
           r.quoted_currency as "quotedCurrency",
           r.responded_at::date::text as "respondedOn"
      from rate_requests r
      join partners p on p.id = r.partner_id
      join rate_cards c on c.id = ${buyCardId}
     where r.enquiry_id = ${enquiryId}
       and r.status = 'parsed'
       and r.rate_card_id is null
       and r.responded_at is not null
       and r.responded_at > c.created_at
       and coalesce((r.response ->> 'declined')::boolean, false) = false
       and (r.response ->> 'laneMismatch') is null
     order by r.responded_at desc
  `)
  return result.rows as unknown as NewerRateReply[]
}
