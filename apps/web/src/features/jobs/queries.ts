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
import { and, asc, desc, eq, gt, isNull, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import {
  assets,
  customers,
  customsStages,
  documentTypes,
  documents,
  equipment,
  exceptionCodes,
  exceptions,
  freeTimeClocks,
  jobMilestones,
  jobs,
  locations,
  principals,
  withActor,
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

const origin = alias(locations, 'origin')
const destination = alias(locations, 'destination')

export interface JobListFilters {
  readonly status?: string
  readonly mode?: string
  readonly branchCode?: string
  /** Only jobs carrying an open exception or a customs hold. */
  readonly exceptionsOnly?: boolean
  readonly limit?: number
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
  select count(*)::int from ${equipment} where ${equipment.jobId} = ${jobs.id}
)`

const milestonesTotal = sql<number>`(
  select count(*)::int from ${jobMilestones} where ${jobMilestones.jobId} = ${jobs.id}
)`

const milestonesDone = sql<number>`(
  select count(*)::int from ${jobMilestones}
   where ${jobMilestones.jobId} = ${jobs.id} and ${jobMilestones.actualAt} is not null
)`

const openExceptions = sql<number>`(
  select count(*)::int from ${exceptions}
   where ${exceptions.jobId} = ${jobs.id} and ${exceptions.closedAt} is null
)`

const accruingAmount = sql<string | null>`(
  select sum(${freeTimeClocks.accruedAmount}) from ${freeTimeClocks}
   where ${freeTimeClocks.jobId} = ${jobs.id} and ${freeTimeClocks.endsOn} is null
)`

export async function listJobs(actor: Actor, filters: JobListFilters = {}): Promise<JobSummary[]> {
  if (usePilotFixtures()) {
    let rows = pilotJobs()
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
    return rows
      .sort((a, b) => (a.eta?.getTime() ?? Infinity) - (b.eta?.getTime() ?? Infinity))
      .slice(0, filters.limit ?? 50)
  }

  const limit = Math.min(filters.limit ?? 50, 200)

  return withActor(actor, async (tx) => {
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
        branchCode: sql<string>`''`,
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
        containerCount,
        milestonesTotal,
        milestonesDone,
        openExceptions,
        accruingAmount,
      })
      .from(jobs)
      .leftJoin(customers, eq(customers.id, jobs.customerId))
      .leftJoin(principals, eq(principals.id, jobs.ownerId))
      .leftJoin(origin, eq(origin.id, jobs.originId))
      .leftJoin(destination, eq(destination.id, jobs.destinationId))
      .leftJoin(customsStages, eq(customsStages.jobId, jobs.id))
      .where(
        and(
          filters.status === 'live'
            ? sql`${jobs.status} in ('booked','in_transit','arrived','customs','on_hold')`
            : filters.status
              ? sql`${jobs.status} = ${filters.status}`
              : undefined,
          filters.mode ? sql`${jobs.mode} = ${filters.mode}` : undefined,
          filters.exceptionsOnly ? sql`${openExceptions} > 0` : undefined,
        ),
      )
      .orderBy(asc(jobs.eta), desc(jobs.updatedAt))
      .limit(limit)

    return rows.map(toJobSummary)
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
  branchCode: string
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
  accruingAmount: string | null
}

function toJobSummary(row: JobRow): JobSummary {
  return {
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
      row.accruingAmount === null ? null : { amount: Number(row.accruingAmount), currency: 'KWD' },
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
export async function getJobDetail(actor: Actor, id: string): Promise<JobDetail | undefined> {
  if (usePilotFixtures()) return pilotJob(id)

  return withActor(actor, async (tx) => {
    const [row] = await tx
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
        branchCode: sql<string>`''`,
        customerReference: jobs.customerReference,
        masterBillNumber: jobs.masterBillNumber,
        houseBillNumber: jobs.houseBillNumber,
        bookingNumber: jobs.bookingNumber,
        incoterm: jobs.incoterm,
        grossWeightKg: jobs.grossWeightKg,
        chargeableWeightKg: jobs.chargeableWeightKg,
        volumeCbm: jobs.volumeCbm,
        pieces: jobs.pieces,
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
        customsNote: customsStages.notes,
        containerCount,
        milestonesTotal,
        milestonesDone,
        openExceptions,
        accruingAmount,
      })
      .from(jobs)
      .leftJoin(customers, eq(customers.id, jobs.customerId))
      .leftJoin(principals, eq(principals.id, jobs.ownerId))
      .leftJoin(origin, eq(origin.id, jobs.originId))
      .leftJoin(destination, eq(destination.id, jobs.destinationId))
      .leftJoin(customsStages, eq(customsStages.jobId, jobs.id))
      .where(eq(jobs.id, id))
      .limit(1)

    if (!row) return undefined

    const [milestoneRows, containerRows, clockRows, documentRows, exceptionRows] =
      await Promise.all([
        tx
          .select()
          .from(jobMilestones)
          .where(eq(jobMilestones.jobId, id))
          .orderBy(asc(jobMilestones.seq)),
        tx.select().from(equipment).where(eq(equipment.jobId, id)),
        tx
          .select()
          .from(freeTimeClocks)
          .where(eq(freeTimeClocks.jobId, id))
          .orderBy(desc(freeTimeClocks.accruedAmount)),
        tx
          .select({
            id: documents.id,
            version: documents.version,
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
        listExceptionRows(tx, id),
      ])

    const summary = toJobSummary(row as JobRow)

    return {
      ...summary,
      customerReference: row.customerReference,
      masterBillNumber: row.masterBillNumber,
      houseBillNumber: row.houseBillNumber,
      bookingNumber: row.bookingNumber,
      incoterm: row.incoterm,
      commodity: '—',
      grossWeightKg: row.grossWeightKg === null ? null : Number(row.grossWeightKg),
      chargeableWeightKg: row.chargeableWeightKg === null ? null : Number(row.chargeableWeightKg),
      volumeCbm: row.volumeCbm === null ? null : Number(row.volumeCbm),
      pieces: row.pieces,
      customsNote: row.customsNote,
      milestones: milestoneRows.map((m) => ({
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
      clocks: clockRows.map(toClockView),
      documents: documentRows.map((d) => ({
        id: d.id,
        code: d.code,
        nameEn: d.nameEn,
        nameAr: d.nameAr,
        version: d.version,
        releasedAt: d.releasedAt,
        sizeKb: Math.round(d.byteSize / 1024),
      })),
      exceptions: exceptionRows,
    }
  })
}

function toClockView(row: typeof freeTimeClocks.$inferSelect): ClockView {
  const startsOn = new Date(row.startsOn)
  const elapsedDays = Math.max(
    0,
    Math.floor((Date.now() - startsOn.getTime()) / (24 * 60 * 60 * 1000)),
  )
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
  }
}

type Tx = Parameters<Parameters<typeof withActor>[1]>[0]

async function listExceptionRows(tx: Tx, jobId?: string): Promise<ExceptionView[]> {
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
      owner: principals.nameEn,
      customerName: customers.legalNameEn,
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
        containerNo: equipment.containerNo,
      })
      .from(freeTimeClocks)
      .innerJoin(jobs, eq(jobs.id, freeTimeClocks.jobId))
      .leftJoin(equipment, eq(equipment.id, freeTimeClocks.equipmentId))
      .where(and(isNull(freeTimeClocks.endsOn), gt(freeTimeClocks.accruedDays, 0)))
      .orderBy(desc(freeTimeClocks.accruedAmount))
      .limit(20)

    return rows.map((row) => ({
      ...toClockView(row.clock),
      containerNo: row.containerNo,
      jobId: row.clock.jobId,
      jobReference: row.jobReference,
    }))
  })
}

/** Public tracking is its own slice — see `features/tracking/queries.ts`. */
