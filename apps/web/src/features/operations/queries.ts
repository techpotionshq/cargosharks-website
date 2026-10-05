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

import { and, asc, desc, eq, ilike, isNotNull, isNull, or, sql } from 'drizzle-orm'
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
import { named } from '@/lib/named'
import { usePilotFixtures } from '@/lib/pilot/source'
import { countRows, pageOf, pageRequest, readPage, type Page, type PageRequest } from '@/lib/paging'
import {
  pilotCustomsCounts,
  pilotCustomsRows,
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
  locale: 'en' | 'ar' = 'en',
  request: PageRequest = pageRequest(undefined),
): Promise<Page<ExceptionRow>> {
  if (usePilotFixtures()) return pageOf(pilotExceptionRows(Date.now(), scope, locale), request)

  const filter =
    scope === 'open'
      ? isNull(exceptions.closedAt)
      : scope === 'closed'
        ? isNotNull(exceptions.closedAt)
        : undefined

  // Paged with a count where this was `limit(200)` (the audit after live run 5).
  return withActor(actor, (tx) =>
    readPage(
      request,
      (limit, offset) =>
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
            // The owner as they write their own name — principals.name_ar (F27).
            owner: named(locale, principals.nameEn, principals.nameAr),
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
            asc(exceptions.id),
          )
          .limit(limit)
          .offset(offset),
      () => countRows(tx, exceptions, filter),
    ),
  )
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
  /*
    `held` is its own scope rather than a filter over the live page. The
    register read the live list and kept the holds in memory, so it could find
    only the holds among the first two hundred by deadline; and the count on
    its tab (`customsCounts`) is `status = 'held'`, which this now matches.
  */
  scope: 'live' | 'held' | 'released' | 'all' = 'live',
  request: PageRequest = pageRequest(undefined),
): Promise<Page<CustomsRow>> {
  if (usePilotFixtures()) {
    const rows =
      scope === 'held'
        ? pilotCustomsRows(Date.now(), 'all').filter((row) => row.status === 'held')
        : pilotCustomsRows(Date.now(), scope)
    return pageOf(rows, request)
  }

  const filter =
    scope === 'live'
      ? isNull(customsStages.releasedAt)
      : scope === 'held'
        ? eq(customsStages.status, 'held')
        : scope === 'released'
          ? isNotNull(customsStages.releasedAt)
          : undefined

  // Paged with a count where this was `limit(200)` (the audit after live run 5).
  return withActor(actor, (tx) =>
    readPage(
      request,
      (limit, offset) =>
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
            asc(customsStages.id),
          )
          .limit(limit)
          .offset(offset),
      () => countRows(tx, customsStages, filter),
    ),
  )
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

export interface DocumentFilters {
  /** Shipment reference, customer name in either language, or document type. */
  readonly search?: string
  /** `released`, or `draft` for not yet released — the two figures the summary counts. */
  readonly state?: 'released' | 'draft'
}

/** The fixture register, filtered exactly as `documentsWhere` filters the table. */
function pilotDocumentsMatching(filters: DocumentFilters, locale: 'en' | 'ar'): DocumentRow[] {
  const term = filters.search?.trim().toLowerCase()
  return pilotDocumentRows(Date.now(), locale).filter(
    (row) =>
      (!filters.state ||
        (filters.state === 'released' ? row.releasedAt !== null : row.releasedAt === null)) &&
      (!term ||
        [
          row.jobReference,
          row.customerName,
          row.customerNameAr,
          row.typeCode,
          row.typeNameEn,
          row.typeNameAr,
        ].some((value) => (value ?? '').toLowerCase().includes(term))),
  )
}

/**
 * The register's filter as SQL, shared by the page and every count.
 *
 * Over the joined shipment, customer and document type, because those are what
 * somebody types: "the bill for Fintas", "KWI-JOB-2026-00412", "packing list".
 */
