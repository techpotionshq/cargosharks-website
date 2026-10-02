/**
 * The control tower read — everything the ops dashboard shows.
 *
 * One function, because the dashboard is one screen and five round trips to
 * paint it would blow the two-second budget (§12). The counts are computed in
 * the database with filtered aggregates rather than fetched and counted in
 * JavaScript: `count(*) filter (where …)` gives every tile in a single pass
 * over the same index.
 *
 * This slice queries the tables directly rather than calling the jobs or
 * enquiries slice, because slices do not import each other (§4). Shared logic
 * goes down into `core` or `db`, never sideways.
 */

import 'server-only'
import { and, asc, desc, eq, gt, gte, isNull, lt, ne, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import {
  customers,
  customsStages,
  enquiries,
  exceptionCodes,
  exceptions,
  freeTimeClocks,
  inSeries,
  jobs,
  locations,
  principals,
  quotes,
  withActor,
  type Actor,
} from '@qabandi/db'
import type { Direction, EnquirySummary, JobSummary, Mode, OpsOverview } from '@/lib/pilot/types'
import { usePilotFixtures } from '@/lib/pilot/source'
import { pilotMapData, pilotOverview } from '@/lib/pilot/fixtures'
import { named, pickName } from '@/lib/named'

const origin = alias(locations, 'origin')
const destination = alias(locations, 'destination')

const LIVE = sql`${jobs.status} in ('booked','in_transit','arrived','customs','on_hold')`
const OPEN_ENQUIRY = sql`${enquiries.status} in ('new','assigned','rating','quoted')`

export async function getOpsOverview(
  actor: Actor,
  locale: 'en' | 'ar' = 'en',
): Promise<OpsOverview> {
  if (usePilotFixtures()) return pilotOverview(Date.now(), locale)

  return withActor(actor, async (tx) => {
    const now = new Date()
    const dayAhead = new Date(now.getTime() + 24 * 60 * 60 * 1000)
    const weekAhead = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
    const fortnightAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000)

    const [
      enquiryTotals,
      enquiryByStatus,
      enquiryTrend,
      jobTotals,
      jobByStatus,
      jobByMode,
      quoteTotals,
      quotedByCurrency,
      clockTotals,
      accruedByCurrency,
      exceptionRows,
      slaWatch,
      arrivals,
      topLanes,
    ] = await inSeries([
      () =>
        tx
          .select({
            open: sql<number>`count(*) filter (where ${OPEN_ENQUIRY})::int`,
            unassigned: sql<number>`count(*) filter (where ${OPEN_ENQUIRY} and ${enquiries.ownerId} is null)::int`,
            breached: sql<number>`count(*) filter (
            where ${OPEN_ENQUIRY}
              and ${enquiries.firstRespondedAt} is null
              and ${enquiries.slaDueAt} < now()
          )::int`,
            dueToday: sql<number>`count(*) filter (
            where ${OPEN_ENQUIRY}
              and ${enquiries.firstRespondedAt} is null
              and ${enquiries.slaDueAt} between now() and ${dayAhead}
          )::int`,
          })
          .from(enquiries),

      () =>
        tx
          .select({ status: enquiries.status, count: sql<number>`count(*)::int` })
          .from(enquiries)
          .where(OPEN_ENQUIRY)
          .groupBy(enquiries.status),

      // Fourteen days of intake, zero-filled by the generated series so a
      // quiet weekend renders as a gap rather than vanishing from the axis.
      () =>
        tx.execute(sql`
        -- The day itself, not a label: to_char(..., 'DD Mon') printed
        -- "17 Sep" on the Arabic page. The page words it in the reader's
        -- language.
        select to_char(d.day, 'YYYY-MM-DD') as label,
               count(${enquiries.id})::int as value
          from generate_series(${fortnightAgo}::date, ${now}::date, interval '1 day') as d(day)
          left join ${enquiries}
            on ${enquiries.createdAt} >= d.day
           and ${enquiries.createdAt} < d.day + interval '1 day'
         group by d.day
         order by d.day
      `),

      () =>
        tx
          .select({
            live: sql<number>`count(*) filter (where ${LIVE})::int`,
            arriving: sql<number>`count(*) filter (
            where ${LIVE} and ${jobs.eta} between now() and ${weekAhead}
          )::int`,
            onHold: sql<number>`count(*) filter (where ${jobs.status} = 'on_hold')::int`,
          })
          .from(jobs),

      () =>
        tx
          .select({ status: jobs.status, count: sql<number>`count(*)::int` })
          .from(jobs)
          .where(LIVE)
          .groupBy(jobs.status),

      () =>
        tx
          .select({ mode: jobs.mode, count: sql<number>`count(*)::int` })
          .from(jobs)
          .where(LIVE)
          .groupBy(jobs.mode),

      () =>
        tx
          .select({
            sent: sql<number>`count(*) filter (where ${quotes.sentAt} >= ${monthStart})::int`,
            won: sql<number>`count(*) filter (where ${quotes.status} = 'accepted')::int`,
            decided: sql<number>`count(*) filter (where ${quotes.status} in ('accepted','rejected'))::int`,
            // Margin from the frozen snapshot, never recomputed from today's
            // rate card — that is the whole point of `priced_snapshot` (§6.3).
            margin: sql<string | null>`avg(
            nullif(${quotes.totalSell}, 0) - coalesce(${quotes.totalCost}, 0)
          ) / nullif(avg(nullif(${quotes.totalSell}, 0)), 0) * 100`,
            medianMinutes: sql<string | null>`percentile_cont(0.5) within group (
            order by extract(epoch from (${quotes.sentAt} - ${quotes.createdAt})) / 60
          )`,
          })
          .from(quotes),

      /*
        What was quoted this month, one figure per currency — and only the
        live version of each quotation. It was one sum across every currency
        labelled KWD, counting every superseded version as well, so a quote
        revised four times was quoted five times over.
      */
      () =>
        tx
          .select({
            currency: quotes.currency,
            amount: sql<string>`sum(${quotes.totalSell})::text`,
          })
          .from(quotes)
          .where(and(gte(quotes.sentAt, monthStart), ne(quotes.status, 'superseded')))
          .groupBy(quotes.currency)
          .orderBy(desc(sql`sum(${quotes.totalSell})`), asc(quotes.currency)),

      () =>
        tx
          .select({
            running: sql<number>`count(*)::int`,
            atRisk: sql<number>`count(*) filter (where ${freeTimeClocks.accruedDays} > 0)::int`,
          })
          .from(freeTimeClocks)
          .where(isNull(freeTimeClocks.endsOn)),

      // Per currency for the same reason: a USD per-diem is not dinars.
      () =>
        tx
          .select({
            currency: freeTimeClocks.currency,
            amount: sql<string>`sum(${freeTimeClocks.accruedAmount})::text`,
          })
          .from(freeTimeClocks)
          .where(and(isNull(freeTimeClocks.endsOn), gt(freeTimeClocks.accruedAmount, '0')))
          .groupBy(freeTimeClocks.currency)
          .orderBy(desc(sql`sum(${freeTimeClocks.accruedAmount})`), asc(freeTimeClocks.currency)),

      () =>
        tx
          .select({
            id: exceptions.id,
            jobId: exceptions.jobId,
            jobReference: jobs.reference,
            severity: exceptions.severity,
            openedAt: exceptions.openedAt,
            dueAt: exceptions.dueAt,
            description: exceptions.description,
            code: exceptionCodes.code,
            nameEn: exceptionCodes.nameEn,
            nameAr: exceptionCodes.nameAr,
            owner: named(locale, principals.nameEn, principals.nameAr),
            customerName: customers.legalNameEn,
            customerNameAr: customers.legalNameAr,
          })
          .from(exceptions)
          .innerJoin(exceptionCodes, eq(exceptionCodes.id, exceptions.exceptionCodeId))
          .innerJoin(jobs, eq(jobs.id, exceptions.jobId))
          .leftJoin(customers, eq(customers.id, jobs.customerId))
          .leftJoin(principals, eq(principals.id, exceptions.ownerId))
          .where(isNull(exceptions.closedAt))
          .orderBy(asc(exceptions.openedAt))
          .limit(8),

      () =>
        tx
          .select({
            id: enquiries.id,
            reference: enquiries.reference,
            status: enquiries.status,
            channel: enquiries.channel,
            mode: enquiries.mode,
            createdAt: enquiries.createdAt,
            slaDueAt: enquiries.slaDueAt,
            firstRespondedAt: enquiries.firstRespondedAt,
            customerName: customers.legalNameEn,
            customerNameAr: customers.legalNameAr,
            contactName: enquiries.contactName,
            contactEmail: enquiries.contactEmail,
            owner: named(locale, principals.nameEn, principals.nameAr),
            originName: named(locale, origin.nameEn, origin.nameAr),
            destinationName: named(locale, destination.nameEn, destination.nameAr),
          })
          .from(enquiries)
          .leftJoin(customers, eq(customers.id, enquiries.customerId))
          .leftJoin(principals, eq(principals.id, enquiries.ownerId))
          .leftJoin(origin, eq(origin.id, enquiries.originId))
          .leftJoin(destination, eq(destination.id, enquiries.destinationId))
          .where(and(OPEN_ENQUIRY, isNull(enquiries.firstRespondedAt)))
          .orderBy(asc(enquiries.slaDueAt))
          .limit(6),

      () =>
        tx
          .select({
            id: jobs.id,
            reference: jobs.reference,
            status: jobs.status,
            mode: jobs.mode,
            direction: jobs.tradeDirection,
            eta: jobs.eta,
            etd: jobs.etd,
            ata: jobs.ata,
            vesselName: jobs.vesselName,
            voyageNumber: jobs.voyageNumber,
            flightNumber: jobs.flightNumber,
            updatedAt: jobs.updatedAt,
            customerName: customers.legalNameEn,
            customerNameAr: customers.legalNameAr,
            originName: origin.nameEn,
            originNameAr: origin.nameAr,
            originCode: origin.unlocode,
            destinationName: destination.nameEn,
            destinationNameAr: destination.nameAr,
            destinationCode: destination.unlocode,
            owner: named(locale, principals.nameEn, principals.nameAr),
            customsStatus: customsStages.status,
          })
          .from(jobs)
          .leftJoin(customers, eq(customers.id, jobs.customerId))
          .leftJoin(principals, eq(principals.id, jobs.ownerId))
          .leftJoin(origin, eq(origin.id, jobs.originId))
          .leftJoin(destination, eq(destination.id, jobs.destinationId))
          .leftJoin(customsStages, eq(customsStages.jobId, jobs.id))
          .where(and(LIVE, gt(jobs.eta, now), lt(jobs.eta, weekAhead)))
          .orderBy(asc(jobs.eta))
          .limit(6),

      () =>
        tx
          .select({
            lane: sql<string>`coalesce(${origin.nameEn}, '—') || ' → ' || coalesce(${destination.nameEn}, '—')`,
            /*
              Both labels, so the page picks without a second query. The arrow
              turns round because an RTL line sets the origin on the right —
              the same label the margin report builds. `nullif` because an
              empty Arabic name is as unset as a null one.
            */
            laneAr: sql<string>`coalesce(nullif(${origin.nameAr}, ''), ${origin.nameEn}, '—') || ' ← ' || coalesce(nullif(${destination.nameAr}, ''), ${destination.nameEn}, '—')`,
            count: sql<number>`count(*)::int`,
          })
          .from(jobs)
          .leftJoin(origin, eq(origin.id, jobs.originId))
          .leftJoin(destination, eq(destination.id, jobs.destinationId))
          .groupBy(origin.nameEn, destination.nameEn, origin.nameAr, destination.nameAr)
          .orderBy(desc(sql`count(*)`))
          .limit(5),
    ])

    const enquiryRow = enquiryTotals[0]
    const jobRow = jobTotals[0]
    const quoteRow = quoteTotals[0]
    const clockRow = clockTotals[0]
    const trendRows = enquiryTrend.rows as unknown as { label: string; value: number }[]

    return {
      branchCode: '',
      enquiries: {
        open: enquiryRow?.open ?? 0,
        unassigned: enquiryRow?.unassigned ?? 0,
        breached: enquiryRow?.breached ?? 0,
        dueToday: enquiryRow?.dueToday ?? 0,
        trend: trendRows,
        byStatus: enquiryByStatus,
      },
      jobs: {
        live: jobRow?.live ?? 0,
        arrivingThisWeek: jobRow?.arriving ?? 0,
        onHold: jobRow?.onHold ?? 0,
        byStatus: jobByStatus,
        byMode: jobByMode.map((r) => ({ mode: r.mode as Mode, count: r.count })),
      },
      quotes: {
        sentThisMonth: quoteRow?.sent ?? 0,
        winRatePct:
          quoteRow && quoteRow.decided > 0
            ? Math.round((quoteRow.won / quoteRow.decided) * 100)
            : 0,
        averageMarginPct: quoteRow?.margin ? Math.round(Number(quoteRow.margin) * 10) / 10 : 0,
        quotedValue: quotedByCurrency,
        medianResponseMinutes: Math.round(Number(quoteRow?.medianMinutes ?? 0)),
      },
      clocks: {
        running: clockRow?.running ?? 0,
        accruing: accruedByCurrency,
        containersAtRisk: clockRow?.atRisk ?? 0,
      },
      exceptions: exceptionRows.map((row) => ({
        id: row.id,
        jobId: row.jobId,
        jobReference: row.jobReference,
        code: row.code,
        nameEn: row.nameEn,
        nameAr: row.nameAr,
        severity: row.severity,
        openedAt: row.openedAt,
        dueAt: row.dueAt,
        owner: row.owner,
        description: row.description,
        customerName: row.customerName ?? '—',
        customerNameAr: row.customerNameAr || row.customerName || '—',
      })),
      slaWatch: slaWatch.map((row): EnquirySummary => ({
        id: row.id,
        reference: row.reference,
        branchCode: row.reference.split('-')[1] ?? '',
        status: row.status,
        channel: row.channel,
        mode: row.mode as Mode | null,
        /*
          An enquiry from someone we have never shipped for has no customer
          row — that is the normal case for a new lead (FR-EQ-02), not missing
          data. Falling straight to an em-dash rendered the most interesting
          row on the SLA watch as anonymous. Name, then email, then the dash.
        */
        customerName: row.customerName ?? row.contactName ?? row.contactEmail ?? '—',
        customerNameAr:
          pickName('ar', row.customerName, row.customerNameAr) ??
          row.contactName ??
          row.contactEmail ??
          '—',
        originName: row.originName ?? '—',
        destinationName: row.destinationName ?? '—',
        owner: row.owner,
        createdAt: row.createdAt,
        slaDueAt: row.slaDueAt,
        firstRespondedAt: row.firstRespondedAt,
        quotedSell: null,
        quotedMargin: null,
      })),
      arrivals: arrivals.map((row): JobSummary => ({
        id: row.id,
        reference: row.reference,
        branchCode: row.reference.split('-')[0] ?? '',
        status: row.status,
        mode: row.mode as Mode,
        direction: row.direction as Direction,
        customerName: row.customerName ?? '—',
        customerNameAr: pickName('ar', row.customerName, row.customerNameAr) ?? '—',
        originName: row.originName ?? '—',
        originNameAr: pickName('ar', row.originName, row.originNameAr) ?? '—',
        originCode: row.originCode ?? '',
        destinationName: row.destinationName ?? '—',
        destinationNameAr: pickName('ar', row.destinationName, row.destinationNameAr) ?? '—',
        destinationCode: row.destinationCode ?? '',
        vesselOrFlight:
          row.flightNumber ??
          (row.vesselName
            ? `${row.vesselName}${row.voyageNumber ? ` ${row.voyageNumber}` : ''}`
            : null),
        etd: row.etd,
        eta: row.eta,
        ata: row.ata,
        owner: row.owner,
        customsStatus: row.customsStatus,
        containerCount: 0,
        milestonesTotal: 0,
        milestonesDone: 0,
        openExceptions: 0,
        accruing: null,
        updatedAt: row.updatedAt,
      })),
      topLanes: topLanes.map((row) => ({
        lane: row.lane,
        laneAr: row.laneAr,
        count: row.count,
        value: { amount: 0, currency: 'KWD' },
      })),
    }
  })
}

