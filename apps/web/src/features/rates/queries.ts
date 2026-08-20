/**
 * Rate cards — the buying and selling prices a quotation is built from.
 *
 * The central idea, and the reason this slice is worth its own reads: a rate
 * card is **versioned and time-bounded**. `validity` is a `daterange` with an
 * exclusion constraint, so two cards for the same lane, mode and direction
 * cannot overlap — the database refuses it rather than the application
 * remembering to check. That is what makes "what did this lane cost in March"
 * answerable at all.
 *
 * Buy and sell are separate cards rather than two columns on one, because they
 * come from different places and change on different clocks: a carrier's buy
 * rate arrives as a contract, and the sell rate is a commercial decision made
 * against it. Pairing them here — rather than in the schema — is what lets the
 * register show a margin without pretending the two were ever one record.
 */

import { sql } from 'drizzle-orm'
import { listExpiringRateCards, withActor, type Actor, type ExpiringRateCard } from '@qabandi/db'

/**
 * Coverage about to lapse — FR-RT-11's screen half.
 *
 * Re-exported rather than re-queried. The read lives in `@qabandi/db` because
 * the nightly digest in `apps/service` needs the same answer, and a panel that
 * disagrees with the mail it was meant to explain is worse than no panel: the
 * argument then is about which of the two is broken, and nobody looks at the
 * lane.
 */
export { listExpiringRateCards, type ExpiringRateCard }

export interface RateCardRow {
  readonly id: string
  readonly direction: 'buy' | 'sell'
  readonly mode: string
  readonly tradeDirection: string | null
  readonly originName: string | null
  readonly originCode: string | null
  readonly destinationName: string | null
  readonly destinationCode: string | null
  readonly partnerName: string | null
  readonly customerName: string | null
  readonly branchCode: string | null
  readonly currency: string
  readonly version: number
  readonly validFrom: string
  readonly validTo: string | null
  readonly lineCount: number
  readonly total: string
  /** True where today falls inside the validity window. */
  readonly isLive: boolean
  readonly isExpiring: boolean
}

/**
 * Every card, newest validity first.
 *
 * `total` is the sum of the card's lines, which is not the price of a shipment
 * — bases differ, and a per-container line means nothing without a container
 * count. It is shown as an *order of magnitude*, so an operator can see at a
 * glance that a card is populated and roughly where it sits, and the label
 * says as much rather than calling it a price.
 */
export async function listRateCards(actor: Actor, direction?: string): Promise<RateCardRow[]> {
  return withActor(actor, async (tx) => {
    const result = await tx.execute(sql`
      select rc.id,
             rc.direction::text                as direction,
             rc.mode::text                     as mode,
             rc.trade_direction::text          as "tradeDirection",
             o.name_en                         as "originName",
             o.unlocode                        as "originCode",
             d.name_en                         as "destinationName",
             d.unlocode                        as "destinationCode",
             p.legal_name_en                   as "partnerName",
             c.legal_name_en                   as "customerName",
             b.code                            as "branchCode",
             rc.currency,
             rc.version,
             rc.valid_from::text               as "validFrom",
             rc.valid_to::text                 as "validTo",
             coalesce(l.count, 0)::int         as "lineCount",
             coalesce(l.total, 0)::text        as total,
             (current_date <@ rc.validity)     as "isLive",
             (rc.valid_to is not null
              and rc.valid_to - current_date between 0 and 30) as "isExpiring"
        from rate_cards rc
        left join locations o on o.id = rc.origin_id
        left join locations d on d.id = rc.destination_id
        left join partners  p on p.id = rc.partner_id
        left join customers c on c.id = rc.customer_id
        left join branches  b on b.id = rc.branch_id
        left join lateral (
          select count(*) as count, sum(rate) as total
            from rate_card_lines rcl
           where rcl.rate_card_id = rc.id
        ) l on true
       where ${direction ? sql`rc.direction = ${direction}::rate_direction` : sql`true`}
       order by rc.valid_from desc, rc.direction, o.name_en
       limit 200
    `)
    return result.rows as unknown as RateCardRow[]
  })
}

export interface RateCardLineRow {
  readonly id: string
  readonly chargeKey: string
  readonly chargeName: string
  readonly category: string
  readonly basis: string
  readonly rate: string
  readonly currency: string
  readonly minimum: string | null
  readonly containerType: string | null
}

export async function listRateCardLines(
  actor: Actor,
  rateCardId: string,
): Promise<RateCardLineRow[]> {
  return withActor(actor, async (tx) => {
    const result = await tx.execute(sql`
      select rcl.id,
             ct.key       as "chargeKey",
             ct.name_en   as "chargeName",
             ct.category,
             rcl.basis::text as basis,
             rcl.rate::text  as rate,
             rcl.currency,
             rcl.minimum::text as minimum,
             rcl.container_type as "containerType"
        from rate_card_lines rcl
        join charge_types ct on ct.id = rcl.charge_type_id
       where rcl.rate_card_id = ${rateCardId}
       order by rcl.sort_order, ct.key
    `)
    return result.rows as unknown as RateCardLineRow[]
  })
}

