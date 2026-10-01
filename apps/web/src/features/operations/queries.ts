/**
 * The operations registers — exceptions, customs, documents.
 *
 * Three views onto the same job file, each answering a different person's
 * question: the operations manager wants to know what is broken, the broker
 * wants to know what is stuck at customs, and the coordinator wants to know
 * what paperwork is missing. Kept in one slice because all three read `jobs`
 * and would otherwise duplicate the same joins three ways.
 *
 * Each read has a fixture implementation taken before `withActor`, so the
 * three registers and their filter strips work with no database at all. The
 * scope argument goes through to the builder: a "Held" tab that shows the same
 * rows as "Live" is a demo the room stops believing.
 */

import { asc, desc, eq, isNotNull, isNull, sql } from 'drizzle-orm'
import {
  customers,
  customsStages,
  documents,
  documentTypes,
  exceptionCodes,
  exceptions,
  jobs,
  partners,
  principals,
  withActor,
  type Actor,
} from '@qabandi/db'
import { usePilotFixtures } from '@/lib/pilot/source'
import {
  pilotCustomsCounts,
  pilotCustomsRows,
  pilotDocumentCounts,
  pilotDocumentRows,
  pilotExceptionCounts,
  pilotExceptionRows,
} from '@/lib/pilot/fixtures'

// --- exceptions ------------------------------------------------------------

export interface ExceptionRow {
  readonly id: string
  readonly jobId: string
  readonly jobReference: string
  readonly customerName: string | null
  readonly customerNameAr: string | null
  readonly code: string
  readonly nameEn: string
  readonly nameAr: string
  readonly severity: string
  readonly description: string | null
  readonly openedAt: Date
  readonly dueAt: Date | null
  readonly closedAt: Date | null
  readonly owner: string | null
  readonly costImpact: string | null
  readonly costCurrency: string | null
}

/**
 * Open exceptions, oldest first — `FR-JB-09`.
 *
 * Oldest rather than most severe, and that ordering is the point: the
 * exception nobody has looked at for four days is by definition the one the
 * current process missed. Severity is already visible as a colour.
 */
export async function listExceptions(
  actor: Actor,
  scope: 'open' | 'closed' | 'all' = 'open',
): Promise<ExceptionRow[]> {
  if (usePilotFixtures()) return pilotExceptionRows(Date.now(), scope)

  return withActor(actor, async (tx) => {
    const filter =
      scope === 'open'
        ? isNull(exceptions.closedAt)
        : scope === 'closed'
          ? isNotNull(exceptions.closedAt)
          : undefined

    return (
      tx
        .select({
          id: exceptions.id,
          jobId: exceptions.jobId,
          jobReference: jobs.reference,
          customerName: customers.legalNameEn,
          customerNameAr: customers.legalNameAr,
          code: exceptionCodes.code,
          nameEn: exceptionCodes.nameEn,
          nameAr: exceptionCodes.nameAr,
          severity: exceptions.severity,
          description: exceptions.description,
          openedAt: exceptions.openedAt,
          dueAt: exceptions.dueAt,
          closedAt: exceptions.closedAt,
          owner: principals.nameEn,
          costImpact: exceptions.costImpact,
          costCurrency: exceptions.costCurrency,
        })
        .from(exceptions)
        .innerJoin(exceptionCodes, eq(exceptionCodes.id, exceptions.exceptionCodeId))
        .innerJoin(jobs, eq(jobs.id, exceptions.jobId))
        .leftJoin(customers, eq(customers.id, jobs.customerId))
        .leftJoin(principals, eq(principals.id, exceptions.ownerId))
        .where(filter)
        /*
        Oldest first is right for the open ones and wrong for the closed (O18):
        with more than 200 closed, the newest closures — the ones anybody is
        looking for — never made the page. Closed ones read newest-closed
        first; "all" lists the open ones (oldest first) and then the closed.
      */
        .orderBy(
          ...(scope === 'open'
            ? [asc(exceptions.openedAt)]
            : [
                desc(sql`coalesce(${exceptions.closedAt}, 'infinity'::timestamptz)`),
                asc(exceptions.openedAt),
              ]),
        )
        .limit(200)
    )
  })
}

export async function exceptionCounts(
  actor: Actor,
): Promise<{ open: number; closed: number; overdue: number }> {
  if (usePilotFixtures()) return pilotExceptionCounts()

  return withActor(actor, async (tx) => {
    const result = await tx.execute(sql`
      select
        count(*) filter (where closed_at is null)::int                          as open,
        count(*) filter (where closed_at is not null)::int                      as closed,
        count(*) filter (where closed_at is null and due_at < now())::int       as overdue
      from exceptions
    `)
    const row = result.rows[0] as unknown as
      { open: number; closed: number; overdue: number } | undefined
    return { open: row?.open ?? 0, closed: row?.closed ?? 0, overdue: row?.overdue ?? 0 }
  })
}

// --- customs ---------------------------------------------------------------

export interface CustomsRow {
  readonly id: string
  readonly jobId: string
  readonly jobReference: string
  readonly customerName: string | null
  readonly customerNameAr: string | null
  readonly status: string
  readonly declarationType: string | null
  readonly declarationNo: string | null
  readonly filedAt: Date | null
  readonly releasedAt: Date | null
  readonly slaDueAt: Date | null
  readonly inspectionRequired: boolean
  readonly dutyAmount: string | null
  readonly dutyCurrency: string | null
  readonly brokerName: string | null
  readonly brokerNameAr: string | null
}