function documentsWhere(filters: DocumentFilters) {
  const term = filters.search?.trim()
  const like = term ? `%${term}%` : undefined
  return and(
    filters.state === 'released'
      ? isNotNull(documents.releasedAt)
      : filters.state === 'draft'
        ? isNull(documents.releasedAt)
        : undefined,
    like
      ? or(
          ilike(jobs.reference, like),
          ilike(customers.legalNameEn, like),
          ilike(customers.legalNameAr, like),
          ilike(documentTypes.code, like),
          ilike(documentTypes.nameEn, like),
          ilike(documentTypes.nameAr, like),
        )
      : undefined,
  )
}

/**
 * The document register, newest first.
 *
 * Superseded versions stay visible rather than being filtered out: a house
 * bill that was reissued is exactly the thing someone needs to find when the
 * customer is holding the old one.
 *
 * Paged, searchable and filterable. Live run 5 found a hundred and five rows
 * in one unbroken list with no way to look for anything, capped at two hundred
 * besides, and a branch raises several documents per shipment — the register
 * a launch with four hundred open jobs would have outgrown in its first week.
 */
export async function listDocuments(
  actor: Actor,
  locale: 'en' | 'ar' = 'en',
  filters: DocumentFilters = {},
  request: PageRequest = pageRequest(undefined),
): Promise<Page<DocumentRow>> {
  if (usePilotFixtures()) return pageOf(pilotDocumentsMatching(filters, locale), request)

  const where = documentsWhere(filters)
  return withActor(actor, (tx) =>
    readPage(
      request,
      (limit, offset) =>
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
            authorName: named(locale, principals.nameEn, principals.nameAr),
            createdAt: documents.createdAt,
            isSuperseded: sql<boolean>`${documents.supersededById} is not null`,
          })
          .from(documents)
          .innerJoin(documentTypes, eq(documentTypes.id, documents.documentTypeId))
          .innerJoin(jobs, eq(jobs.id, documents.jobId))
          .leftJoin(customers, eq(customers.id, jobs.customerId))
          .leftJoin(principals, eq(principals.id, documents.authorId))
          .where(where)
          .orderBy(desc(documents.createdAt), desc(documents.id))
          .limit(limit)
          .offset(offset),
      async () => {
        const [row] = await tx
          .select({ n: sql<number>`count(*)::int` })
          .from(documents)
          .innerJoin(documentTypes, eq(documentTypes.id, documents.documentTypeId))
          .innerJoin(jobs, eq(jobs.id, documents.jobId))
          .leftJoin(customers, eq(customers.id, jobs.customerId))
          .where(where)
        return row?.n ?? 0
      },
    ),
  )
}

/**
 * The register's figures — every document, released, and not yet released —
 * over the same search the table is showing, so the filter beside each figure
 * pages through exactly that many rows.
 */
export async function documentCounts(
  actor: Actor,
  search?: string,
): Promise<{ total: number; released: number; draft: number }> {
  if (usePilotFixtures()) {
    const rows = pilotDocumentsMatching({ search }, 'en')
    return {
      total: rows.length,
      released: rows.filter((row) => row.releasedAt !== null).length,
      draft: rows.filter((row) => row.releasedAt === null).length,
    }
  }

  return withActor(actor, async (tx) => {
    const [row] = await tx
      .select({
        total: sql<number>`count(*)::int`,
        released: sql<number>`(count(*) filter (where ${documents.releasedAt} is not null))::int`,
        draft: sql<number>`(count(*) filter (where ${documents.releasedAt} is null))::int`,
      })
      .from(documents)
      .innerJoin(documentTypes, eq(documentTypes.id, documents.documentTypeId))
      .innerJoin(jobs, eq(jobs.id, documents.jobId))
      .leftJoin(customers, eq(customers.id, jobs.customerId))
      .where(documentsWhere({ search }))
    return { total: row?.total ?? 0, released: row?.released ?? 0, draft: row?.draft ?? 0 }
  })
}
