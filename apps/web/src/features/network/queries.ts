/**
 * The network — the parties and the places.
 *
 * Partners are who moves the cargo (carriers, agents, brokers, hauliers) and
 * locations are where it goes. Both are reference-shaped: long-lived, edited
 * rarely, read constantly. They live in one slice because a forwarder thinks
 * of them as one thing — the network — and neither is large enough to earn its
 * own.
 */

import { and, asc, eq, ilike, isNull, or, sql, type AnyColumn } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { jobMilestones, jobs, locations, partners, withActor, type Actor } from '@qabandi/db'
import type { Mode, PortalShipment } from '@/lib/pilot/types'
import { named } from '@/lib/named'
import { usePilotFixtures } from '@/lib/pilot/source'
import { countRows, pageOf, pageRequest, readPage, type Page, type PageRequest } from '@/lib/paging'
import { demoPartnerName } from '@/lib/pilot/demo'
import {
  pilotAgentShipments,
  pilotLocations,
  pilotNetworkCounts,
  pilotPartner,
  pilotPartnerCredentials,
  pilotPartners,
} from '@/lib/pilot/fixtures'

export interface PartnerRow {
  readonly id: string
  readonly code: string
  readonly type: string
  readonly legalNameEn: string
  readonly legalNameAr: string | null
  readonly countryCode: string | null
  readonly currency: string | null
  readonly paymentTermsDays: number | null
  /** The carrier code the tracking poll asks with — 0019. */
  readonly scac: string | null
  readonly isActive: boolean
  readonly openJobs: number
}

export interface PartnerFilters {
  readonly search?: string
  readonly type?: string
}

/** The fixture register, filtered as `partnersWhere` filters the table. */
function pilotPartnersMatching(filters: PartnerFilters): PartnerRow[] {
  const rows = pilotPartners(filters.search)
  return filters.type ? rows.filter((row) => row.type === filters.type) : rows
}

/** The register's filter as SQL, shared by the page, its total and the type counts. */
function partnersWhere(filters: PartnerFilters) {
  const term = filters.search?.trim()
  return and(
    term
      ? or(ilike(partners.legalNameEn, `%${term}%`), ilike(partners.code, `%${term}%`))
      : undefined,
    filters.type ? sql`${partners.type}::text = ${filters.type}` : undefined,
  )
}

/*
  The type filter is in the query now. It was applied to the page in memory —
  "the register is capped at 200 rows, and a second round trip costs more than
  the filter" — which was true until there were two hundred partners, after
  which a type filter could only find that type among the first two hundred by
  name, and "All" counted the page.
*/
export async function listPartners(
  actor: Actor,
  filters: PartnerFilters = {},
  request: PageRequest = pageRequest(undefined),
): Promise<Page<PartnerRow>> {
  // Search carried through, on the same two columns the `where` below matches.
  if (usePilotFixtures()) return pageOf(pilotPartnersMatching(filters), request)

  const where = partnersWhere(filters)
  return withActor(actor, (tx) =>
    readPage(
      request,
      (limit, offset) =>
        tx
          .select({
            id: partners.id,
            code: partners.code,
            type: partners.type,
            legalNameEn: partners.legalNameEn,
            legalNameAr: partners.legalNameAr,
            countryCode: partners.countryCode,
            currency: partners.currency,
            paymentTermsDays: partners.paymentTermsDays,
            scac: partners.scac,
            isActive: partners.isActive,
            openJobs: sql<number>`(
          select count(*)::int from job_partners jp
            join jobs j on j.id = jp.job_id
           where jp.partner_id = "partners"."id"
             and j.status not in ('closed', 'cancelled')
        )`,
          })
          .from(partners)
          .where(where)
          .orderBy(asc(partners.legalNameEn), asc(partners.id))
          .limit(limit)
          .offset(offset),
      () => countRows(tx, partners, where),
    ),
  )
}

export interface LocationRow {
  readonly id: string
  readonly unlocode: string | null
  readonly nameEn: string
  readonly nameAr: string | null
  readonly countryCode: string | null
  readonly kind: string
  readonly isActive: boolean
  readonly useCount: number
}

