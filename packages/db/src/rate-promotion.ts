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

import { eq } from 'drizzle-orm'
import { groupRateCards, type ImportRow, type RateRowValues } from '@qabandi/core/import'
import { chargeTypes, locations, rateCardLines, rateCards, rateRequests } from './schema/index'
import type { Tx } from './actor'

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

export type PromoteResult =
  | { readonly ok: true; readonly cardId: string }
  | {
      readonly ok: false
      readonly reason: PromoteRefusal
      /** The figures the sentence names, for the codes that name any. */
      readonly values?: Readonly<Record<string, string>>
      readonly message: string
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
 * has its start clamped to no earlier than the card it renews ends, because the
 * `rate_cards` no-overlap constraint spans superseded rows and clamping is what
 * "your new rate takes over when the current one lapses" means.
 */
export async function promoteRateReply(
  tx: Tx,
  rateRequestId: string,
  createdById: string,
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
    rows?: RateRowValues[]
  }
  if (response.declined) {
    return { ok: false, reason: 'declined', message: 'The agent declined this lane.' }
  }
  if (response.ok !== true || !Array.isArray(response.rows) || response.rows.length === 0) {
    return {
      ok: false,
      reason: 'no_clean_lines',
      message: 'This reply has no clean lines to promote.',
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

    prepared.push({ card, originId, destinationId, validFrom, lines })
  }

  let firstCardId: string | null = null
  for (const { card, originId, destinationId, validFrom, lines } of prepared) {
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

    await tx.insert(rateCardLines).values(
      lines.map(({ line, chargeTypeId }) => {
        return {
          rateCardId: inserted!.id,
          chargeTypeId,
          basis: line.basis as
            'flat' | 'per_unit' | 'per_kg' | 'per_container' | 'per_day' | 'percent',
          rate: line.rate,
          currency: card.currency,
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
