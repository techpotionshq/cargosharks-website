/**
 * Renewing a rate before it lapses — FR-RT-11, the automation on top of FR-RT-10.
 *
 * The digest beside this file *tells a pricing desk* a tariff is expiring; this
 * *acts on it*. For every buy card inside the expiry horizon that has not been
 * renewed and has not already been asked, it opens a rate request to the
 * incumbent agent — the same `rate_requests` row the enquiry screen writes, but
 * sourced from the expiring card rather than an enquiry. The minute sweep mails
 * it, the agent replies, the model reads it, and a fresh card is one accept away
 * on the renewals panel before the old one dies.
 *
 * ## Why the incumbent, and only once
 *
 * The incumbent, because a renewal is "same lane, same agent, new quarter" —
 * re-shopping the lane against every covering agent is a different, louder act a
 * coordinator chooses on the enquiry screen, not one a nightly job should start
 * unasked. Only once, because `source_rate_card_id` records that a card has a
 * live refthesh out: the expiring list still names the card every night until a
 * reply is accepted, and without this guard the agent would get one mail a night.
 *
 * The list is `listExpiringRateCards`, the same read the digest and the register
 * screen use, and it already excludes a card that has a renewal on file — so the
 * night an accepted reply writes the new card, this stops asking on its own.
 */

import { and, eq, ne, sql } from 'drizzle-orm'
import {
  listExpiringRateCards,
  partnerContacts,
  rateRequests,
  systemActor,
  withActor,
  type Tx,
} from '@qabandi/db'
import { newRfqToken } from './rfq-routing'

export interface RefreshResult {
  /** Buy cards in the horizon with an incumbent agent. */
  readonly renewable: number
  /** Refresh requests opened this run. */
  readonly opened: number
  /** Cards skipped — already asked, or the agent has no contact on file. */
  readonly skipped: number
}

export async function refreshExpiringRateCards(asOf = new Date()): Promise<RefreshResult> {
  const actor = systemActor()
  const expiring = await listExpiringRateCards(actor, asOf)

  // Only buy cards can be renewed by asking an agent, and only if we know which.
  const renewable = expiring.filter((card) => card.direction === 'buy' && card.partnerId)
  if (renewable.length === 0) return { renewable: 0, opened: 0, skipped: 0 }

  return withActor(actor, async (tx: Tx) => {
    let opened = 0
    let skipped = 0

    for (const card of renewable) {
      const partnerId = card.partnerId!

      // Already a live refresh out for this card — do not ask twice.
      const existing = await tx
        .select({ id: rateRequests.id })
        .from(rateRequests)
        .where(
          and(eq(rateRequests.sourceRateCardId, card.id), ne(rateRequests.status, 'superseded')),
        )
        .limit(1)
      if (existing.length > 0) {
        skipped += 1
        continue
      }

      // No contact to write to — the send sweep would only skip it, so skip here
      // where it costs nothing rather than open a row that can never go out.
      const contact = await tx
        .select({ id: partnerContacts.id })
        .from(partnerContacts)
        .where(
          and(
            eq(partnerContacts.partnerId, partnerId),
            eq(partnerContacts.isActive, true),
            sql`${partnerContacts.email} is not null`,
          ),
        )
        .limit(1)
      if (contact.length === 0) {
        skipped += 1
        continue
      }

      await tx.insert(rateRequests).values({
        branchId: card.branchId,
        enquiryId: null,
        partnerId,
        sourceRateCardId: card.id,
        status: 'sent' as const,
        token: newRfqToken(),
        // The old rate lapses on its end date; that is when waiting stops mattering.
        respondBy: new Date(card.validTo),
      })
      opened += 1
    }

    return { renewable: renewable.length, opened, skipped }
  })
}
