/**
 * Rate cards about to lapse — FR-RT-11, nightly.
 *
 * The schedule for this has existed since Release One (`45 21 * * *` in
 * `queue.ts`) **with no handler behind it**, so every night the job was
 * enqueued, found nobody to claim it, and aged out. Exactly the fault
 * `fxIngest` had, in the same file, and found the same way — by reading the
 * list of schedules against the list of handlers. `scripts/check-schedules.mjs`
 * now refuses that pair, because twice is a pattern rather than an accident.
 *
 * ## Why a digest and not one mail per card
 *
 * Coverage lapses in batches. An agent's tariff is a quarter's worth of lanes
 * with one end date on it, so the honest version of "your rates are expiring"
 * is eleven lines, not eleven mails. Pricing renews a *tariff*, by ringing an
 * agent, and the unit of the message should match the unit of the work.
 *
 * ## Once per branch per night
 *
 * Idempotent against the outbox rather than against a flag on the card, for
 * the reason `commercial-reminders.ts` sets out at greater length: the outbox
 * *is* the record of what has been announced. A card named in tonight's digest
 * legitimately appears in tomorrow's, closer and more urgent; what must never
 * happen is two digests for one branch on one night, which is what a schedule
 * firing twice — or a service restarted mid-run — would otherwise produce.
 *
 * The list itself comes from `db/rate-cards.ts`, which the register screen
 * reads too, so the panel and the mail cannot disagree about which lanes are
 * at risk.
 */

import { sql } from 'drizzle-orm'
import { RATE_CARD_EXPIRY_HORIZON_DAYS } from '@qabandi/core'
import {
  listExpiringRateCards,
  notificationOutbox,
  systemActor,
  withActor,
  type ExpiringRateCard,
} from '@qabandi/db'

/**
 * How many lanes a digest names before it stops listing them.
 *
 * A tariff with two hundred lanes makes a mail nobody scrolls. The count in
 * the subject is what decides whether Pricing opens the screen; the list is
 * there so the common case — three or four lanes — needs no click at all.
 */
const MAX_LISTED = 20

export interface DigestResult {
  readonly cards: number
  readonly raised: number
}

/**
 * One digest per branch that has something to renew.
 *
 * A branch with nothing lapsing gets no mail. "Nothing to report", nightly, is
 * how a recipient learns to stop opening the sender — and then the night it
 * does say something is the night it is not read.
 */
export async function runRateCardExpiryDigest(asOf = new Date()): Promise<DigestResult> {
  const expiring = await listExpiringRateCards(systemActor(), asOf)
  if (expiring.length === 0) return { cards: 0, raised: 0 }

  const byBranch = new Map<string, ExpiringRateCard[]>()
  for (const card of expiring) {
    const bucket = byBranch.get(card.branchId)
    if (bucket) bucket.push(card)
    else byBranch.set(card.branchId, [card])
  }

  const on = asOf.toISOString().slice(0, 10)

  return withActor(systemActor(), async (tx) => {
    let raised = 0

    for (const [branchId, cards] of byBranch) {
      const already = await tx.execute(sql`
        select 1
          from notification_outbox o
         where o.event_key = 'rate_card.expiring'
           and o.branch_id = ${branchId}
           and o.payload ->> 'asOf' = ${on}
         limit 1
      `)
      if (already.rows.length > 0) continue

      await tx.insert(notificationOutbox).values({
        branchId,
        eventKey: 'rate_card.expiring',
        payload: {
          asOf: on,
          count: String(cards.length),
          horizonDays: String(RATE_CARD_EXPIRY_HORIZON_DAYS),
          // Sorted by expiry, so the first is the deadline the subject leads
          // with — the figure that decides "this week" or "this morning".
          soonest: cards[0]!.validTo,
          lanes: render(cards, 'en'),
          lanesAr: render(cards, 'ar'),
        },
      })

      raised++
    }

    return { cards: expiring.length, raised }
  })
}

/**
 * The list as it appears in the body, rendered once per language.
 *
 * Built here rather than in the template because a template is a row an
 * administrator edits (FR-NT-03) and `renderTemplate` is deliberately dumb —
 * it substitutes fields and cannot loop, which is the correct amount of power
 * for a text box in an admin screen.
 *
 * Plain text with no column alignment: the mail is `text/plain`, so a table
 * built out of spaces survives one mail client and not the next. Dates stay
 * ISO in both languages — the renewal deadline is the one thing in the message
 * that must not be ambiguous.
 */
function render(cards: readonly ExpiringRateCard[], locale: 'en' | 'ar'): string {
  const shown = cards.slice(0, MAX_LISTED)
  const lines = shown.map((card) => {
    const lane = locale === 'ar' ? card.laneAr : card.lane
    const who = locale === 'ar' ? card.counterpartyAr : card.counterparty
    const side =
      locale === 'ar'
        ? card.direction === 'buy'
          ? 'شراء'
          : 'بيع'
        : card.direction
    return `- ${lane} · ${card.mode} · ${side} · ${who} · ${card.validTo}`
  })

  const remainder = cards.length - shown.length
  if (remainder > 0) {
    lines.push(locale === 'ar' ? `- و${remainder} أخرى` : `- and ${remainder} more`)
  }

  return lines.join('\n')
}
