/**
 * Administration reads — people, branches, reference tables, the audit trail.
 *
 * These are the screens that answer "who can do what, and who did what". They
 * are read-only here: user creation is `pnpm db:create-user` (FR-ID-07 makes
 * the product invitation-only, and the first account necessarily precedes any
 * account that could authorise it), and the reference tables are edited
 * through migrations rather than through a form nobody audits.
 */

import { asc, desc, eq, sql } from 'drizzle-orm'
import {
  auditLog,
  branches,
  chargeTypes,
  containerTypes,
  countries,
  currencies,
  documentTypes,
  exceptionCodes,
  incoterms,
  milestoneTemplates,
  principalBranchRoles,
  principals,
  roles,
  withActor,
  workingCalendars,
  type Actor,
} from '@qabandi/db'

// --- people ----------------------------------------------------------------

export interface UserRow {
  readonly id: string
  readonly nameEn: string
  readonly nameAr: string | null
  readonly email: string
  readonly type: string
  readonly locale: string
  readonly isActive: boolean
  readonly lastSeenAt: Date | null
  readonly hasLogin: boolean
  /** `KWI: Operations Manager`, one per branch — FR-ID-02. */
  readonly assignments: { branchCode: string; roleKey: string; requiresTwoFactor: boolean }[]
}

export async function listUsers(actor: Actor): Promise<UserRow[]> {
  return withActor(actor, async (tx) => {
    const people = await tx
      .select({
        id: principals.id,
        nameEn: principals.nameEn,
        nameAr: principals.nameAr,
        email: principals.email,
        type: principals.type,
        locale: principals.locale,
        isActive: principals.isActive,
        lastSeenAt: principals.lastSeenAt,
        hasLogin: sql<boolean>`${principals.authUserId} is not null`,
      })
      .from(principals)
      .orderBy(asc(principals.nameEn))
      .limit(200)

    // One extra query rather than one per person: the role grid is small, and
    // an N+1 against a distant database is the difference between 300ms and
    // thirty seconds.
    const assignments = await tx
      .select({
        principalId: principalBranchRoles.principalId,
        branchCode: branches.code,
        roleKey: roles.key,
        requiresTwoFactor: roles.requiresTwoFactor,
      })
      .from(principalBranchRoles)
      .innerJoin(branches, eq(branches.id, principalBranchRoles.branchId))
      .innerJoin(roles, eq(roles.id, principalBranchRoles.roleId))
      .orderBy(asc(branches.code))

    const byPrincipal = new Map<string, UserRow['assignments']>()
    for (const row of assignments) {
      const list = byPrincipal.get(row.principalId) ?? []
      list.push({
        branchCode: row.branchCode,
        roleKey: row.roleKey,
        requiresTwoFactor: row.requiresTwoFactor,
      })
      byPrincipal.set(row.principalId, list)
    }

    return people.map((person) => ({
      ...person,
      assignments: byPrincipal.get(person.id) ?? [],
    }))
  })
}

/** The permission matrix as the interface renders it — role by permission. */
export async function listRoles(
  actor: Actor,
): Promise<
  { key: string; nameEn: string; nameAr: string; requiresTwoFactor: boolean; permissions: number }[]
> {
  return withActor(actor, async (tx) =>
    tx
      .select({
        key: roles.key,
        nameEn: roles.nameEn,
        nameAr: roles.nameAr,
        requiresTwoFactor: roles.requiresTwoFactor,
        permissions: sql<number>`(
          select count(*)::int from role_permissions rp
           where rp.role_id = ${roles.id} and rp.allowed
        )`,
      })
      .from(roles)
      .orderBy(asc(roles.key)),
  )
}

// --- branches --------------------------------------------------------------

export interface BranchRow {
  readonly id: string
  readonly code: string
  readonly legalNameEn: string
  readonly legalNameAr: string | null
  readonly country: string
  readonly baseCurrency: string
  readonly timeZone: string
  readonly invoiceSeries: string | null
  readonly invoiceSeriesNext: number
  readonly isActive: boolean
  readonly calendarName: string | null
  readonly people: number
  readonly openJobs: number
}

export async function listBranches(actor: Actor): Promise<BranchRow[]> {
  return withActor(actor, async (tx) =>
    tx
      .select({
        id: branches.id,
        code: branches.code,
        legalNameEn: branches.legalNameEn,
        legalNameAr: branches.legalNameAr,
        country: branches.country,
        baseCurrency: branches.baseCurrency,
        timeZone: branches.timeZone,
        invoiceSeries: branches.invoiceSeries,
        invoiceSeriesNext: branches.invoiceSeriesNext,
        isActive: branches.isActive,
        calendarName: workingCalendars.nameEn,
        people: sql<number>`(
          select count(*)::int from principal_branch_roles pbr
           where pbr.branch_id = ${branches.id}
        )`,
        openJobs: sql<number>`(
          select count(*)::int from jobs j
           where j.branch_id = ${branches.id}
             and j.status not in ('closed', 'cancelled')
        )`,
      })
      .from(branches)
      .leftJoin(workingCalendars, eq(workingCalendars.id, branches.calendarId))
      .orderBy(asc(branches.code)),
  )
}

// --- reference data --------------------------------------------------------

export interface ReferenceTable {
  readonly key: string
  readonly count: number
}

/**
 * Row counts for the tables the engines read.
 *
 * The point of this screen is that an empty reference table is a silent
 * failure: rating cannot resolve a charge type that does not exist, and the
 * error surfaces three screens away as "no rate found".
 */