function locationsWhere(search?: string) {
  const term = search?.trim()
  return term
    ? or(ilike(locations.nameEn, `%${term}%`), ilike(locations.unlocode, `%${term}%`))
    : undefined
}

/** How often a place is used, either end of a lane. */
const locationUseCount = sql<number>`(
  select count(*)::int from jobs j
   where j.origin_id = "locations"."id" or j.destination_id = "locations"."id"
)`

/**
 * The locations register, a page at a time (it was `limit(300)` against a
 * UN/LOCODE list that runs to thousands once an administrator imports it).
 */
export async function listLocations(
  actor: Actor,
  search?: string,
  request: PageRequest = pageRequest(undefined),
): Promise<Page<LocationRow>> {
  if (usePilotFixtures()) return pageOf(pilotLocations(search), request)

  const where = locationsWhere(search)
  return withActor(actor, (tx) =>
    readPage(
      request,
      (limit, offset) =>
        tx
          .select({
            id: locations.id,
            unlocode: locations.unlocode,
            nameEn: locations.nameEn,
            nameAr: locations.nameAr,
            countryCode: locations.countryCode,
            kind: locations.kind,
            isActive: locations.isActive,
            // How often the place is actually used, either end of a lane. It is
            // the only column that tells you which of four hundred ports matter.
            useCount: locationUseCount,
          })
          .from(locations)
          .where(where)
          .orderBy(asc(locations.nameEn), asc(locations.id))
          .limit(limit)
          .offset(offset),
      () => countRows(tx, locations, where),
    ),
  )
}

/**
 * The locations register's two figures — every place the search matches, and
 * how many of them a shipment uses — counted rather than read off the page,
 * which made "in use" a count of the first three hundred names.
 */
export async function locationCounts(
  actor: Actor,
  search?: string,
): Promise<{ total: number; inUse: number }> {
  if (usePilotFixtures()) {
    const rows = pilotLocations(search)
    return { total: rows.length, inUse: rows.filter((row) => row.useCount > 0).length }
  }

  return withActor(actor, async (tx) => {
    const [row] = await tx
      .select({
        total: sql<number>`count(*)::int`,
        inUse: sql<number>`(count(*) filter (where ${locationUseCount} > 0))::int`,
      })
      .from(locations)
      .where(locationsWhere(search))
    return { total: row?.total ?? 0, inUse: row?.inUse ?? 0 }
  })
}

export async function countNetwork(actor: Actor): Promise<{ partners: number; locations: number }> {
  if (usePilotFixtures()) return pilotNetworkCounts()

  return withActor(actor, async (tx) => {
    const result = await tx.execute(sql`
      select (select count(*) from partners where is_active)::int  as partners,
             (select count(*) from locations where is_active)::int as locations
    `)
    const row = result.rows[0] as unknown as { partners: number; locations: number } | undefined
    return { partners: row?.partners ?? 0, locations: row?.locations ?? 0 }
  })
}

/** Partner types, for the filter strip. Derived so a new enum value shows up. */
/**
 * The partner register's type filter counts, over the same search the table
 * shows.
 *
 * Every partner, active or not, because the register lists both: these counted
 * active partners only while the list beside them held the inactive ones too,
 * so a tab's number and its rows disagreed whenever a partner was switched off.
 */
export async function partnerTypeCounts(
  actor: Actor,
  search?: string,
): Promise<{ type: string; count: number }[]> {
  if (usePilotFixtures()) {
    const counts = new Map<string, number>()
    for (const row of pilotPartners(search)) counts.set(row.type, (counts.get(row.type) ?? 0) + 1)
    return [...counts.entries()]
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => a.type.localeCompare(b.type))
  }

  return withActor(actor, async (tx) =>
    tx
      .select({ type: partners.type, count: sql<number>`count(*)::int` })
      .from(partners)
      .where(partnersWhere({ search }))
      .groupBy(partners.type)
      .orderBy(asc(partners.type)),
  )
}

/**
 * One partner, with everything the file shows.
 *
 * Contacts, the shipments they are on, and what they cost. The last of those
 * is the reason this page is worth having: a partner's value is not their
 * details, it is which lanes they carry and how often something goes wrong on
 * one — and neither is visible from the register.
 */
