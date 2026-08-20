/**
 * Coverage about to lapse, read once and shared — FR-RT-11.
 *
 * Two callers need this answer and they live in different applications: the
 * rate-card register renders it as a panel, and the nightly digest posts it to
 * Pricing's inbox. Written twice they would drift, and the drift would be
 * invisible in the worst way — a screen saying four lanes and a mail saying
 * six, with nobody able to say which was lying. `credit.ts` sits here for the
 * same reason.
 *
 * The *decision* about who is told, and when, stays in the worker. This only
 * answers "which cards, and how long have I got".
 *
 * ## Actor-scoped, so the two callers see different things correctly
 *
 * The digest runs as `systemActor()` and sweeps every branch; the screen runs
 * as the operator and RLS narrows it to theirs. Same SQL, same definition, and
 * neither has to remember to filter — which is the point of every read in this
 * package going through `withActor`.
 */

import { sql } from 'drizzle-orm'
import { RATE_CARD_EXPIRY_HORIZON_DAYS } from '@qabandi/core'
import { withActor, type Actor } from './actor'

export interface ExpiringRateCard {
  readonly id: string
  readonly branchId: string
  readonly direction: 'buy' | 'sell'
  readonly mode: string
  /** `AEJEA → KWSWK`, in reading order for the language it is named for. */
  readonly lane: string
  readonly laneAr: string
  /** The agent on a buy card, the customer on a sell card. */
  readonly counterparty: string
  readonly counterpartyAr: string
  readonly validTo: string
  readonly daysRemaining: number
}

/**
 * Cards lapsing within the horizon, soonest first.
 *
 * Writes nothing, so opening the screen does not consume the night's warning.
 *
 * `asOf` is a parameter rather than `current_date` so the digest and its tests
 * can pin a day. A worker that can only be tested by changing the clock is a
 * worker that gets tested once, by hand, on the day it is written.
 */
export async function listExpiringRateCards(
  actor: Actor,
  asOf = new Date(),
  withinDays = RATE_CARD_EXPIRY_HORIZON_DAYS,
): Promise<ExpiringRateCard[]> {
  const on = asOf.toISOString().slice(0, 10)

  return withActor(actor, async (tx) => {
    const result = await tx.execute(sql`
      select rc.id,
             rc.branch_id                as "branchId",
             rc.direction::text          as direction,
             rc.mode::text               as mode,
             coalesce(o.unlocode, o.name_en, '—') || ' → ' ||
               coalesce(d.unlocode, d.name_en, '—')                as lane,
             /*
               Origin first in both, and the arrow flips. In a right-to-left
               line "origin ← destination" puts the origin on the right with
               the arrow pointing at the destination, which is what "→" does
               in the English one; the same glyph in both would point
               backwards in one of them.
             */
             coalesce(o.name_ar, o.unlocode, o.name_en, '—') || ' ← ' ||
               coalesce(d.name_ar, d.unlocode, d.name_en, '—')     as "laneAr",
             coalesce(p.legal_name_en, c.legal_name_en, '—')       as counterparty,
             coalesce(p.legal_name_ar, p.legal_name_en,
                      c.legal_name_ar, c.legal_name_en, '—')       as "counterpartyAr",
             rc.valid_to::text           as "validTo",
             (rc.valid_to - ${on}::date)::int as "daysRemaining"
        from rate_cards rc
        left join locations o on o.id = rc.origin_id
        left join locations d on d.id = rc.destination_id
        left join partners  p on p.id = rc.partner_id
        left join customers c on c.id = rc.customer_id
       where rc.valid_to is not null
         and rc.valid_to - ${on}::date between 0 and ${withinDays}
         -- A superseded version's end date is not coverage anybody will lose.
         and rc.superseded_by_id is null
         /*
           Already renewed, so not a gap.

           rate_cards_no_overlap means a replacement cannot overlap this
           card, so a renewal is the next card along on the same key — origin,
           destination, mode, direction and counterparty — starting on or
           after this one ends. Warning about coverage that is already on file
           is what teaches a pricing desk to filter the sender.

           "is not distinct from" rather than "=": partner and customer are
           null on the side of the trade they do not apply to, and null = null
           is null, so the equality version would match no renewal at all and
           quietly do nothing.
         */
         and not exists (
           select 1
             from rate_cards nxt
            where nxt.id <> rc.id
              and nxt.branch_id = rc.branch_id
              and nxt.direction = rc.direction
              and nxt.mode = rc.mode
              and nxt.origin_id is not distinct from rc.origin_id
              and nxt.destination_id is not distinct from rc.destination_id
              and nxt.partner_id is not distinct from rc.partner_id
              and nxt.customer_id is not distinct from rc.customer_id
              and nxt.superseded_by_id is null
              and nxt.valid_from >= rc.valid_to
         )
       order by rc.valid_to, lane
       limit 500
    `)

    return (result.rows as unknown as ExpiringRateCard[]).map((row) => ({
      ...row,
      daysRemaining: Number(row.daysRemaining),
    }))
  })
}