export async function listCustoms(
  actor: Actor,
  scope: 'live' | 'released' | 'all' = 'live',
): Promise<CustomsRow[]> {
  if (usePilotFixtures()) return pilotCustomsRows(Date.now(), scope)

  return withActor(actor, async (tx) => {
    const filter =
      scope === 'live'
        ? isNull(customsStages.releasedAt)
        : scope === 'released'
          ? isNotNull(customsStages.releasedAt)
          : undefined

    return (
      tx
        .select({
          id: customsStages.id,
          jobId: customsStages.jobId,
          jobReference: jobs.reference,
          customerName: customers.legalNameEn,
          customerNameAr: customers.legalNameAr,
          status: customsStages.status,
          declarationType: customsStages.declarationType,
          declarationNo: customsStages.declarationNo,
          filedAt: customsStages.filedAt,
          releasedAt: customsStages.releasedAt,
          slaDueAt: customsStages.slaDueAt,
          inspectionRequired: customsStages.inspectionRequired,
          dutyAmount: customsStages.dutyAmount,
          dutyCurrency: customsStages.dutyCurrency,
          brokerName: partners.legalNameEn,
          brokerNameAr: partners.legalNameAr,
        })
        .from(customsStages)
        .innerJoin(jobs, eq(jobs.id, customsStages.jobId))
        .leftJoin(customers, eq(customers.id, jobs.customerId))
        .leftJoin(partners, eq(partners.id, customsStages.brokerPartnerId))
        .where(filter)
        // Released ones newest first, for the reason the exceptions give (O18).
        .orderBy(
          ...(scope === 'live'
            ? [asc(customsStages.slaDueAt)]
            : [
                desc(sql`coalesce(${customsStages.releasedAt}, 'infinity'::timestamptz)`),
                asc(customsStages.slaDueAt),
              ]),
        )
        .limit(200)
    )
  })
}

export async function customsCounts(
  actor: Actor,
): Promise<{ live: number; released: number; held: number }> {
  if (usePilotFixtures()) return pilotCustomsCounts()

  return withActor(actor, async (tx) => {
    const result = await tx.execute(sql`
      select
        count(*) filter (where released_at is null)::int      as live,
        count(*) filter (where released_at is not null)::int  as released,
        count(*) filter (where status = 'held')::int          as held
      from customs_stages
    `)
    const row = result.rows[0] as unknown as
      { live: number; released: number; held: number } | undefined
    return { live: row?.live ?? 0, released: row?.released ?? 0, held: row?.held ?? 0 }
  })
}

// --- documents -------------------------------------------------------------

export interface DocumentRow {
  readonly id: string
  readonly jobId: string
  readonly jobReference: string
  readonly customerName: string | null
  readonly customerNameAr: string | null
  readonly typeCode: string
  readonly typeNameEn: string
  readonly typeNameAr: string
  readonly category: string
  readonly version: number
  readonly releasedAt: Date | null
  readonly authorName: string | null
  readonly createdAt: Date
  readonly isSuperseded: boolean
}

/**
 * The document register, newest first.
 *
 * Superseded versions stay visible rather than being filtered out: a house
 * bill that was reissued is exactly the thing someone needs to find when the
 * customer is holding the old one.
 */
export async function listDocuments(actor: Actor): Promise<DocumentRow[]> {
  if (usePilotFixtures()) return pilotDocumentRows()

  return withActor(actor, async (tx) =>
    tx
      .select({
        id: documents.id,
        jobId: documents.jobId,
        jobReference: jobs.reference,
        customerName: customers.legalNameEn,
        customerNameAr: customers.legalNameAr,
        typeCode: documentTypes.code,
        typeNameEn: documentTypes.nameEn,
        typeNameAr: documentTypes.nameAr,
        category: documentTypes.category,
        version: documents.version,
        releasedAt: documents.releasedAt,
        authorName: principals.nameEn,
        createdAt: documents.createdAt,
        isSuperseded: sql<boolean>`${documents.supersededById} is not null`,
      })
      .from(documents)
      .innerJoin(documentTypes, eq(documentTypes.id, documents.documentTypeId))
      .innerJoin(jobs, eq(jobs.id, documents.jobId))
      .leftJoin(customers, eq(customers.id, jobs.customerId))
      .leftJoin(principals, eq(principals.id, documents.authorId))
      .orderBy(desc(documents.createdAt))
      .limit(200),
  )
}

export async function documentCounts(
  actor: Actor,
): Promise<{ total: number; released: number; draft: number }> {
  if (usePilotFixtures()) return pilotDocumentCounts()

  return withActor(actor, async (tx) => {
    const result = await tx.execute(sql`
      select count(*)::int                                        as total,
             count(*) filter (where released_at is not null)::int as released,
             count(*) filter (where released_at is null)::int     as draft
        from documents
    `)
    const row = result.rows[0] as unknown as
      { total: number; released: number; draft: number } | undefined
    return { total: row?.total ?? 0, released: row?.released ?? 0, draft: row?.draft ?? 0 }
  })
}