export interface PartnerDetail {
  readonly id: string
  readonly code: string
  readonly type: string
  readonly legalNameEn: string
  readonly legalNameAr: string | null
  readonly countryCode: string | null
  readonly currency: string | null
  readonly paymentTermsDays: number | null
  /** The carrier code the tracking poll asks with — 0019. */
  readonly scac: string | null
  readonly isActive: boolean
  /** How far this partner's bills may drift from the accrual — 0014. */
  readonly varianceTolerancePercent: string
  readonly varianceToleranceAbsolute: string
  /** The customer record they invoice us as, where a current account is run. */
  readonly settlementCustomerId: string | null
  readonly settlementCurrency: string | null
  readonly openJobs: number
  readonly totalJobs: number
  readonly openExceptions: number
  readonly contacts: readonly {
    id: string
    nameEn: string
    /** `partner_contacts.name_ar` — shown on an Arabic screen where set. */
    nameAr: string | null
    email: string | null
    phone: string | null
    role: string | null
  }[]
  readonly jobs: readonly {
    id: string
    reference: string
    status: string
    role: string
    customerName: string | null
    lane: string | null
    eta: Date | null
  }[]
}

/**
 * `locale` names the customers and ports on the partner's live shipments in
 * the reader's language (F27). The partner's own name arrives in both columns
 * because the edit dialog needs both.
 */
export async function getPartnerDetail(
  actor: Actor,
  id: string,
  locale: 'en' | 'ar' = 'en',
): Promise<PartnerDetail | undefined> {
  if (usePilotFixtures()) return pilotPartner(id, Date.now(), locale)

  const customerName = named(locale, sql`c.legal_name_en`, sql`c.legal_name_ar`)
  const originName = named(locale, sql`o.name_en`, sql`o.name_ar`)
  const destinationName = named(locale, sql`d.name_en`, sql`d.name_ar`)
  // An Arabic line runs right to left, so its arrow does too — as the margin
  // report and the quote comparison already draw it.
  const arrow = locale === 'ar' ? ' ← ' : ' → '
  return withActor(actor, async (tx) => {
    const result = await tx.execute(sql`
      select p.id, p.code, p.type::text as type,
             p.legal_name_en as "legalNameEn", p.legal_name_ar as "legalNameAr",
             p.country_code as "countryCode", p.currency,
             p.payment_terms_days as "paymentTermsDays", p.scac, p.is_active as "isActive",
             /* Payables configuration — 0014. See core/matching.ts. */
             p.variance_tolerance_percent::text  as "varianceTolerancePercent",
             p.variance_tolerance_absolute::text as "varianceToleranceAbsolute",
             p.settlement_customer_id as "settlementCustomerId",
             p.settlement_currency    as "settlementCurrency",
             (select count(*)::int from job_partners jp
                join jobs j on j.id = jp.job_id
               where jp.partner_id = p.id
                 and j.status not in ('closed', 'cancelled')) as "openJobs",
             (select count(*)::int from job_partners jp
               where jp.partner_id = p.id) as "totalJobs",
             /*
               Exceptions on shipments this partner is on. Not "their fault" —
               nothing here assigns blame — but it is the number that tells you
               which agent to have a conversation with.
             */
             (select count(*)::int from job_partners jp
                join exceptions e on e.job_id = jp.job_id
               where jp.partner_id = p.id and e.closed_at is null) as "openExceptions",
             coalesce((
               select json_agg(json_build_object(
                        'id', pc.id, 'nameEn', pc.name_en, 'nameAr', pc.name_ar, 'email', pc.email,
                        'phone', pc.phone, 'role', pc.role) order by pc.name_en)
                 from partner_contacts pc
                where pc.partner_id = p.id and pc.is_active), '[]'::json) as contacts,
             coalesce((
               select json_agg(json_build_object(
                        'id', j.id, 'reference', j.reference, 'status', j.status::text,
                        'role', jp.role, 'customerName', ${customerName},
                        'lane', ${originName} || ${arrow} || ${destinationName},
                        'eta', j.eta)
                      order by j.eta nulls last)
                 from job_partners jp
                 join jobs j on j.id = jp.job_id
                 left join customers c on c.id = j.customer_id
                 left join locations o on o.id = j.origin_id
                 left join locations d on d.id = j.destination_id
                where jp.partner_id = p.id
                  and j.status not in ('closed', 'cancelled')), '[]'::json) as jobs
        from partners p
       where p.id = ${id}
       limit 1
    `)
    return result.rows[0] as unknown as PartnerDetail | undefined
  })
}

