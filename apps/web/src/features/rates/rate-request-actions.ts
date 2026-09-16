'use server'

/**
 * Requesting rates from agents, and turning the winning reply into a buy card —
 * the two writes of rate procurement, FR-RT-10.
 *
 * `requestRates` writes one `rate_requests` row per agent a coordinator picked,
 * each `sent` with its own token; the service's minute sweep mails them (web has
 * no queue). `acceptRateReply` is the accept path the extraction deliberately
 * left to a person: it folds a parsed reply's lines into a versioned buy card
 * with `groupRateCards` — the exact function the CSV importer uses — under the
 * coordinator's own actor, so the audit trail answers *who awarded this rate*.
 */

import { randomBytes } from 'node:crypto'
import { revalidatePath } from 'next/cache'
import { and, eq, ne } from 'drizzle-orm'
import {
  chargeTypes,
  enquiries,
  locations,
  rateCardLines,
  rateCards,
  rateRequests,
  withActor,
} from '@qabandi/db'
import { groupRateCards, type ImportRow, type RateRowValues } from '@qabandi/core/import'
import { requireSession } from '@/lib/session'
import { assertCan } from '@/lib/permissions'
import { failWith, succeed, type ActionState } from '@/lib/form-state'

/** Half-open `[from,to)`, written explicitly because the column is not null. */
function dateRangeLiteral(from: string, to: string | null): string {
  return `[${from},${to ?? ''})`
}

/** A token that survives a mail round-trip — hex, matched by `rfq-routing.ts`. */
function newToken(): string {
  return randomBytes(12).toString('hex')
}

/**
 * Send an RFQ to each picked agent.
 *
 * The rows land `sent`; the service drains and mails them. An agent already on
 * this enquiry is skipped rather than asked twice — the picker greys them out,
 * and this is the guard behind that in case two coordinators pick at once.
 */
export async function requestRates(_previous: ActionState, form: FormData): Promise<ActionState> {
  const session = await requireSession()
  assertCan(session, 'rate.card.write')

  const enquiryId = String(form.get('enquiryId') ?? '').trim()
  const partnerIds = form
    .getAll('partnerId')
    .map((v) => String(v).trim())
    .filter(Boolean)

  if (!enquiryId) return failWith('This enquiry is missing.')
  if (partnerIds.length === 0) return failWith('Pick at least one agent to ask.')

  const count = await withActor(session.actor, async (tx) => {
    const [enquiry] = await tx
      .select({ branchId: enquiries.branchId })
      .from(enquiries)
      .where(eq(enquiries.id, enquiryId))
      .limit(1)
    if (!enquiry) return 0

    const existing = new Set(
      (
        await tx
          .select({ partnerId: rateRequests.partnerId })
          .from(rateRequests)
          .where(
            and(eq(rateRequests.enquiryId, enquiryId), ne(rateRequests.status, 'superseded')),
          )
      ).map((r) => r.partnerId),
    )

    const fresh = partnerIds.filter((id) => !existing.has(id))
    if (fresh.length === 0) return 0

    await tx.insert(rateRequests).values(
      fresh.map((partnerId) => ({
        branchId: enquiry.branchId,
        enquiryId,
        partnerId,
        status: 'sent' as const,
        token: newToken(),
      })),
    )
    return fresh.length
  })

  revalidatePath(`/enquiries/${enquiryId}`)
  return succeed(String(count))
}

/**
 * Promote a parsed reply into a versioned buy card, and mark it accepted.
 *
 * Refuses anything the coordinator should see refused: a reply that declined, or
 * did not parse cleanly, or was already promoted. The lines are replayed through
 * `groupRateCards` — the reply stored them in exactly that shape — and the codes
 * are resolved to ids here, so a location or charge type that has since been
 * retired fails loudly rather than writing a card that points at nothing.
 */
