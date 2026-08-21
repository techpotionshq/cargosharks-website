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
import { withActor, type Actor, type Tx } from './actor'

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

/* -------------------------------------------------------- pricing a lane */

export interface CoveringRateLine {
  readonly chargeTypeId: string
  /** `ocean_freight` — what `PricedLine.chargeTypeKey` carries. */
  readonly chargeTypeKey: string
  readonly chargeNameEn: string
  readonly chargeNameAr: string | null
  readonly basis: string
  readonly rate: string
  readonly currency: string
  readonly minimum: string | null
  readonly maximum: string | null
  readonly containerType: string | null
  readonly weightBreaks: { fromKg: string; ratePerKg: string; minimumCharge?: string }[] | null
  readonly sortOrder: number
}

export interface CoveringRateCard {
  readonly id: string
  readonly direction: 'buy' | 'sell'
  readonly currency: string
  readonly validFrom: string
  readonly validTo: string | null
  readonly partnerId: string | null
  readonly customerId: string | null
  readonly lines: readonly CoveringRateLine[]
}

export interface LaneQuery {
  readonly direction: 'buy' | 'sell'
  readonly mode: string
  readonly originId: string | null
  readonly destinationId: string | null
  /** The day cover is needed for — the readiness date, not today. */
  readonly on: string
  /** Prefers this customer's own card over the general one. */
  readonly customerId?: string | null
}

/**
 * The card that covers a lane on a day — FR-RT-02, FR-RT-04.
 *
 * The read the whole instant quotation stands on, and the only one that
 * decides a price. Written here rather than in a feature slice because
 * `apps/service` will need the same answer the moment agent RFQs come back
 * automatically, and a second copy of "which card applies" is a second opinion
 * about what a shipment costs.
 *
 * ## Validity is a range, and it is asked as one
 *
 * `rate_cards.validity` is a `daterange` declared in SQL (Drizzle has no range
 * type, so the column reads as text). Matching it with `valid_from <= on and
 * (valid_to is null or valid_to >= on)` would be a second, hand-written
 * interpretation of a bound the database already holds — and it would get the
 * upper bound wrong, because the range is `[from,to)` and half-open. `@>` asks
 * the range itself.
 *
 * ## Two cards can legitimately match, and the more specific one wins
 *
 * `0003_constraints.sql` forbids two cards overlapping for the same
 * `(direction, partner, customer, mode, lane)`, so ambiguity within one tier is
 * unrepresentable. Across tiers it is deliberate: a customer with negotiated
 * rates has their own card *and* is covered by the house card, and the whole
 * point of the negotiated one is that it wins. `customer_id` sorts nulls last
 * for exactly that, and the same for `partner_id` on the buy side.
 *
 * Superseded cards are excluded rather than ordered around. A superseded card
 * is a price that was withdrawn (FR-RT-08); preferring the newest version of a
 * withdrawn card would price a shipment off a tariff nobody offers.
 *
 * ## Takes a transaction, not an actor
 *
 * Unlike `listExpiringRateCards` above, which is a screen's read and opens its
 * own. Pricing calls this from inside the transaction that writes the
 * quotation, and opening a second one there is not merely wasteful: the buy
 * and sell lookups run concurrently, so a caller already holding a connection
 * needs three at once, and a pool that cannot supply the third does not fail —
 * it waits, for ever. That is how this was first written, and it hung the
 * moment two lookups ran side by side.
 */
export async function findCoveringRateCard(
  tx: Tx,
  query: LaneQuery,
): Promise<CoveringRateCard | undefined> {
  {
    const card = await tx.execute(sql`
      select rc.id, rc.direction::text as direction, rc.currency,
             rc.valid_from::text as "validFrom", rc.valid_to::text as "validTo",
             rc.partner_id as "partnerId", rc.customer_id as "customerId"
        from rate_cards rc
       where rc.direction = ${query.direction}::rate_direction
         and rc.mode = ${query.mode}::transport_mode
         and rc.origin_id is not distinct from ${query.originId}
         and rc.destination_id is not distinct from ${query.destinationId}
         and rc.superseded_by_id is null
         and rc.validity @> ${query.on}::date
         /*
           Somebody else's negotiated card must never price this shipment.
           Without this a customer-specific tariff would be visible to every
           other customer's quotation the moment it covered the same lane.
         */
         and (rc.customer_id is null or rc.customer_id = ${query.customerId ?? null})
       order by rc.customer_id nulls last, rc.partner_id nulls last, rc.valid_from desc
       limit 1
    `)

    const row = card.rows[0] as
      | {
          id: string
          direction: 'buy' | 'sell'
          currency: string
          validFrom: string
          validTo: string | null
          partnerId: string | null
          customerId: string | null
        }
      | undefined
    if (!row) return undefined

    const lines = await tx.execute(sql`
      select rcl.charge_type_id as "chargeTypeId", ct.key as "chargeTypeKey",
             ct.name_en as "chargeNameEn", ct.name_ar as "chargeNameAr",
             rcl.basis::text as basis, rcl.rate::text as rate, rcl.currency,
             rcl.minimum::text as minimum, rcl.maximum::text as maximum,
             rcl.container_type as "containerType",
             rcl.weight_breaks as "weightBreaks", rcl.sort_order as "sortOrder"
        from rate_card_lines rcl
        join charge_types ct on ct.id = rcl.charge_type_id
       where rcl.rate_card_id = ${row.id}
       order by rcl.sort_order, ct.sort_order
    `)

    return { ...row, lines: lines.rows as unknown as CoveringRateLine[] }
  }
}
