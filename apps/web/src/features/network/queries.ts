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
           where jp.partner_id = ${partners.id}
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
           where j.origin_id = ${locations.id} or j.destination_id = ${locations.id}
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