/**
 * The lanes and ports the map draws.
 *
 * One statement returning two JSON arrays, because the map needs both and two
 * queries would be two round trips for one graphic. Live shipments only — a
 * map of everything ever shipped is a picture of history, and the board's
 * subject is what is moving now.
 *
 * A lane with no coordinates at either end is dropped rather than plotted at
 * (0, 0), which is in the Atlantic off Ghana and would look like a real route.
 */
export interface MapData {
  readonly lanes: {
    id: string
    originName: string
    originLon: number
    originLat: number
    destinationName: string
    destinationLon: number
    destinationLat: number
    count: number
    mode: string
  }[]
  readonly ports: {
    id: string
    name: string
    longitude: number
    latitude: number
    count: number
  }[]
}

export async function getMapData(actor: Actor): Promise<MapData> {
  if (usePilotFixtures()) return pilotMapData()

  return withActor(actor, async (tx) => {
    const result = await tx.execute(sql`
      with live as (
        select j.origin_id, j.destination_id, j.mode
          from jobs j
         where j.status not in ('closed', 'cancelled', 'completed')
      ),
      lane as (
        select o.id || ':' || d.id || ':' || l.mode as id,
               o.name_en as "originName",
               o.longitude::float8 as "originLon",
               o.latitude::float8  as "originLat",
               d.name_en as "destinationName",
               d.longitude::float8 as "destinationLon",
               d.latitude::float8  as "destinationLat",
               l.mode::text as mode,
               count(*)::int as count
          from live l
          join locations o on o.id = l.origin_id
          join locations d on d.id = l.destination_id
         where o.latitude is not null and o.longitude is not null
           and d.latitude is not null and d.longitude is not null
         group by o.id, o.name_en, o.longitude, o.latitude,
                  d.id, d.name_en, d.longitude, d.latitude, l.mode
      ),
      port as (
        select p.id,
               p.name_en as name,
               p.longitude::float8 as longitude,
               p.latitude::float8  as latitude,
               count(*)::int as count
          from live l
          join locations p
            on p.id = l.origin_id or p.id = l.destination_id
         where p.latitude is not null and p.longitude is not null
         group by p.id, p.name_en, p.longitude, p.latitude
      )
      select coalesce((select json_agg(lane order by count desc) from lane), '[]'::json) as lanes,
             coalesce((select json_agg(port order by count desc) from port), '[]'::json) as ports
    `)

    const row = result.rows[0] as unknown as MapData | undefined
    return { lanes: row?.lanes ?? [], ports: row?.ports ?? [] }
  })
}
