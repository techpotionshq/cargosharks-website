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
import { and, asc, desc, eq, gt, isNull, lt, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import {
  customers,
  customsStages,
  enquiries,
  exceptionCodes,
  exceptions,
  freeTimeClocks,
  jobs,
  locations,
  principals,
  quotes,
  withActor,
  type Actor,
} from '@qabandi/db'
import type { Direction, EnquirySummary, JobSummary, Mode, OpsOverview } from '@/lib/pilot/types'
import { usePilotFixtures } from '@/lib/pilot/source'
import { pilotOverview } from '@/lib/pilot/fixtures'

const origin = alias(locations, 'origin')
const destination = alias(locations, 'destination')

const LIVE = sql`${jobs.status} in ('booked','in_transit','arrived','customs','on_hold')`
const OPEN_ENQUIRY = sql`${enquiries.status} in ('new','assigned','rating','quoted')`

export async function getOpsOverview(actor: Actor): Promise<OpsOverview> {
  if (usePilotFixtures()) return pilotOverview()

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
      clockTotals,
      exceptionRows,
      slaWatch,
      arrivals,
      topLanes,
    ] = await Promise.all([
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

      tx
        .select({ status: enquiries.status, count: sql<number>`count(*)::int` })
        .from(enquiries)
        .where(OPEN_ENQUIRY)
        .groupBy(enquiries.status),

      // Fourteen days of intake, zero-filled by the generated series so a
      // quiet weekend renders as a gap rather than vanishing from the axis.
      tx.execute(sql`
        select to_char(d.day, 'DD Mon') as label,
               count(${enquiries.id})::int as value
          from generate_series(${fortnightAgo}::date, ${now}::date, interval '1 day') as d(day)
          left join ${enquiries}
            on ${enquiries.createdAt} >= d.day
           and ${enquiries.createdAt} < d.day + interval '1 day'
         group by d.day
         order by d.day
      `),

      tx
        .select({
          live: sql<number>`count(*) filter (where ${LIVE})::int`,
          arriving: sql<number>`count(*) filter (
            where ${LIVE} and ${jobs.eta} between now() and ${weekAhead}
          )::int`,
          onHold: sql<number>`count(*) filter (where ${jobs.status} = 'on_hold')::int`,
        })
        .from(jobs),

      tx
        .select({ status: jobs.status, count: sql<number>`count(*)::int` })
        .from(jobs)
        .where(LIVE)
        .groupBy(jobs.status),

      tx
        .select({ mode: jobs.mode, count: sql<number>`count(*)::int` })
        .from(jobs)
        .where(LIVE)
        .groupBy(jobs.mode),

      tx
        .select({
          sent: sql<number>`count(*) filter (where ${quotes.sentAt} >= ${monthStart})::int`,
          won: sql<number>`count(*) filter (where ${quotes.status} = 'accepted')::int`,
          decided: sql<number>`count(*) filter (where ${quotes.status} in ('accepted','rejected'))::int`,
          value: sql<string | null>`sum(${quotes.totalSell}) filter (where ${quotes.sentAt} >= ${monthStart})`,
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

      tx
        .select({
          running: sql<number>`count(*)::int`,
          accrued: sql<string | null>`sum(${freeTimeClocks.accruedAmount})`,
          atRisk: sql<number>`count(*) filter (where ${freeTimeClocks.accruedDays} > 0)::int`,
        })
        .from(freeTimeClocks)
        .where(isNull(freeTimeClocks.endsOn)),

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
          owner: principals.nameEn,
          customerName: customers.legalNameEn,
        })
        .from(exceptions)
        .innerJoin(exceptionCodes, eq(exceptionCodes.id, exceptions.exceptionCodeId))
        .innerJoin(jobs, eq(jobs.id, exceptions.jobId))
        .leftJoin(customers, eq(customers.id, jobs.customerId))
        .leftJoin(principals, eq(principals.id, exceptions.ownerId))
        .where(isNull(exceptions.closedAt))
        .orderBy(asc(exceptions.openedAt))
        .limit(8),

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
          owner: principals.nameEn,
          originName: origin.nameEn,
          destinationName: destination.nameEn,
        })
        .from(enquiries)
        .leftJoin(customers, eq(customers.id, enquiries.customerId))
        .leftJoin(principals, eq(principals.id, enquiries.ownerId))
        .leftJoin(origin, eq(origin.id, enquiries.originId))
        .leftJoin(destination, eq(destination.id, enquiries.destinationId))
        .where(and(OPEN_ENQUIRY, isNull(enquiries.firstRespondedAt)))
        .orderBy(asc(enquiries.slaDueAt))
        .limit(6),

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
          owner: principals.nameEn,
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

      tx
        .select({
          lane: sql<string>`coalesce(${origin.nameEn}, '—') || ' → ' || coalesce(${destination.nameEn}, '—')`,
          count: sql<number>`count(*)::int`,
        })
        .from(jobs)
        .leftJoin(origin, eq(origin.id, jobs.originId))
        .leftJoin(destination, eq(destination.id, jobs.destinationId))
        .groupBy(origin.nameEn, destination.nameEn)
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
        quotedValue: { amount: Number(quoteRow?.value ?? 0), currency: 'KWD' },
        medianResponseMinutes: Math.round(Number(quoteRow?.medianMinutes ?? 0)),
      },
      clocks: {
        running: clockRow?.running ?? 0,
        accruing: { amount: Number(clockRow?.accrued ?? 0), currency: 'KWD' },
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
      })),
      slaWatch: slaWatch.map(
        (row): EnquirySummary => ({
          id: row.id,
          reference: row.reference,
          branchCode: row.reference.split('-')[1] ?? '',
          status: row.status,
          channel: row.channel,
          mode: row.mode as Mode | null,
          customerName: row.customerName ?? '—',
          customerNameAr: row.customerNameAr ?? row.customerName ?? '—',
          originName: row.originName ?? '—',
          destinationName: row.destinationName ?? '—',
          owner: row.owner,
          createdAt: row.createdAt,
          slaDueAt: row.slaDueAt,
          firstRespondedAt: row.firstRespondedAt,
          quotedSell: null,
          quotedMargin: null,
        }),
      ),
      arrivals: arrivals.map(
        (row): JobSummary => ({
          id: row.id,
          reference: row.reference,
          branchCode: row.reference.split('-')[0] ?? '',
          status: row.status,
          mode: row.mode as Mode,
          direction: row.direction as Direction,
          customerName: row.customerName ?? '—',
          customerNameAr: row.customerNameAr ?? row.customerName ?? '—',
          originName: row.originName ?? '—',
          originNameAr: row.originNameAr ?? row.originName ?? '—',
          originCode: row.originCode ?? '',
          destinationName: row.destinationName ?? '—',
          destinationNameAr: row.destinationNameAr ?? row.destinationName ?? '—',
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
        }),
      ),
      topLanes: topLanes.map((row) => ({
        lane: row.lane,
        count: row.count,
        value: { amount: 0, currency: 'KWD' },
      })),
    }
  })
}
