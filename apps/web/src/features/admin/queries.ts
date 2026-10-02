/**
 * Administration reads — people, branches, reference tables, the audit trail.
 *
 * These are the screens that answer "who can do what, and who did what".
 *
 * User *creation* is still `pnpm db:create-user` — FR-ID-07 makes the product
 * invitation-only, and the first account necessarily precedes any account that
 * could authorise it.
 *
 * The reference tables are no longer among the read-only ones. This file used
 * to say they were "edited through migrations rather than through a form
 * nobody audits", which described the state of the build rather than a
 * decision: FR-AD-03 and `CLAUDE.md` both say charge types, milestone
 * templates, exception codes, document types and calendars are rows an
 * administrator edits without a release, and the forms that do it are in
 * `reference-actions.ts`. The audit concern was always answered — every write
 * here goes through `withActor`, and the trigger records it.
 */

import { and, asc, desc, eq, gte, ilike, lt, notInArray, or, sql } from 'drizzle-orm'
import {
  auditLog,
  branches,
  chargeTypes,
  containerTypes,
  countries,
  currencies,
  documentTypes,
  dutyRates,
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
import { usePilotFixtures } from '@/lib/pilot/source'
import { named } from '@/lib/named'
import type { FxRateRow } from '@/lib/pilot/types'
import {
  pilotAudit,
  pilotAuditTableCounts,
  pilotBranches,
  pilotCalendarOptions,
  pilotCalendars,
  pilotChargeTypes,
  pilotDutyRates,
  pilotEngineRules,
  pilotFxRates,
  pilotMilestoneTemplates,
  pilotReferenceCounts,
  pilotReferenceSample,
  pilotRoles,
  pilotUsers,
} from '@/lib/pilot/fixtures'

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
  /**
   * Whether the login has a password yet — A7.
   *
   * An invitation creates the login and mails a link; the credential exists
   * only once the person has followed it. Until then the register says so and
   * offers to send the link again, instead of a tick that implied they could
   * already sign in.
   */
  readonly hasPassword: boolean
  /** `KWI: Operations Manager`, one per branch — FR-ID-02. */
  readonly assignments: { branchCode: string; roleKey: string; requiresTwoFactor: boolean }[]
}

export async function listUsers(actor: Actor): Promise<UserRow[]> {
  if (usePilotFixtures()) return pilotUsers()

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
        // `auth_account` sits outside RLS with the other `auth_*` tables, and
        // only the existence of a credential leaves this query — never a hash.
        hasPassword: sql<boolean>`exists (
          select 1 from auth_account a
           where a.user_id = "principals"."auth_user_id" and a.provider_id = 'credential'
        )`,
      })
      .from(principals)
      // Staff only. Portal and agent logins became readable to staff (A7) so
      // the customer page can show who has access; they are managed there,
      // per company, and listing them here would bury the staff register.
      .where(notInArray(principals.type, ['customer_contact', 'agent_contact']))
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

export interface PortalContactRow {
  readonly id: string
  readonly nameEn: string
  readonly nameAr: string | null
  readonly email: string
  readonly isActive: boolean
  readonly hasPassword: boolean
  readonly lastSeenAt: Date | null
}

/** The portal logins one customer has. */
export async function listPortalContacts(
  actor: Actor,
  customerId: string,
): Promise<PortalContactRow[]> {
  // The hosted demo's portal persona is not a row; the card offers the invite
  // and lists nobody, which is the honest picture of a fixture deployment.
  if (usePilotFixtures()) return []

  return withActor(actor, (tx) =>
    tx
      .select({
        id: principals.id,
        nameEn: principals.nameEn,
        nameAr: principals.nameAr,
        email: principals.email,
        isActive: principals.isActive,
        lastSeenAt: principals.lastSeenAt,
        hasPassword: sql<boolean>`exists (
          select 1 from auth_account a
           where a.user_id = "principals"."auth_user_id" and a.provider_id = 'credential'
        )`,
      })
      .from(principals)
      .where(and(eq(principals.type, 'customer_contact'), eq(principals.customerId, customerId)))
      .orderBy(asc(principals.nameEn)),
  )
}

