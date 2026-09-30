/**
 * The network — the parties and the places.
 *
 * Partners are who moves the cargo (carriers, agents, brokers, hauliers) and
 * locations are where it goes. Both are reference-shaped: long-lived, edited
 * rarely, read constantly. They live in one slice because a forwarder thinks
 * of them as one thing — the network — and neither is large enough to earn its
 * own.
 */

import { asc, eq, ilike, or, sql } from 'drizzle-orm'
import { locations, partners, withActor, type Actor } from '@qabandi/db'
import { named } from '@/lib/named'
import { usePilotFixtures } from '@/lib/pilot/source'
import { demoPartnerName } from '@/lib/pilot/demo'
import {
  pilotLocations,
  pilotNetworkCounts,
  pilotPartner,
  pilotPartnerCredentials,
  pilotPartnerTypeCounts,
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

export async function listPartners(actor: Actor, search?: string): Promise<PartnerRow[]> {
  // Search carried through, on the same two columns the `where` below matches.
  if (usePilotFixtures()) return pilotPartners(search)

  return withActor(actor, async (tx) => {
    const term = search?.trim()
    return tx
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
      .where(
        term
          ? or(ilike(partners.legalNameEn, `%${term}%`), ilike(partners.code, `%${term}%`))
          : undefined,
      )
      .orderBy(asc(partners.legalNameEn))
      .limit(200)
  })
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

export async function listLocations(actor: Actor, search?: string): Promise<LocationRow[]> {
  if (usePilotFixtures()) return pilotLocations(search)

  return withActor(actor, async (tx) => {
    const term = search?.trim()
    return tx
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
        useCount: sql<number>`(
          select count(*)::int from jobs j
           where j.origin_id = "locations"."id" or j.destination_id = "locations"."id"
        )`,
      })
      .from(locations)
      .where(
        term
          ? or(ilike(locations.nameEn, `%${term}%`), ilike(locations.unlocode, `%${term}%`))
          : undefined,
      )
      .orderBy(asc(locations.nameEn))
      .limit(300)
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
export async function partnerTypeCounts(actor: Actor): Promise<{ type: string; count: number }[]> {
  if (usePilotFixtures()) return pilotPartnerTypeCounts()

  return withActor(actor, async (tx) =>
    tx
      .select({ type: partners.type, count: sql<number>`count(*)::int` })
      .from(partners)
      .where(eq(partners.isActive, true))
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
                        'id', pc.id, 'nameEn', pc.name_en, 'email', pc.email,
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