export async function acceptRateReply(_previous: ActionState, form: FormData): Promise<ActionState> {
  const session = await requireSession()
  assertCan(session, 'rate.card.write')

  const rateRequestId = String(form.get('rateRequestId') ?? '').trim()
  const enquiryId = String(form.get('enquiryId') ?? '').trim()
  if (!rateRequestId) return failWith('This rate request is missing.')

  const result = await withActor(session.actor, async (tx) => {
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

    if (!request) return { ok: false as const, message: 'That rate request is gone.' }
    if (request.rateCardId) return { ok: false as const, message: 'This reply is already a rate card.' }
    if (request.status !== 'parsed') {
      return { ok: false as const, message: 'Only a parsed reply can become a rate card.' }
    }

    const response = (request.response ?? {}) as { ok?: boolean; declined?: boolean; rows?: RateRowValues[] }
    if (response.declined) return { ok: false as const, message: 'The agent declined this lane.' }
    if (response.ok !== true || !Array.isArray(response.rows) || response.rows.length === 0) {
      return { ok: false as const, message: 'This reply has no clean lines to promote.' }
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

    /*
      A renewal is a successor, not an overlap.

      When this reply renews an expiring card (`source_rate_card_id`), the new
      card must start no earlier than the old one ends — the `rate_cards`
      no-overlap constraint spans superseded rows too, so two cards for one lane
      can never share a day. Clamping the start to the old end is exactly what a
      renewal means ("your new rate takes over when the current one lapses"), and
      it is what makes the expiry sweep stop warning about the lane. A quote whose
      window ends before the old card does cannot renew it and is refused with a
      sentence rather than a constraint error.
    */
    const renewalFloor = request.sourceRateCardId
      ? (
          await tx
            .select({ validTo: rateCards.validTo })
            .from(rateCards)
            .where(eq(rateCards.id, request.sourceRateCardId))
            .limit(1)
        )[0]?.validTo ?? null
      : null

    let firstCardId: string | null = null
    for (const card of cards) {
      const originId = locationIds.get(card.originCode.toUpperCase())
      const destinationId = locationIds.get(card.destinationCode.toUpperCase())
      if (!originId || !destinationId) {
        return { ok: false as const, message: `A port on the reply (${card.originCode}→${card.destinationCode}) is no longer on file.` }
      }

      const validFrom =
        renewalFloor && card.validFrom < renewalFloor ? renewalFloor : card.validFrom
      if (card.validTo && validFrom >= card.validTo) {
        return {
          ok: false as const,
          message: `This quote ends ${card.validTo}, before the current rate lapses ${renewalFloor}. It cannot renew the lane.`,
        }
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
          createdById: session.principal.id,
        })
        .returning({ id: rateCards.id })

      firstCardId ??= inserted!.id

      await tx.insert(rateCardLines).values(
        card.lines.map((line) => {
          const chargeTypeId = chargeIds.get(line.chargeCode.toUpperCase())
          if (!chargeTypeId) throw new Error(`Charge ${line.chargeCode} is no longer on file.`)
          return {
            rateCardId: inserted!.id,
            chargeTypeId,
            basis: line.basis as 'flat' | 'per_unit' | 'per_kg' | 'per_container' | 'per_day' | 'percent',
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

    return { ok: true as const, message: firstCardId ?? '' }
  })

  if (!result.ok) return failWith(result.message)

  if (enquiryId) revalidatePath(`/enquiries/${enquiryId}`)
  revalidatePath('/rates')
  return succeed(result.message)
}

async function resolveCodes(
  tx: Parameters<Parameters<typeof withActor>[1]>[0],
  codes: readonly string[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>()
  if (codes.length === 0) return map
  const rows = await tx.select({ id: locations.id, code: locations.unlocode }).from(locations)
  const wanted = new Set(codes.map((c) => c.toUpperCase()))
  for (const row of rows) {
    if (row.code && wanted.has(row.code.toUpperCase())) map.set(row.code.toUpperCase(), row.id)
  }
  return map
}

async function resolveCharges(
  tx: Parameters<Parameters<typeof withActor>[1]>[0],
  keys: readonly string[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>()
  if (keys.length === 0) return map
  const rows = await tx.select({ id: chargeTypes.id, key: chargeTypes.key }).from(chargeTypes)
  const wanted = new Set(keys.map((k) => k.toUpperCase()))
  for (const row of rows) {
    if (wanted.has(row.key.toUpperCase())) map.set(row.key.toUpperCase(), row.id)
  }
  return map
}
