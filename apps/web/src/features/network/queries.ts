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

export interface PartnerRow {
  readonly id: string
  readonly code: string
  readonly type: string
  readonly legalNameEn: string
  readonly legalNameAr: string | null
  readonly countryCode: string | null
  readonly currency: string | null
  readonly paymentTermsDays: number | null
  readonly isActive: boolean
  readonly openJobs: number
}

export async function listPartners(actor: Actor, search?: string): Promise<PartnerRow[]> {
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
  readonly isActive: boolean
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

export async function getPartnerDetail(
  actor: Actor,
  id: string,
): Promise<PartnerDetail | undefined> {
  return withActor(actor, async (tx) => {
    const result = await tx.execute(sql`
      select p.id, p.code, p.type::text as type,
             p.legal_name_en as "legalNameEn", p.legal_name_ar as "legalNameAr",
             p.country_code as "countryCode", p.currency,
             p.payment_terms_days as "paymentTermsDays", p.is_active as "isActive",
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
                        'role', jp.role, 'customerName', c.legal_name_en,
                        'lane', o.name_en || ' → ' || d.name_en, 'eta', j.eta)
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