/**
 * The agency an `agent_contact` is signed in as — the agent shell's header.
 *
 * One row, read through the actor like everything else: the `agent_contact`
 * arm of the `partners` policy (0004 §5.3) resolves to `id = app.partner_id()`,
 * so this cannot return anybody else's agency even if the id on the actor were
 * wrong. That is why it filters on the actor's `partnerId` and does not take
 * one as an argument.
 *
 * Null rather than a throw where the principal carries no partner: a header is
 * not worth failing a page over, and the shell simply omits the name.
 */
export async function agentPartnerName(actor: Actor, locale: 'en' | 'ar'): Promise<string | null> {
  if (!actor.partnerId) return null

  /*
    The fixtures have no partner register, and until the demo login landed no
    fixture actor carried a `partner_id` at all — so this went to `withActor`
    on a deployment with no database and took the whole agent shell down with
    it. The demo's agent persona is the one row there is to resolve.
  */
  if (usePilotFixtures()) return demoPartnerName(actor.partnerId, locale)

  return withActor(actor, async (tx) => {
    const [row] = await tx
      .select({ nameEn: partners.legalNameEn, nameAr: partners.legalNameAr })
      .from(partners)
      .where(eq(partners.id, actor.partnerId!))
      .limit(1)

    if (!row) return null
    // `||`: an empty Arabic name is as unset as a null one.
    return (locale === 'ar' ? row.nameAr : row.nameEn) || row.nameEn
  })
}

/**
 * The shipments an agent contact's partner is named on — FR-AG, A9.
 *
 * The agent home said "Nothing assigned to you" for everyone, because it read
 * nothing. There is no `where partner_id = ?` here, by the same design as the
 * customer portal: the `agent_contact` arm of the jobs policy matches only
 * jobs whose `job_partners` name `app.partner_id()`, so the scoping is the
 * database's and this is only the projection — no customer, no money, no
 * owner. Places and milestones in the reader's language.
 */
export async function listAgentShipments(
  actor: Actor,
  locale: 'en' | 'ar' = 'en',
  request: PageRequest = pageRequest(undefined),
): Promise<Page<PortalShipment>> {
  if (!actor.partnerId) return pageOf([], request)
  if (usePilotFixtures()) {
    return pageOf(pilotAgentShipments(actor.partnerId, Date.now(), locale), request)
  }

  const ar = locale === 'ar'
  const origin = alias(locations, 'origin')
  const destination = alias(locations, 'destination')
  const name = (en: AnyColumn, arabic: AnyColumn) =>
    ar ? sql<string | null>`coalesce(nullif(${arabic}, ''), ${en})` : sql<string | null>`${en}`

  const visible = and(isNull(jobs.cancelledAt), sql`${jobs.status} <> 'draft'`)
  // Paged with a count where this was `limit(50)`: an agent on a busy lane is
  // named on more than fifty shipments in a season.
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
            eta: jobs.eta,
            originName: name(origin.nameEn, origin.nameAr),
            destinationName: name(destination.nameEn, destination.nameAr),
            milestonesTotal: sql<number>`(
          select count(*)::int from ${jobMilestones}
           where ${jobMilestones.jobId} = "jobs"."id"
        )`,
            milestonesDone: sql<number>`(
          select count(*)::int from ${jobMilestones}
           where ${jobMilestones.jobId} = "jobs"."id"
             and ${jobMilestones.actualAt} is not null
        )`,
            nextMilestone: sql<string | null>`(
          select ${ar ? sql`coalesce(nullif(${jobMilestones.nameAr}, ''), ${jobMilestones.nameEn})` : jobMilestones.nameEn}
            from ${jobMilestones}
           where ${jobMilestones.jobId} = "jobs"."id"
             and ${jobMilestones.actualAt} is null
           order by ${jobMilestones.seq}
           limit 1
        )`,
          })
          .from(jobs)
          .leftJoin(origin, eq(origin.id, jobs.originId))
          .leftJoin(destination, eq(destination.id, jobs.destinationId))
          .where(visible)
          .orderBy(asc(jobs.eta), asc(jobs.id))
          .limit(limit)
          .offset(offset)

        return rows.map((row) => ({
          id: row.id,
          reference: row.reference,
          customerReference: null,
          status: row.status,
          mode: row.mode as Mode,
          originName: row.originName ?? '—',
          destinationName: row.destinationName ?? '—',
          eta: row.eta,
          milestonesTotal: row.milestonesTotal,
          milestonesDone: row.milestonesDone,
          documentsReleased: 0,
          nextMilestone: row.nextMilestone,
        }))
      },
      () => countRows(tx, jobs, visible),
    ),
  )
}