export async function referenceCounts(actor: Actor): Promise<ReferenceTable[]> {
  return withActor(actor, async (tx) => {
    const result = await tx.execute(sql`
      select
        (select count(*) from currencies)::int          as currencies,
        (select count(*) from countries)::int           as countries,
        (select count(*) from incoterms)::int           as incoterms,
        (select count(*) from container_types)::int     as container_types,
        (select count(*) from charge_types)::int        as charge_types,
        (select count(*) from exception_codes)::int     as exception_codes,
        (select count(*) from document_types)::int      as document_types,
        (select count(*) from milestone_templates)::int as milestone_templates,
        (select count(*) from working_calendars)::int   as working_calendars,
        (select count(*) from commodities)::int         as commodities,
        (select count(*) from chargeable_rules)::int    as chargeable_rules
    `)
    const row = (result.rows[0] ?? {}) as Record<string, number>
    return Object.entries(row).map(([key, count]) => ({ key, count: Number(count) }))
  })
}

export async function listChargeTypes(
  actor: Actor,
): Promise<{ key: string; nameEn: string; nameAr: string; category: string; basis: string }[]> {
  return withActor(actor, async (tx) =>
    tx
      .select({
        key: chargeTypes.key,
        nameEn: chargeTypes.nameEn,
        nameAr: chargeTypes.nameAr,
        category: chargeTypes.category,
        basis: chargeTypes.defaultBasis,
      })
      .from(chargeTypes)
      .orderBy(asc(chargeTypes.sortOrder)),
  )
}

export async function listReferenceSample(actor: Actor): Promise<{
  incoterms: { code: string; nameEn: string }[]
  containers: { code: string; nameEn: string; teu: string | null }[]
  exceptions: { code: string; nameEn: string; slaHours: number | null }[]
  documents: { code: string; nameEn: string; category: string }[]
  calendars: { key: string; nameEn: string; timeZone: string }[]
  currencies: { code: string; nameEn: string | null }[]
  countries: { code: string; nameEn: string }[]
  milestones: number
}> {
  return withActor(actor, async (tx) => {
    const [
      incotermRows,
      containerRows,
      exceptionRows,
      documentRows,
      calendarRows,
      currencyRows,
      countryRows,
      milestoneRows,
    ] = [
      await tx
        .select({ code: incoterms.code, nameEn: incoterms.nameEn })
        .from(incoterms)
        .orderBy(asc(incoterms.code)),
      await tx
        .select({
          code: containerTypes.code,
          nameEn: containerTypes.nameEn,
          teu: containerTypes.teu,
        })
        .from(containerTypes)
        .orderBy(asc(containerTypes.code)),
      await tx
        .select({
          code: exceptionCodes.code,
          nameEn: exceptionCodes.nameEn,
          slaHours: exceptionCodes.slaHours,
        })
        .from(exceptionCodes)
        .orderBy(asc(exceptionCodes.code)),
      await tx
        .select({
          code: documentTypes.code,
          nameEn: documentTypes.nameEn,
          category: documentTypes.category,
        })
        .from(documentTypes)
        .orderBy(asc(documentTypes.code)),
      await tx
        .select({
          key: workingCalendars.key,
          nameEn: workingCalendars.nameEn,
          timeZone: workingCalendars.timeZone,
        })
        .from(workingCalendars)
        .orderBy(asc(workingCalendars.key)),
      await tx
        .select({ code: currencies.code, nameEn: currencies.nameEn })
        .from(currencies)
        .orderBy(asc(currencies.code)),
      await tx
        .select({ code: countries.code, nameEn: countries.nameEn })
        .from(countries)
        .orderBy(asc(countries.nameEn)),
      await tx.select({ count: sql<number>`count(*)::int` }).from(milestoneTemplates),
    ]

    return {
      incoterms: incotermRows,
      containers: containerRows,
      exceptions: exceptionRows,
      documents: documentRows,
      calendars: calendarRows,
      currencies: currencyRows,
      countries: countryRows,
      milestones: milestoneRows[0]?.count ?? 0,
    }
  })
}

// --- audit -----------------------------------------------------------------

export interface AuditRow {
  /** `bigint` in the schema — the audit table is append-only and long. */
  readonly id: bigint
  readonly at: Date
  readonly op: string
  readonly tableName: string
  readonly rowId: string
  readonly principalName: string | null
  readonly principalType: string | null
  readonly branchCode: string | null
  readonly ip: string | null
}

/**
 * The audit trail — `FR-AD-03`, §5.4.
 *
 * Written by a database trigger rather than by application code, which is the
 * only version worth having: a write that bypasses the application is still
 * recorded, and a developer cannot forget to log one.
 */
export async function listAudit(actor: Actor, table?: string): Promise<AuditRow[]> {
  return withActor(actor, async (tx) =>
    tx
      .select({
        id: auditLog.id,
        at: auditLog.at,
        op: auditLog.op,
        tableName: auditLog.tableName,
        rowId: auditLog.rowId,
        principalName: principals.nameEn,
        principalType: auditLog.principalType,
        branchCode: branches.code,
        ip: auditLog.ip,
      })
      .from(auditLog)
      .leftJoin(principals, eq(principals.id, auditLog.principalId))
      .leftJoin(branches, eq(branches.id, auditLog.branchId))
      .where(table ? eq(auditLog.tableName, table) : undefined)
      .orderBy(desc(auditLog.at))
      .limit(150),
  )
}

export async function auditTableCounts(
  actor: Actor,
): Promise<{ tableName: string; count: number }[]> {
  return withActor(actor, async (tx) =>
    tx
      .select({ tableName: auditLog.tableName, count: sql<number>`count(*)::int` })
      .from(auditLog)
      .groupBy(auditLog.tableName)
      .orderBy(desc(sql`count(*)`))
      .limit(12),
  )
}