/** The permission matrix as the interface renders it — role by permission. */
export async function listRoles(
  actor: Actor,
): Promise<
  { key: string; nameEn: string; nameAr: string; requiresTwoFactor: boolean; permissions: number }[]
> {
  if (usePilotFixtures()) return pilotRoles()

  return withActor(actor, async (tx) =>
    tx
      .select({
        key: roles.key,
        nameEn: roles.nameEn,
        nameAr: roles.nameAr,
        requiresTwoFactor: roles.requiresTwoFactor,
        permissions: sql<number>`(
          select count(*)::int from role_permissions rp
           where rp.role_id = "roles"."id" and rp.allowed
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
  readonly mailFrom: string | null
  readonly quietHoursEnabled: boolean
  readonly quietHoursFromHour: number
  readonly quietHoursToHour: number
  readonly invoiceSeries: string | null
  readonly invoiceSeriesNext: number
  readonly taxRegistration: string | null
  readonly houseBillSeries: string | null
  readonly arAccountCode: string | null
  readonly apAccountCode: string | null
  readonly taxAccountCode: string | null
  readonly bankAccountCode: string | null
  readonly fxVarianceAccountCode: string | null
  readonly roundingAccountCode: string | null
  readonly tradingConditionsEn: string | null
  readonly tradingConditionsAr: string | null
  readonly billOfLadingTermsEn: string | null
  readonly billOfLadingTermsAr: string | null
  readonly defaultExclusionsEn: string | null
  readonly defaultExclusionsAr: string | null
  readonly isActive: boolean
  readonly calendarId: string
  readonly calendarName: string | null
  readonly calendarNameAr: string | null
  readonly people: number
  readonly openJobs: number
}

export async function listBranches(actor: Actor): Promise<BranchRow[]> {
  if (usePilotFixtures()) return pilotBranches()

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
        mailFrom: branches.mailFrom,
        quietHoursEnabled: branches.quietHoursEnabled,
        quietHoursFromHour: branches.quietHoursFromHour,
        quietHoursToHour: branches.quietHoursToHour,
        invoiceSeries: branches.invoiceSeries,
        invoiceSeriesNext: branches.invoiceSeriesNext,
        taxRegistration: branches.taxRegistration,
        houseBillSeries: branches.houseBillSeries,
        arAccountCode: branches.arAccountCode,
        apAccountCode: branches.apAccountCode,
        taxAccountCode: branches.taxAccountCode,
        bankAccountCode: branches.bankAccountCode,
        fxVarianceAccountCode: branches.fxVarianceAccountCode,
        roundingAccountCode: branches.roundingAccountCode,
        tradingConditionsEn: branches.tradingConditionsEn,
        tradingConditionsAr: branches.tradingConditionsAr,
        billOfLadingTermsEn: branches.billOfLadingTermsEn,
        billOfLadingTermsAr: branches.billOfLadingTermsAr,
        defaultExclusionsEn: branches.defaultExclusionsEn,
        defaultExclusionsAr: branches.defaultExclusionsAr,
        isActive: branches.isActive,
        calendarId: branches.calendarId,
        calendarName: workingCalendars.nameEn,
        calendarNameAr: workingCalendars.nameAr,
        people: sql<number>`(
          select count(*)::int from principal_branch_roles pbr
           where pbr.branch_id = "branches"."id"
        )`,
        openJobs: sql<number>`(
          select count(*)::int from jobs j
           where j.branch_id = "branches"."id"
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
  if (usePilotFixtures()) return pilotReferenceCounts()

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

export async function listChargeTypes(actor: Actor): Promise<
  {
    id: string
    key: string
    nameEn: string
    nameAr: string
    category: string
    basis: string
    revenueAccountCode: string | null
    costAccountCode: string | null
  }[]
> {
  if (usePilotFixtures()) return pilotChargeTypes()

  return withActor(actor, async (tx) =>
    tx
      .select({
        id: chargeTypes.id,
        key: chargeTypes.key,
        nameEn: chargeTypes.nameEn,
        nameAr: chargeTypes.nameAr,
        category: chargeTypes.category,
        basis: chargeTypes.defaultBasis,
        /*
          Carried so the reference screen can show which charges are still
          unmapped — that list is the difference between an accounting export
          that runs and one that refuses, and burying it inside the export's
          error message means finding it twelve times instead of once.
        */
        revenueAccountCode: chargeTypes.revenueAccountCode,
        costAccountCode: chargeTypes.costAccountCode,
      })
      .from(chargeTypes)
      .orderBy(asc(chargeTypes.sortOrder)),
  )
}

/**
 * The catalogues the reference screen lists, each row named in the reader's
 * language (F27) — `name` is Arabic where the row has it and English where it
 * is blank, so an Arabic screen stops listing "Ex Works" under Arabic headings.
 */
export async function listReferenceSample(
  actor: Actor,
  locale: 'en' | 'ar' = 'en',
): Promise<{
  incoterms: { code: string; name: string }[]
  containers: { code: string; name: string; teu: string | null }[]
  exceptions: { code: string; name: string; slaHours: number | null }[]
  documents: { code: string; name: string; category: string }[]
  calendars: { key: string; name: string; timeZone: string }[]
  currencies: { code: string; name: string | null }[]
  countries: { code: string; name: string }[]
  milestones: number
}> {
  if (usePilotFixtures()) return pilotReferenceSample(locale)

  const countryName = named(locale, countries.nameEn, countries.nameAr)

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
        .select({ code: incoterms.code, name: named(locale, incoterms.nameEn, incoterms.nameAr) })
        .from(incoterms)
        .orderBy(asc(incoterms.code)),
      await tx
        .select({
          code: containerTypes.code,
          name: named(locale, containerTypes.nameEn, containerTypes.nameAr),
          teu: containerTypes.teu,
        })
        .from(containerTypes)
        .orderBy(asc(containerTypes.code)),
      await tx
        .select({
          code: exceptionCodes.code,
          name: named(locale, exceptionCodes.nameEn, exceptionCodes.nameAr),
          slaHours: exceptionCodes.slaHours,
        })
        .from(exceptionCodes)
        .orderBy(asc(exceptionCodes.code)),
      await tx
        .select({
          code: documentTypes.code,
          name: named(locale, documentTypes.nameEn, documentTypes.nameAr),
          category: documentTypes.category,
        })
        .from(documentTypes)
        .orderBy(asc(documentTypes.code)),
      await tx
        .select({
          key: workingCalendars.key,
          name: named(locale, workingCalendars.nameEn, workingCalendars.nameAr),
          timeZone: workingCalendars.timeZone,
        })
        .from(workingCalendars)
        .orderBy(asc(workingCalendars.key)),
      await tx
        .select({
          code: currencies.code,
          name: named(locale, currencies.nameEn, currencies.nameAr),
        })
        .from(currencies)
        .orderBy(asc(currencies.code)),
      await tx
        .select({ code: countries.code, name: countryName })
        .from(countries)
        .orderBy(asc(countryName)),
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
  /*
    The Arabic name is selected because the search already matches it.

    `q` tests `nameEn` *and* `nameAr`, so a reader searching an Arabic name got
    back rows whose principal column then showed the English one — a result set
    that looks unrelated to what was typed. Carrying both lets the screen show
    the name in the reader's own language and the export carry both, which is
    the rule this product states everywhere else.
  */
  readonly principalNameAr: string | null
  readonly principalType: string | null
  readonly branchCode: string | null
  readonly ip: string | null
}

/**
 * What a reader is allowed to narrow the audit trail by — `FR-AD-02`.
 *
 * Every field is optional and they compose with `and`, so the filters read the
 * way somebody investigating actually thinks: this table, that person, last
 * week. `q` is the free-text half and deliberately searches the columns a
 * question arrives phrased in — a job reference somebody was handed, the name
 * of the person they are asking about, an address from a security alert —
 * rather than offering four boxes for a reader who does not yet know which one
 * holds their answer.
 */
export interface AuditFilters {
  readonly table?: string
  readonly op?: string
  /** Matched against the record id, the principal's name and the address. */
  readonly q?: string
  /** `YYYY-MM-DD`, inclusive. */
  readonly from?: string
  /** `YYYY-MM-DD`, inclusive — the whole of that day, not midnight. */
  readonly to?: string
  readonly limit?: number
}

/**
 * The audit trail — `FR-AD-03`, §5.4.
 *
 * Written by a database trigger rather than by application code, which is the
 * only version worth having: a write that bypasses the application is still
 * recorded, and a developer cannot forget to log one.
 */
export async function listAudit(actor: Actor, filters: AuditFilters = {}): Promise<AuditRow[]> {
  const limit = filters.limit ?? 150
  if (usePilotFixtures()) return pilotAudit(Date.now(), filters)

  /*
    `to` is exclusive of the day *after* rather than inclusive of `to`.

    `at` is a timestamp, so `at <= '2026-08-25'` compares against midnight and
    silently drops everything that happened during the day the reader asked
    for — which on the audit trail means an investigation concludes the action
    never happened. Adding a day and using `<` keeps the whole of the closing
    day without needing the column truncated, so the index still applies.
  */
  const dayAfter = (date: string) => {
    const next = new Date(`${date}T00:00:00Z`)
    next.setUTCDate(next.getUTCDate() + 1)
    return next
  }

  const term = filters.q?.trim()
  const conditions = [
    filters.table ? eq(auditLog.tableName, filters.table) : undefined,
    filters.op ? eq(auditLog.op, filters.op) : undefined,
    filters.from ? gte(auditLog.at, new Date(`${filters.from}T00:00:00Z`)) : undefined,
    filters.to ? lt(auditLog.at, dayAfter(filters.to)) : undefined,
    term
      ? or(
          ilike(auditLog.rowId, `%${term}%`),
          ilike(principals.nameEn, `%${term}%`),
          ilike(principals.nameAr, `%${term}%`),
          sql`${auditLog.ip}::text ilike ${`%${term}%`}`,
        )
      : undefined,
  ].filter(Boolean)

  return withActor(actor, async (tx) =>
    tx
      .select({
        id: auditLog.id,
        at: auditLog.at,
        op: auditLog.op,
        tableName: auditLog.tableName,
        rowId: auditLog.rowId,
        principalName: principals.nameEn,
        principalNameAr: principals.nameAr,
        principalType: auditLog.principalType,
        branchCode: branches.code,
        ip: auditLog.ip,
      })
      .from(auditLog)
      .leftJoin(principals, eq(principals.id, auditLog.principalId))
      .leftJoin(branches, eq(branches.id, auditLog.branchId))
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(auditLog.at))
      .limit(limit),
  )
}

export async function auditTableCounts(
  actor: Actor,
): Promise<{ tableName: string; count: number }[]> {
  if (usePilotFixtures()) return pilotAuditTableCounts()

  return withActor(actor, async (tx) =>
    tx
      .select({ tableName: auditLog.tableName, count: sql<number>`count(*)::int` })
      .from(auditLog)
      .groupBy(auditLog.tableName)
      .orderBy(desc(sql`count(*)`))
      .limit(12),
  )
}

/**
 * The working calendars a branch can be attached to.
 *
 * Its own query rather than part of `loadOptions`, because it is needed by
 * exactly one form and every page that called `loadOptions` would otherwise
 * pay for the join.
 *
 * Labelled in the reader's language, and sorted by the label shown — an Arabic
 * list in English alphabetical order reads as unsorted.
 */
export async function listCalendarOptions(
  actor: Actor,
  locale: 'en' | 'ar' = 'en',
): Promise<{ value: string; label: string }[]> {
  if (usePilotFixtures()) return pilotCalendarOptions(locale)

  return withActor(actor, async (tx) => {
    const rows = await tx
      .select({
        id: workingCalendars.id,
        nameEn: workingCalendars.nameEn,
        nameAr: workingCalendars.nameAr,
      })
      .from(workingCalendars)
      .where(eq(workingCalendars.isActive, true))
    return rows
      .map((row) => ({ value: row.id, label: (locale === 'ar' && row.nameAr) || row.nameEn }))
      .sort((a, b) => a.label.localeCompare(b.label, locale))
  })
}

/* ------------------------------------------ the configuration engines read */

export interface MilestoneTemplateRow {
  readonly id: string
  readonly mode: string
  readonly direction: string
  readonly seq: number
  readonly code: string
  readonly nameEn: string
  readonly nameAr: string
  readonly ownerRole: string | null
  readonly plannedOffsetDays: number | null
  readonly customerVisible: boolean
  readonly isActive: boolean
}

/** The plan a job of each shape is booked with — FR-JB-02. */
export async function listMilestoneTemplates(actor: Actor): Promise<MilestoneTemplateRow[]> {
  if (usePilotFixtures()) return pilotMilestoneTemplates()

  return withActor(actor, (tx) =>
    tx
      .select({
        id: milestoneTemplates.id,
        mode: milestoneTemplates.mode,
        direction: milestoneTemplates.direction,
        seq: milestoneTemplates.seq,
        code: milestoneTemplates.code,
        nameEn: milestoneTemplates.nameEn,
        nameAr: milestoneTemplates.nameAr,
        ownerRole: milestoneTemplates.ownerRole,
        plannedOffsetDays: milestoneTemplates.plannedOffsetDays,
        customerVisible: milestoneTemplates.customerVisible,
        isActive: milestoneTemplates.isActive,
      })
      .from(milestoneTemplates)
      .orderBy(
        asc(milestoneTemplates.mode),
        asc(milestoneTemplates.direction),
        asc(milestoneTemplates.seq),
      ),
  )
}

export interface CalendarRow {
  readonly id: string
  readonly key: string
  readonly nameEn: string
  readonly nameAr: string
  readonly timeZone: string
  readonly weekend: number[]
  readonly dayStartMinute: number
  readonly dayEndMinute: number
  readonly isActive: boolean
  readonly holidays: number
}

/** Working weeks, with how many closures each one carries — NFR-03. */
export async function listCalendars(actor: Actor): Promise<CalendarRow[]> {
  if (usePilotFixtures()) return pilotCalendars()

  return withActor(actor, (tx) =>
    tx
      .select({
        id: workingCalendars.id,
        key: workingCalendars.key,
        nameEn: workingCalendars.nameEn,
        nameAr: workingCalendars.nameAr,
        timeZone: workingCalendars.timeZone,
        weekend: workingCalendars.weekend,
        dayStartMinute: workingCalendars.dayStartMinute,
        dayEndMinute: workingCalendars.dayEndMinute,
        isActive: workingCalendars.isActive,
        holidays: sql<number>`(
          select count(*) from calendar_holidays h
           where h.calendar_id = "working_calendars"."id"
        )::int`,
      })
      .from(workingCalendars)
      .orderBy(asc(workingCalendars.key)),
  )
}

export interface DutyRateRow {
  readonly id: string
  readonly country: string
  readonly hsPrefix: string
  readonly ratePercent: string
  readonly descriptionEn: string
  readonly descriptionAr: string | null
  readonly effectiveFrom: string
  readonly effectiveTo: string | null
  readonly notes: string | null
  readonly isActive: boolean
}

/**
 * The tariff, longest prefix first.
 *
 * The order the engine matches in, so the screen reads the way `findRate`
 * decides: an operator looking for "which line will catch 8703.23" scans down
 * and stops at the first one it starts with.
 */
export async function listDutyRates(actor: Actor): Promise<DutyRateRow[]> {
  if (usePilotFixtures()) return pilotDutyRates()

  return withActor(actor, (tx) =>
    tx
      .select({
        id: dutyRates.id,
        country: dutyRates.country,
        hsPrefix: dutyRates.hsPrefix,
        ratePercent: dutyRates.ratePercent,
        descriptionEn: dutyRates.descriptionEn,
        descriptionAr: dutyRates.descriptionAr,
        effectiveFrom: dutyRates.effectiveFrom,
        effectiveTo: dutyRates.effectiveTo,
        notes: dutyRates.notes,
        isActive: dutyRates.isActive,
      })
      .from(dutyRates)
      .orderBy(
        asc(dutyRates.country),
        sql`length(${dutyRates.hsPrefix}) desc`,
        asc(dutyRates.hsPrefix),
        desc(dutyRates.effectiveFrom),
      )
      .limit(500),
  )
}

/**
 * The newest rate for each currency pair, whatever its source — S12.
 *
 * What pricing would convert at today: it takes the newest rate on or before
 * the pricing date, so the newest row per pair is the one that matters. Older
 * days stay on the table and in the audit log; they are history, not choices.
 */
export async function listFxRates(actor: Actor): Promise<FxRateRow[]> {
  if (usePilotFixtures()) return pilotFxRates()

  return withActor(actor, async (tx) => {
    const result = await tx.execute(sql`
      select distinct on (from_currency, to_currency)
             from_currency as "fromCurrency", to_currency as "toCurrency",
             rate::text as rate, effective_on::text as "effectiveOn", source
        from fx_rates
       where effective_on <= current_date
       order by from_currency, to_currency, effective_on desc, taken_at desc
       limit 200
    `)
    return result.rows as unknown as FxRateRow[]
  })
}

/**
 * A rule as data. The page words it — mode, scope and terms in the reader's
 * language — so this carries no sentence of its own; it used to, in English.
 */
export interface EngineRuleRow {
  readonly id: string
  readonly isActive: boolean
  /** The row itself, so the edit dialog can pre-fill without a second read. */
  readonly raw: Record<string, unknown>
}

/**
 * The two rules tables the engines measure with, in one shape.
 *
 * `chargeable_rules` and `free_time_rules` are read by `packages/db` and by
 * nothing in this application — correct, and the reason neither had a screen:
 * the divisor a shipment is billed on and the days before demurrage starts
 * were configuration with no way to configure them. Presented together because
 * an operator thinks of them together: what does this mode weigh, and how long
 * do we get before it costs.
 */
export async function listEngineRules(actor: Actor): Promise<{
  chargeable: EngineRuleRow[]
  freeTime: EngineRuleRow[]
}> {
  if (usePilotFixtures()) return pilotEngineRules()

  return withActor(actor, async (tx) => {
    const chargeable = await tx.execute(sql`
      select r.id, r.mode::text as mode, r.branch_id as "branchId", b.code as "branchCode",
             r.divisor_cm3_per_kg::text as "divisorCm3PerKg",
             r.round_up_to_kg::text as "roundUpToKg", r.minimum_kg::text as "minimumKg",
             r.is_active as "isActive"
        from chargeable_rules r
        left join branches b on b.id = r.branch_id
       order by r.mode, r.branch_id nulls first
    `)

    const freeTime = await tx.execute(sql`
      select r.id, r.kind::text as kind, r.branch_id as "branchId", b.code as "branchCode",
             r.mode::text as mode, r.container_type as "containerType",
             r.free_days as "freeDays", r.per_diem::text as "perDiem", r.currency,
             r.day_basis::text as "dayBasis", r.is_active as "isActive"
        from free_time_rules r
        left join branches b on b.id = r.branch_id
       order by r.kind, r.branch_id nulls first, r.mode nulls first
    `)

    return {
      chargeable: (chargeable.rows as Record<string, unknown>[]).map((row) => ({
        id: row.id as string,
        isActive: row.isActive as boolean,
        raw: row,
      })),
      freeTime: (freeTime.rows as Record<string, unknown>[]).map((row) => ({
        id: row.id as string,
        isActive: row.isActive as boolean,
        raw: row,
      })),
    }
  })
}