/**
 * The four numbers above the register.
 *
 * `lanesCovered` counts *distinct lanes with a live buy card*, which is the
 * one that matters: a lane with no live buying rate is a lane where every
 * quotation is somebody guessing, and that is the gap this screen exists to
 * make visible.
 */
export async function rateCardSummary(actor: Actor): Promise<{
  live: number
  expiring: number
  lanesCovered: number
  uncoveredLanes: number
}> {
  return withActor(actor, async (tx) => {
    const result = await tx.execute(sql`
      with live_cards as (
        select * from rate_cards where current_date <@ validity
      )
      select
        (select count(*) from live_cards)::int as live,
        (select count(*) from rate_cards
          where valid_to is not null
            and valid_to - current_date between 0 and 30)::int as expiring,
        (select count(distinct (origin_id, destination_id, mode))
           from live_cards where direction = 'buy')::int as "lanesCovered",
        /*
          Lanes we are actually shipping that have no live buying rate. The
          most useful number on the page, and the reason it is a left join
          rather than a count of cards: the question is about lanes with
          *traffic*, not about lanes someone once made a card for.
        */
        (select count(*) from (
           select distinct j.origin_id, j.destination_id, j.mode
             from jobs j
            where j.status not in ('closed', 'cancelled')
              and not exists (
                select 1 from live_cards lc
                 where lc.direction = 'buy'
                   and lc.origin_id = j.origin_id
                   and lc.destination_id = j.destination_id
                   and lc.mode = j.mode
              )
         ) gaps)::int as "uncoveredLanes"
    `)
    const row = result.rows[0] as unknown as
      { live: number; expiring: number; lanesCovered: number; uncoveredLanes: number } | undefined
    return {
      live: row?.live ?? 0,
      expiring: row?.expiring ?? 0,
      lanesCovered: row?.lanesCovered ?? 0,
      uncoveredLanes: row?.uncoveredLanes ?? 0,
    }
  })
}

/**
 * Buy and sell for the same lane, paired, with the margin between them.
 *
 * This is the screen's most valuable read and it cannot be a column on either
 * table: it is a *join between two independent cards*, matched on lane, mode
 * and direction, both live today. Where a lane has a buy card and no sell
 * card, the margin is unknown rather than zero, and the register says so.
 */
export interface LaneMarginRow {
  readonly lane: string
  readonly mode: string
  readonly buyTotal: string | null
  readonly sellTotal: string | null
  readonly currency: string | null
  readonly marginPct: number | null
}

export async function laneMargins(actor: Actor): Promise<LaneMarginRow[]> {
  return withActor(actor, async (tx) => {
    /*
      Conditional aggregation, not a full outer join.

      The join version produced two rows per lane: the matched pair, plus the
      sell card again as an unmatched right-hand side. Pivoting with `filter`
      is both correct and simpler — one row per lane by construction, with
      whichever side is missing arriving as NULL rather than as a second row.
    */
    const result = await tx.execute(sql`
      with totals as (
        select rc.origin_id, rc.destination_id, rc.mode, rc.direction, rc.currency,
               sum(rcl.rate) as total
          from rate_cards rc
          join rate_card_lines rcl on rcl.rate_card_id = rc.id
         where current_date <@ rc.validity
         group by rc.origin_id, rc.destination_id, rc.mode, rc.direction, rc.currency
      ),
      lane as (
        select origin_id, destination_id, mode,
               max(currency)                              as currency,
               sum(total) filter (where direction = 'buy')  as buy,
               sum(total) filter (where direction = 'sell') as sell
          from totals
         group by origin_id, destination_id, mode
      )
      select coalesce(o.name_en, '—') || ' → ' || coalesce(d.name_en, '—') as lane,
             l.mode::text     as mode,
             l.buy::text      as "buyTotal",
             l.sell::text     as "sellTotal",
             l.currency,
             case
               when l.sell is null or l.buy is null or l.sell = 0 then null
               else round(((l.sell - l.buy) / l.sell * 100)::numeric, 1)
             end              as "marginPct"
        from lane l
        left join locations o on o.id = l.origin_id
        left join locations d on d.id = l.destination_id
       order by "marginPct" nulls last
       limit 20
    `)
    return (result.rows as unknown as LaneMarginRow[]).map((row) => ({
      ...row,
      marginPct: row.marginPct === null ? null : Number(row.marginPct),
    }))
  })
}