export interface PartnerCoverageRow {
  readonly id: string
  readonly mode: string
  readonly lane: string
  readonly transitDays: number | null
  readonly isActive: boolean
}

export interface PartnerComplianceRow {
  readonly id: string
  readonly documentType: string
  readonly reference: string | null
  readonly issuedOn: string | null
  readonly expiresOn: string | null
  readonly supersededById: string | null
  readonly daysRemaining: number | null
}

/**
 * The lanes a partner covers and the papers they hold — FR-RT-10, FR-MD-05.
 *
 * Both tables existed and neither was read by anything: RFQ routing was to be
 * driven by coverage, and a nightly job was to warn on compliance expiry. The
 * second is still in `PENDING`, and it would have swept an empty table until
 * this screen could fill it.
 *
 * Superseded certificates are returned, not filtered. A renewal points the old
 * row forward and the old row stays, because what proves an agent was insured
 * on the day a shipment moved is the certificate that was current *then*.
 */
export async function listPartnerCredentials(
  actor: Actor,
  partnerId: string,
  locale: 'en' | 'ar' = 'en',
): Promise<{ coverage: PartnerCoverageRow[]; compliance: PartnerComplianceRow[] }> {
  /*
    The `daysRemaining` normalisation below stays behind the branch on purpose.
    It exists because `expires_on - current_date` comes back from the driver as
    a string; the fixture builder computes the number itself, so running it
    over fixture rows would be arithmetic on a shape that never had the fault.
  */
  if (usePilotFixtures()) return pilotPartnerCredentials(partnerId, Date.now(), locale)

  // Ports and document types in the reader's language (F27).
  const originName = named(locale, sql`o.name_en`, sql`o.name_ar`)
  const destinationName = named(locale, sql`d.name_en`, sql`d.name_ar`)
  const documentType = named(locale, sql`dt.name_en`, sql`dt.name_ar`)
  const arrow = locale === 'ar' ? ' ← ' : ' → '
  return withActor(actor, async (tx) => {
    const coverage = await tx.execute(sql`
      select c.id, c.mode::text as mode, c.transit_days as "transitDays",
             c.is_active as "isActive",
             coalesce(${originName}, c.origin_country, '—') || ${arrow} ||
             coalesce(${destinationName}, c.destination_country, '—') as lane
        from partner_coverage c
        left join locations o on o.id = c.origin_id
        left join locations d on d.id = c.destination_id
       where c.partner_id = ${partnerId}
       order by c.mode, lane
    `)

    const compliance = await tx.execute(sql`
      select pc.id, ${documentType} as "documentType", pc.reference,
             pc.issued_on::text as "issuedOn", pc.expires_on::text as "expiresOn",
             pc.superseded_by_id as "supersededById",
             case when pc.expires_on is null then null
                  else (pc.expires_on - current_date) end as "daysRemaining"
        from partner_compliance pc
        join document_types dt on dt.id = pc.document_type_id
       where pc.partner_id = ${partnerId}
       -- Live ones first, then the superseded, each by how long is left.
       order by (pc.superseded_by_id is not null), pc.expires_on nulls last
    `)

    return {
      coverage: coverage.rows as unknown as PartnerCoverageRow[],
      compliance: (compliance.rows as unknown as PartnerComplianceRow[]).map((row) => ({
        ...row,
        daysRemaining: row.daysRemaining === null ? null : Number(row.daysRemaining),
      })),
    }
  })
}
