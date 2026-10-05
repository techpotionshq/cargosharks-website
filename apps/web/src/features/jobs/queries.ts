/**
 * Job reads — the operations board and the job file.
 *
 * Every query runs inside `withActor`, so none of them carries a branch
 * filter: RLS applies it (§5.3). That absence is the point — a `where
 * branch_id = ?` here would be a second, forgettable copy of a rule the
 * database already enforces.
 *
 * Each function has two implementations behind `usePilotFixtures()`: the
 * seeded pilot dataset, and the real tables. Same signature, same return type,
 * so the switch from one to the other is an environment variable and no page
 * changes. See `lib/pilot/source.ts` for why that matters.
 */

import 'server-only'
import { and, asc, desc, eq, gt, isNull, ne, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { KUWAIT_CALENDAR, accrue, dec, type WorkingCalendar, type Weekday } from '@qabandi/core'
import {
  assets,
  branches,
  calendarHolidays,
  commodities,
  customers,
  customsStages,
  documentTypes,
  documents,
  enquiries,
  equipment,
  exceptionCodes,
  exceptions,
  freeTimeClocks,
  inSeries,
  jobMilestones,
  jobPartners,
  jobs,
  locations,
  partners,
  principals,
  quotes,
  withActor,
  workingCalendars,
  type Actor,
} from '@qabandi/db'
import type {
  ClockView,
  ExceptionView,
  JobDetail,
  JobSummary,
  Mode,
  Direction,
} from '@/lib/pilot/types'
import { usePilotFixtures } from '@/lib/pilot/source'
import { pilotExceptions, pilotJob, pilotJobs } from '@/lib/pilot/fixtures'
import { named, pickName } from '@/lib/named'
import { sumByCurrency, type CurrencyAmount } from '@/lib/by-currency'
import { pageOf, pageRequest, readPage, type Page, type PageRequest } from '@/lib/paging'

const origin = alias(locations, 'origin')
const destination = alias(locations, 'destination')

export interface JobListFilters {
  readonly status?: string
  readonly mode?: string
  readonly branchCode?: string
  /** Only jobs carrying an open exception or a customs hold. */
  readonly exceptionsOnly?: boolean
  /**
   * Only jobs due within this many days from now.
   *
   * The board's "Arriving" filter used to be a `rows.filter` over the hundred
   * rows it had fetched, so it could only ever find arrivals among the first
   * hundred by ETA. In the `where` now, so it searches every live job.
   */
  readonly arrivingWithinDays?: number
  /** Names the owner as they write it — `principals.name_ar` on an Arabic screen. */
  readonly locale?: 'en' | 'ar'
}

/** Statuses that put a job on the live board — everything else is history. */
const LIVE_STATUSES = ['booked', 'in_transit', 'arrived', 'customs', 'on_hold'] as const

/**
 * Correlated counts, computed in the database.
 *
 * Six scalar subqueries rather than six joins with `group by`: the planner
 * turns each into an index-only scan on the job's own index, and the row shape
 * stays flat, so the board renders without the caller reassembling anything.
 */
const containerCount = sql<number>`(
  select count(*)::int from ${equipment} where ${equipment.jobId} = "jobs"."id"
)`

const milestonesTotal = sql<number>`(
  select count(*)::int from ${jobMilestones} where ${jobMilestones.jobId} = "jobs"."id"
)`

const milestonesDone = sql<number>`(
  select count(*)::int from ${jobMilestones}
   where ${jobMilestones.jobId} = "jobs"."id" and ${jobMilestones.actualAt} is not null
)`

const openExceptions = sql<number>`(
  select count(*)::int from ${exceptions}
   where ${exceptions.jobId} = "jobs"."id" and ${exceptions.closedAt} is null
)`

/*
  The running clocks' accrual, in one currency (O15).

  This summed every clock's amount and the row labelled it KWD, so a USD
  per-diem and a KWD one added up as dinars. Grouped by currency instead, and
  the largest group returned with its own code: the figure is what it says it
  is, and on the rare job with clocks in two currencies it is the larger one
  rather than an invented total.
*/
const accruingAmount = sql<{ amount: string; currency: string } | null>`(
  select json_build_object('amount', sum(c.accrued_amount)::text, 'currency', c.currency)
    from free_time_clocks c
   where c.job_id = "jobs"."id" and c.ends_on is null
   group by c.currency
   order by sum(c.accrued_amount) desc nulls last
   limit 1
)`

/** The fixture board, filtered exactly as the `where` below filters the table. */
function pilotJobsMatching(filters: JobListFilters, now: number): JobSummary[] {
  let rows = pilotJobs(now, filters.locale)
  if (filters.status === 'live') {
    rows = rows.filter((r) => (LIVE_STATUSES as readonly string[]).includes(r.status))
  } else if (filters.status) {
    rows = rows.filter((r) => r.status === filters.status)
  }
  if (filters.mode) rows = rows.filter((r) => r.mode === filters.mode)
  if (filters.branchCode) rows = rows.filter((r) => r.branchCode === filters.branchCode)
  if (filters.exceptionsOnly) {
    rows = rows.filter((r) => r.openExceptions > 0 || r.customsStatus === 'held')
  }
  if (filters.arrivingWithinDays !== undefined) {
    const until = now + filters.arrivingWithinDays * 86_400_000
    rows = rows.filter((r) => r.eta !== null && r.eta.getTime() > now && r.eta.getTime() < until)
  }
  return rows.sort((a, b) => (a.eta?.getTime() ?? Infinity) - (b.eta?.getTime() ?? Infinity))
}

/**
 * The board's filter as SQL — shared by the page and its count, so the total
 * under the table can never describe a different set from the rows above it.
 */
function jobsWhere(filters: JobListFilters) {
  return and(
    filters.status === 'live'
      ? sql`${jobs.status} in ('booked','in_transit','arrived','customs','on_hold')`
      : filters.status
        ? sql`${jobs.status} = ${filters.status}`
        : undefined,
    filters.mode ? sql`${jobs.mode} = ${filters.mode}` : undefined,
    filters.branchCode ? eq(branches.code, filters.branchCode) : undefined,
    filters.exceptionsOnly
      ? sql`(${openExceptions} > 0 or ${customsStages.status} = 'held')`
      : undefined,
    filters.arrivingWithinDays !== undefined
      ? sql`${jobs.eta} > now() and ${jobs.eta} < now() + make_interval(days => ${filters.arrivingWithinDays})`
      : undefined,
  )
}

export async function listJobs(
  actor: Actor,
  filters: JobListFilters = {},
  request: PageRequest = pageRequest(undefined),
): Promise<Page<JobSummary>> {
  if (usePilotFixtures()) return pageOf(pilotJobsMatching(filters, Date.now()), request)

  return withActor(actor, (tx) =>
    readPage(
      request,
      async (limit, offset) => {
        const rows = await tx
          .select({
            id: jobs.id,
            reference: jobs.reference,
            status: jobs.status,
            mode: jobs.mode,
            direction: jobs.tradeDirection,
            etd: jobs.etd,
            eta: jobs.eta,
            ata: jobs.ata,
            vesselName: jobs.vesselName,
            voyageNumber: jobs.voyageNumber,
            flightNumber: jobs.flightNumber,
            updatedAt: jobs.updatedAt,
            /*
              The branch's own code, joined rather than stubbed.

              This was a literal empty string, and the `where` below carried no
              branch condition — so on a real database the register's branch column
              rendered blank and `filters.branchCode` silently matched everything.
              Both halves work in `usePilotFixtures()` mode above, which is why the
              demo and the offline end-to-end run never showed it.
            */
            branchCode: branches.code,
            customerName: customers.legalNameEn,
            customerNameAr: customers.legalNameAr,
            originName: origin.nameEn,
            originNameAr: origin.nameAr,
            originCode: origin.unlocode,
            destinationName: destination.nameEn,
            destinationNameAr: destination.nameAr,
            destinationCode: destination.unlocode,
            owner: named(filters.locale ?? 'en', principals.nameEn, principals.nameAr),
            customsStatus: customsStages.status,
            containerCount,
            milestonesTotal,
            milestonesDone,
            openExceptions,
            accruingAmount,
          })
          .from(jobs)
          .leftJoin(branches, eq(branches.id, jobs.branchId))
          .leftJoin(customers, eq(customers.id, jobs.customerId))
          .leftJoin(principals, eq(principals.id, jobs.ownerId))
          .leftJoin(origin, eq(origin.id, jobs.originId))
          .leftJoin(destination, eq(destination.id, jobs.destinationId))
          .leftJoin(customsStages, eq(customsStages.jobId, jobs.id))
          .where(jobsWhere(filters))
          // `id` last: ETA and updated-at tie across an import of four hundred
          // jobs, and without a unique tail a row can appear on two pages.
          .orderBy(asc(jobs.eta), desc(jobs.updatedAt), asc(jobs.id))
          .limit(limit)
          .offset(offset)

        return rows.map(toJobSummary)
      },
      async () => {
        const [row] = await tx
          .select({ n: sql<number>`count(*)::int` })
          .from(jobs)
          .leftJoin(branches, eq(branches.id, jobs.branchId))
          .leftJoin(customsStages, eq(customsStages.jobId, jobs.id))
          .where(jobsWhere(filters))
        return row?.n ?? 0
      },
    ),
  )
}

export interface JobBoardCounts {
  /** Every live job — the board's "Live" tile. */
  readonly live: number
  /** Live jobs due in the next seven days. */
  readonly arriving: number
  /** Live jobs held at customs or on hold. */
  readonly held: number
}

/** The window the "Arriving" tile and filter both mean. */
export const ARRIVING_WITHIN_DAYS = 7

/**
 * The board's tiles, counted in the database.
 *
 * They were `rows.length` and two `rows.filter`s over the page the board had
 * fetched, so with 336 live jobs the "Live" tile read 100 — the page limit,
 * presented as a fact about the branch (R9). Counted here over every live job,
 * independent of which filter or page the board is showing, because a tile is
 * a headline about the branch rather than about the table under it.
 */
export async function countJobBoard(actor: Actor): Promise<JobBoardCounts> {
  if (usePilotFixtures()) {
    const now = Date.now()
    const live = pilotJobsMatching({ status: 'live' }, now)
    return {
      live: live.length,
      arriving: pilotJobsMatching({ status: 'live', arrivingWithinDays: ARRIVING_WITHIN_DAYS }, now)
        .length,
      held: live.filter((r) => r.customsStatus === 'held' || r.status === 'on_hold').length,
    }
  }

  return withActor(actor, async (tx) => {
    const [row] = await tx
      .select({
        live: sql<number>`count(*)::int`,
        arriving: sql<number>`(count(*) filter (
          where ${jobs.eta} > now()
            and ${jobs.eta} < now() + make_interval(days => ${ARRIVING_WITHIN_DAYS})
        ))::int`,
        held: sql<number>`(count(*) filter (
          where ${customsStages.status} = 'held' or ${jobs.status} = 'on_hold'
        ))::int`,
      })
      .from(jobs)
      .leftJoin(customsStages, eq(customsStages.jobId, jobs.id))
      .where(sql`${jobs.status} in ('booked','in_transit','arrived','customs','on_hold')`)
    return { live: row?.live ?? 0, arriving: row?.arriving ?? 0, held: row?.held ?? 0 }
  })
}

type JobRow = {
  id: string
  reference: string
  status: string
  mode: string
  direction: string
  etd: Date | null
  eta: Date | null
  ata: Date | null
  vesselName: string | null
  voyageNumber: string | null
  flightNumber: string | null
  updatedAt: Date
  /*
    Nullable because the join is a `leftJoin`.

    A job without a branch cannot exist — `jobs.branch_id` is `not null` — so
    this can only ever be null in theory, and typing it `string` was the
    natural reading. It is still wrong: the type has to describe the query, and
    the difference between the two shows up as a blank cell rather than a crash.
  */
  branchCode: string | null
  customerName: string | null
  customerNameAr: string | null
  originName: string | null
  originNameAr: string | null
  originCode: string | null
  destinationName: string | null
  destinationNameAr: string | null
  destinationCode: string | null
  owner: string | null
  customsStatus: string | null
  containerCount: number
  milestonesTotal: number
  milestonesDone: number
  openExceptions: number
  accruingAmount: { amount: string | null; currency: string } | null
}

function toJobSummary(row: JobRow): JobSummary {
  return {
    id: row.id,
    reference: row.reference,
    /*
      The joined branch, not the reference prefix.

      Deriving it from `FXH-JOB-2026-00001` is right for every job this system
      raises and wrong for the ones it inherits: a cutover import keeps the old
      file number deliberately (`writeOpenJobs`), so `AGL-2024-118` rendered a
      branch called `AGL`. Worse, the filter and the column then disagreed —
      `listJobs({ branchCode: 'FXH' })` filters on `branches.code` and would
      return rows the register labels something else entirely.
    */
    branchCode: row.branchCode ?? '',
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
    containerCount: row.containerCount,
    milestonesTotal: row.milestonesTotal,
    milestonesDone: row.milestonesDone,
    openExceptions: row.openExceptions,
    /**
     * `numeric` arrives as a string so precision survives the wire (§11). It
     * is parsed here only to render — never to compute a charge, which is
     * `core/money`'s job.
     */
    accruing:
      row.accruingAmount === null || row.accruingAmount.amount === null
        ? null
        : { amount: Number(row.accruingAmount.amount), currency: row.accruingAmount.currency },
    updatedAt: row.updatedAt,
  }
}

/**
 * One job, with everything the job file shows.
 *
 * Returns undefined for another branch's job — not because this checks, but
 * because the row is invisible to the query. `FR-ID-04` satisfied literally:
 * not-found rather than forbidden, with no enumeration signal.
 */
export async function getJobDetail(
  actor: Actor,
  id: string,
  locale: 'en' | 'ar' = 'en',
): Promise<JobDetail | undefined> {
  if (usePilotFixtures()) return pilotJob(id, Date.now(), locale)

  return withActor(actor, async (tx) => {
    const [row] = await tx
      .select({
        id: jobs.id,
        reference: jobs.reference,
        // Foreign keys as well as names: the job file is the only screen with
        // an edit form, and a `<select>` needs the id it will submit.
        branchId: jobs.branchId,
        customerId: jobs.customerId,
        originId: jobs.originId,
        destinationId: jobs.destinationId,
        commodityId: jobs.commodityId,
        ownerId: jobs.ownerId,
        quoteId: jobs.quoteId,
        branchTimeZone: branches.timeZone,
        status: jobs.status,
        mode: jobs.mode,
        direction: jobs.tradeDirection,
        etd: jobs.etd,
        eta: jobs.eta,
        ata: jobs.ata,
        vesselName: jobs.vesselName,
        voyageNumber: jobs.voyageNumber,
        flightNumber: jobs.flightNumber,
        updatedAt: jobs.updatedAt,
        branchCode: sql<string>`''`,
        customerReference: jobs.customerReference,
        masterBillNumber: jobs.masterBillNumber,
        houseBillNumber: jobs.houseBillNumber,
        houseBillSurrenderedAt: jobs.houseBillSurrenderedAt,
        bookingNumber: jobs.bookingNumber,
        placeOfReceipt: jobs.placeOfReceipt,
        placeOfDelivery: jobs.placeOfDelivery,
        incoterm: jobs.incoterm,
        grossWeightKg: jobs.grossWeightKg,
        chargeableWeightKg: jobs.chargeableWeightKg,
        volumeCbm: jobs.volumeCbm,
        pieces: jobs.pieces,
        customerName: customers.legalNameEn,
        customerNameAr: customers.legalNameAr,
        commodityName: commodities.nameEn,
        commodityNameAr: commodities.nameAr,
        originName: origin.nameEn,
        originNameAr: origin.nameAr,
        originCode: origin.unlocode,
        destinationName: destination.nameEn,
        destinationNameAr: destination.nameAr,
        destinationCode: destination.unlocode,
        owner: named(locale, principals.nameEn, principals.nameAr),
        customsStatus: customsStages.status,
        customsNote: customsStages.notes,
        containerCount,
        milestonesTotal,
        milestonesDone,
        openExceptions,
        accruingAmount,
      })
      .from(jobs)
      .innerJoin(branches, eq(branches.id, jobs.branchId))
      .leftJoin(customers, eq(customers.id, jobs.customerId))
      .leftJoin(principals, eq(principals.id, jobs.ownerId))
      .leftJoin(commodities, eq(commodities.id, jobs.commodityId))
      .leftJoin(origin, eq(origin.id, jobs.originId))
      .leftJoin(destination, eq(destination.id, jobs.destinationId))
      .leftJoin(customsStages, eq(customsStages.jobId, jobs.id))
      .where(eq(jobs.id, id))
      .limit(1)

    if (!row) return undefined

    const [milestoneRows, containerRows, clockRows, documentRows, exceptionRows, partnerRows] =
      await inSeries([
        () =>
          tx
            .select()
            .from(jobMilestones)
            .where(eq(jobMilestones.jobId, id))
            .orderBy(asc(jobMilestones.seq)),
        () => tx.select().from(equipment).where(eq(equipment.jobId, id)),
        () =>
          tx
            .select()
            .from(freeTimeClocks)
            .where(eq(freeTimeClocks.jobId, id))
            .orderBy(desc(freeTimeClocks.accruedAmount)),
        () =>
          tx
            .select({
              id: documents.id,
              version: documents.version,
              locale: documents.locale,
              releasedAt: documents.releasedAt,
              code: documentTypes.code,
              nameEn: documentTypes.nameEn,
              nameAr: documentTypes.nameAr,
              byteSize: assets.byteSize,
            })
            .from(documents)
            .innerJoin(documentTypes, eq(documentTypes.id, documents.documentTypeId))
            .innerJoin(assets, eq(assets.id, documents.assetId))
            .where(and(eq(documents.jobId, id), isNull(documents.supersededById))),
        () => listExceptionRows(tx, id, locale),
        /*
          Who we engaged, as against who is named on the bill.

          `job_parties` is the shipper and consignee — the contract of
          carriage. This is the carrier, the agents and the haulier we placed
          the work with, which is a different list and the one that decides
          who gets settled with.
        */
        () =>
          tx
            .select({
              id: jobPartners.id,
              partnerId: jobPartners.partnerId,
              name: partners.legalNameEn,
              nameAr: partners.legalNameAr,
              role: jobPartners.role,
              reference: jobPartners.reference,
            })
            .from(jobPartners)
            .innerJoin(partners, eq(partners.id, jobPartners.partnerId))
            .where(eq(jobPartners.jobId, id))
            .orderBy(asc(jobPartners.role)),
      ])

    const summary = toJobSummary(row as JobRow)
    const calendar = await clockCalendar(tx, row.branchId)

    return {
      ...summary,
      // The foreign keys, carried alongside the resolved names so the edit
      // form can pre-select without a second round trip.
      branchId: row.branchId,
      customerId: row.customerId,
      originId: row.originId,
      destinationId: row.destinationId,
      commodityId: row.commodityId,
      ownerId: row.ownerId,
      quoteId: row.quoteId,
      branchTimeZone: row.branchTimeZone,
      vesselName: row.vesselName,
      voyageNumber: row.voyageNumber,
      flightNumber: row.flightNumber,
      customerReference: row.customerReference,
      masterBillNumber: row.masterBillNumber,
      houseBillNumber: row.houseBillNumber,
      houseBillSurrenderedAt: row.houseBillSurrenderedAt,
      bookingNumber: row.bookingNumber,
      placeOfReceipt: row.placeOfReceipt,
      placeOfDelivery: row.placeOfDelivery,
      incoterm: row.incoterm,
      // Read off the row it names. It was the literal '—' whatever the job
      // carried, so a commodity chosen on the booking never showed (QA P3).
      commodity: row.commodityName ?? '—',
      commodityAr: row.commodityNameAr,
      grossWeightKg: row.grossWeightKg === null ? null : Number(row.grossWeightKg),
      chargeableWeightKg: row.chargeableWeightKg === null ? null : Number(row.chargeableWeightKg),
      volumeCbm: row.volumeCbm === null ? null : Number(row.volumeCbm),
      pieces: row.pieces,
      customsNote: row.customsNote,
      partners: partnerRows.map((p) => ({
        id: p.id,
        partnerId: p.partnerId,
        name: p.name,
        // `||`, not `??`: an empty Arabic name is as unset as a null one.
        nameAr: p.nameAr || p.name,
        role: p.role,
        reference: p.reference,
      })),
      milestones: milestoneRows.map((m) => ({
        // The id is what `completeMilestone` takes. The timeline does not use
        // it — the dialog beside the timeline does.
        id: m.id,
        code: m.code,
        nameEn: m.nameEn,
        nameAr: m.nameAr,
        plannedAt: m.plannedAt,
        revisedAt: m.revisedAt,
        actualAt: m.actualAt,
        note: m.notes,
      })),
      containers: containerRows.map((c) => ({
        containerNo: c.containerNo ?? '—',
        type: c.containerType ?? '—',
        sealNo: c.sealNo,
        dischargedAt: c.dischargedAt,
        gateOutAt: c.gateOutAt,
        emptyReturnedAt: c.emptyReturnedAt,
      })),
      clocks: clockRows.map((clock) => toClockView(clock, calendar)),
      documents: documentRows.map((d) => ({
        id: d.id,
        code: d.code,
        nameEn: d.nameEn,
        nameAr: d.nameAr,
        version: d.version,
        locale: d.locale,
        releasedAt: d.releasedAt,
        sizeKb: Math.round(d.byteSize / 1024),
      })),
      exceptions: exceptionRows,
    }
  })
}

type Tx = Parameters<Parameters<typeof withActor>[1]>[0]

/**
 * The branch's working calendar, as `accrue` reads it — zone, weekend and
 * holidays. A branch with none falls back to Kuwait's, which is what every
 * clock was counted in before branches had calendars.
 */
async function clockCalendar(tx: Tx, branchId: string): Promise<WorkingCalendar> {
  const [cal] = await tx
    .select({
      id: workingCalendars.id,
      timeZone: workingCalendars.timeZone,
      weekend: workingCalendars.weekend,
    })
    .from(branches)
    .innerJoin(workingCalendars, eq(workingCalendars.id, branches.calendarId))
    .where(eq(branches.id, branchId))
    .limit(1)
  if (!cal) return KUWAIT_CALENDAR
  const holidays = await tx
    .select({ on: calendarHolidays.onDate })
    .from(calendarHolidays)
    .where(eq(calendarHolidays.calendarId, cal.id))
  return {
    ...KUWAIT_CALENDAR,
    id: cal.id,
    timeZone: cal.timeZone,
    weekend: cal.weekend as Weekday[],
    holidays: new Set(holidays.map((h) => h.on)),
  }
}

function toClockView(
  row: typeof freeTimeClocks.$inferSelect,
  calendar: WorkingCalendar = KUWAIT_CALENDAR,
): ClockView {
  const startsOn = new Date(row.startsOn)
  /*
    The meter counts the way the accrual does (O15): the start day is day one,
    working days on a working-day clock, and a stopped clock stops at its end
    date. It counted whole 24-hour periods from midnight UTC — a day short of
    `accrue` from the first morning, still counting after the box came back,
    and counting weekends the bill did not.
  */
  const accrual = accrue(
    {
      kind: row.kind,
      freeDays: row.freeDays,
      perDiem: dec(row.perDiem),
      currency: row.currency,
      dayBasis: row.dayBasis,
    },
    {
      startedOn: new Date(`${row.startsOn}T12:00:00Z`),
      endedOn: row.endsOn ? new Date(`${row.endsOn}T12:00:00Z`) : null,
    },
    calendar,
    new Date(),
  )
  const elapsedDays = accrual.freeDaysUsed + accrual.chargeableDays
  return {
    id: row.id,
    kind: row.kind,
    containerNo: null,
    freeDays: row.freeDays,
    startsOn,
    elapsedDays,
    chargeableDays: row.accruedDays,
    perDiem: { amount: Number(row.perDiem), currency: row.currency },
    accrued: { amount: Number(row.accruedAmount ?? '0'), currency: row.currency },
    counterparty: null,
    /** The line the nightly accrual wrote — `FR-FN-03`. */
    chargeLineWritten: row.chargeLineId !== null,
    equipmentId: row.equipmentId,
    counterpartyId: row.counterpartyId,
    startsOnDay: row.startsOn,
    endsOn: row.endsOn,
    perDiemText: row.perDiem,
  }
}

async function listExceptionRows(
  tx: Tx,
  jobId?: string,
  locale: 'en' | 'ar' = 'en',
): Promise<ExceptionView[]> {
  const rows = await tx
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
    .where(and(isNull(exceptions.closedAt), jobId ? eq(exceptions.jobId, jobId) : undefined))
    // Oldest first — FR-JB-09. The one nobody has looked at is the one to show.
    .orderBy(asc(exceptions.openedAt))
    .limit(50)

  return rows.map((row) => ({
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
  }))
}

/** The exceptions register across every job in scope — oldest first. */
export async function listOpenExceptions(actor: Actor): Promise<ExceptionView[]> {
  if (usePilotFixtures()) return pilotExceptions()
  return withActor(actor, (tx) => listExceptionRows(tx))
}

/** Every clock still running, for the demurrage panel. */
export async function listRunningClocks(
  actor: Actor,
): Promise<readonly (ClockView & { jobId: string; jobReference: string })[]> {
  if (usePilotFixtures()) {
    return pilotJobs()
      .filter((job) => job.accruing !== null)
      .flatMap((job) => {
        const detail = pilotJob(job.id)
        return (detail?.clocks ?? []).map((clock) => ({
          ...clock,
          jobId: job.id,
          jobReference: job.reference,
        }))
      })
  }

  return withActor(actor, async (tx) => {
    const rows = await tx
      .select({
        clock: freeTimeClocks,
        jobReference: jobs.reference,
        branchId: jobs.branchId,
        containerNo: equipment.containerNo,
      })
      .from(freeTimeClocks)
      .innerJoin(jobs, eq(jobs.id, freeTimeClocks.jobId))
      .leftJoin(equipment, eq(equipment.id, freeTimeClocks.equipmentId))
      .where(and(isNull(freeTimeClocks.endsOn), gt(freeTimeClocks.accruedDays, 0)))
      .orderBy(desc(freeTimeClocks.accruedAmount))
      .limit(20)

    // One calendar per branch on the list, not one per clock.
    const calendars = new Map<string, WorkingCalendar>()
    for (const row of rows) {
      if (!calendars.has(row.branchId)) {
        calendars.set(row.branchId, await clockCalendar(tx, row.branchId))
      }
    }

    return rows.map((row) => ({
      ...toClockView(row.clock, calendars.get(row.branchId)),
      containerNo: row.containerNo,
      jobId: row.clock.jobId,
      jobReference: row.jobReference,
    }))
  })
}

/**
 * What every running clock has accrued, per currency — the board's
 * "Accruing" tile.
 *
 * The tile summed `listRunningClocks`, which is the panel's twenty worst
 * clocks: past twenty, the figure was the twenty largest rather than the
 * branch's exposure, presented as the total. Summed here over every running
 * clock, from the same stored `accrued_amount` each clock's row shows, as
 * `numeric` text so no float touches it.
 */
export async function accruingTotals(actor: Actor): Promise<CurrencyAmount[]> {
  if (usePilotFixtures()) {
    return sumByCurrency(
      (await listRunningClocks(actor)).map((clock) => ({
        currency: clock.accrued.currency,
        amount: String(clock.accrued.amount),
      })),
    )
  }

  return withActor(actor, async (tx) => {
    const rows = await tx
      .select({
        currency: freeTimeClocks.currency,
        amount: sql<string>`coalesce(sum(${freeTimeClocks.accruedAmount}), 0)::text`,
      })
      .from(freeTimeClocks)
      .innerJoin(jobs, eq(jobs.id, freeTimeClocks.jobId))
      .where(and(isNull(freeTimeClocks.endsOn), gt(freeTimeClocks.accruedDays, 0)))
      .groupBy(freeTimeClocks.currency)
      .orderBy(desc(sql`sum(${freeTimeClocks.accruedAmount})`), asc(freeTimeClocks.currency))
    return rows.map(({ currency, amount }) => ({ currency, amount }))
  })
}

/**
 * What a shipment booked from this quotation starts with — S8.
 *
 * Null unless the quotation can be booked: accepted, its enquiry has a known
 * customer, and no live shipment already carries it. That is the same rule
 * `saveJob` enforces under a lock; asking it here only decides whether the
 * quote page offers the button, so a page opened twice never invites a second
 * booking that the action would then refuse.
 *
 * The pilot fixtures never write, so they never offer it.
 */
export async function quoteBookingDefaults(
  actor: Actor,
  quoteId: string,
): Promise<{
  readonly quoteId: string
  readonly branchId: string
  readonly customerId: string
  readonly ownerId: string | null
  readonly mode: string | null
  readonly tradeDirection: string | null
  readonly originId: string | null
  readonly destinationId: string | null
  readonly commodityId: string | null
  readonly incoterm: string | null
  readonly grossWeightKg: string | null
  readonly volumeCbm: string | null
  readonly pieces: number | null
} | null> {
  if (usePilotFixtures()) return null

  return withActor(actor, async (tx) => {
    const [row] = await tx
      .select({
        status: quotes.status,
        branchId: quotes.branchId,
        customerId: enquiries.customerId,
        ownerId: enquiries.ownerId,
        mode: enquiries.mode,
        tradeDirection: enquiries.tradeDirection,
        originId: enquiries.originId,
        destinationId: enquiries.destinationId,
        commodityId: enquiries.commodityId,
        incoterm: enquiries.incoterm,
        grossWeightKg: enquiries.grossWeightKg,
        volumeCbm: enquiries.volumeCbm,
        pieces: enquiries.pieces,
      })
      .from(quotes)
      .innerJoin(enquiries, eq(enquiries.id, quotes.enquiryId))
      .where(eq(quotes.id, quoteId))
      .limit(1)
    if (!row || row.status !== 'accepted' || !row.customerId) return null

    const [booked] = await tx
      .select({ id: jobs.id })
      .from(jobs)
      .where(and(eq(jobs.quoteId, quoteId), ne(jobs.status, 'cancelled')))
      .limit(1)
    if (booked) return null

    return {
      quoteId,
      branchId: row.branchId,
      customerId: row.customerId,
      ownerId: row.ownerId,
      mode: row.mode,
      tradeDirection: row.tradeDirection,
      originId: row.originId,
      destinationId: row.destinationId,
      commodityId: row.commodityId,
      incoterm: row.incoterm,
      grossWeightKg: row.grossWeightKg,
      volumeCbm: row.volumeCbm,
      pieces: row.pieces,
    }
  })
}

/** Public tracking is its own slice — see `features/tracking/queries.ts`. */
