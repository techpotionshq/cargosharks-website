/**
 * Consolidation reads — the master list and one master's file.
 *
 * As everywhere else, no query here carries a branch filter: `withActor` sets
 * the principal and RLS applies the scope (§5.3). A consolidation is
 * internal-only by policy, because the house list names which other customers
 * shipped on the same vessel.
 *
 * Both the register and the file read from fixtures when there is no database.
 * The file's totals are *reduced* from its houses and charges in one place
 * below rather than stated by either path — the register's house count and the
 * master file's house list are the same fact, and a demo where they differ is
 * the one thing on the screen that could not be true.
 */

import 'server-only'
import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import {
  chargeTypes,
  consolAllocationShares,
  consolChargeLines,
  consolidations,
  consolidationStatusEnum,
  customers,
  jobs,
  locations,
  partners,
  type Actor,
  withActor,
} from '@qabandi/db'
import { enumFilter } from '@/lib/filters'
import { named } from '@/lib/named'
import { usePilotFixtures } from '@/lib/pilot/source'
import {
  pilotAllocationShares,
  pilotAttachableJobs,
  pilotConsolidation,
  pilotConsolidations,
} from '@/lib/pilot/fixtures'

const origin = alias(locations, 'consol_origin')
const destination = alias(locations, 'consol_destination')

export interface ConsolidationSummary {
  readonly id: string
  readonly reference: string
  readonly status: 'open' | 'closed' | 'cancelled'
  readonly mode: string
  readonly tradeDirection: string
  readonly masterBillNumber: string | null
  readonly vesselName: string | null
  readonly voyageNumber: string | null
  readonly flightNumber: string | null
  readonly originName: string | null
  readonly destinationName: string | null
  readonly etd: Date | null
  readonly eta: Date | null
  readonly houseCount: number
  readonly volumeCbm: string
  readonly grossWeightKg: string
  /** Master costs raised but not yet split across the houses. */
  readonly unallocatedCount: number
}

/** `locale` names the ports in the reader's language (F27). */
export async function listConsolidations(
  actor: Actor,
  filters: { readonly status?: string } = {},
  locale: 'en' | 'ar' = 'en',
): Promise<ConsolidationSummary[]> {
  // Narrowed before the fixtures branch so both modes answer an unknown filter
  // the same way — see `lib/filters.ts`.
  const status = enumFilter(consolidationStatusEnum.enumValues, filters.status)

  if (usePilotFixtures()) return pilotConsolidations(Date.now(), { status }, locale)

  return withActor(actor, async (tx) => {
    const rows = await tx
      .select({
        id: consolidations.id,
        reference: consolidations.reference,
        status: consolidations.status,
        mode: consolidations.mode,
        tradeDirection: consolidations.tradeDirection,
        masterBillNumber: consolidations.masterBillNumber,
        vesselName: consolidations.vesselName,
        voyageNumber: consolidations.voyageNumber,
        flightNumber: consolidations.flightNumber,
        originName: named(locale, origin.nameEn, origin.nameAr),
        destinationName: named(locale, destination.nameEn, destination.nameAr),
        etd: consolidations.etd,
        eta: consolidations.eta,
        /*
          Counted in SQL rather than by loading the houses.

          A list of thirty consolidations would otherwise be thirty-one
          queries, and the count is the only thing the row needs.
        */
        houseCount: sql<number>`(
          select count(*)::int from jobs j where j.consolidation_id = "consolidations"."id"
        )`,
        volumeCbm: sql<string>`(
          select coalesce(sum(c.volume_cbm), 0)::text
            from job_cargo c
            join jobs j on j.id = c.job_id
           where j.consolidation_id = "consolidations"."id"
        )`,
        grossWeightKg: sql<string>`(
          select coalesce(sum(c.gross_weight_kg), 0)::text
            from job_cargo c
            join jobs j on j.id = c.job_id
           where j.consolidation_id = "consolidations"."id"
        )`,
        unallocatedCount: sql<number>`(
          select count(*)::int from consol_charge_lines l
           where l.consolidation_id = "consolidations"."id" and l.allocated_at is null
        )`,
      })
      .from(consolidations)
      .leftJoin(origin, eq(origin.id, consolidations.originId))
      .leftJoin(destination, eq(destination.id, consolidations.destinationId))
      .where(
        status ? eq(consolidations.status, status) : sql`${consolidations.status} <> 'cancelled'`,
      )
      .orderBy(desc(consolidations.etd), desc(consolidations.createdAt))
      .limit(200)

    return rows as ConsolidationSummary[]
  })
}

export interface ConsolidationHouse {
  readonly jobId: string
  readonly reference: string
  readonly houseBillNumber: string | null
  readonly customerName: string
  readonly status: string
  readonly packages: number
  readonly grossWeightKg: string
  readonly volumeCbm: string
  readonly chargeableWeightKg: string | null
}

export interface ConsolidationCharge {
  readonly id: string
  readonly direction: 'cost' | 'revenue'
  readonly chargeTypeName: string
  readonly description: string | null
  readonly amount: string
  readonly currency: string
  readonly amountBase: string
  readonly baseCurrency: string
  readonly allocationBasis: string
  readonly allocatedAt: Date | null
  readonly counterpartyName: string | null
  readonly shareCount: number
}

export interface ConsolidationDetail extends ConsolidationSummary {
  readonly branchId: string
  readonly carrierName: string | null
  readonly coloadPartnerName: string | null
  readonly bookingNumber: string | null
  readonly notes: string | null
  readonly closedAt: Date | null
  readonly houses: readonly ConsolidationHouse[]
  readonly charges: readonly ConsolidationCharge[]
}

/** `locale` names ports, parties, customers and charges in the reader's language (F27). */
export async function getConsolidation(
  actor: Actor,
  id: string,
  locale: 'en' | 'ar' = 'en',
): Promise<ConsolidationDetail | undefined> {
  if (usePilotFixtures()) {
    const rows = pilotConsolidation(id, Date.now(), locale)
    return rows === undefined ? undefined : consolidationOf(rows.row, rows.houses, rows.charges)
  }

  return withActor(actor, async (tx) => {
    const carrier = alias(partners, 'carrier')
    const coload = alias(partners, 'coload')

    const [row] = await tx
      .select({
        id: consolidations.id,
        branchId: consolidations.branchId,
        reference: consolidations.reference,
        status: consolidations.status,
        mode: consolidations.mode,
        tradeDirection: consolidations.tradeDirection,
        masterBillNumber: consolidations.masterBillNumber,
        bookingNumber: consolidations.bookingNumber,
        vesselName: consolidations.vesselName,
        voyageNumber: consolidations.voyageNumber,
        flightNumber: consolidations.flightNumber,
        originName: named(locale, origin.nameEn, origin.nameAr),
        destinationName: named(locale, destination.nameEn, destination.nameAr),
        etd: consolidations.etd,
        eta: consolidations.eta,
        closedAt: consolidations.closedAt,
        notes: consolidations.notes,
        carrierName: named(locale, carrier.legalNameEn, carrier.legalNameAr),
        coloadPartnerName: named(locale, coload.legalNameEn, coload.legalNameAr),
      })
      .from(consolidations)
      .leftJoin(origin, eq(origin.id, consolidations.originId))
      .leftJoin(destination, eq(destination.id, consolidations.destinationId))
      .leftJoin(carrier, eq(carrier.id, consolidations.carrierPartnerId))
      .leftJoin(coload, eq(coload.id, consolidations.coloadPartnerId))
      .where(eq(consolidations.id, id))
      .limit(1)

    if (!row) return undefined

    const houses = await tx
      .select({
        jobId: jobs.id,
        reference: jobs.reference,
        houseBillNumber: jobs.houseBillNumber,
        customerName: named(locale, customers.legalNameEn, customers.legalNameAr),
        status: jobs.status,
        chargeableWeightKg: jobs.chargeableWeightKg,
        packages: sql<number>`(
          select coalesce(sum(c.package_count), 0)::int
            from job_cargo c where c.job_id = "jobs"."id"
        )`,
        grossWeightKg: sql<string>`(
          select coalesce(sum(c.gross_weight_kg), 0)::text
            from job_cargo c where c.job_id = "jobs"."id"
        )`,
        volumeCbm: sql<string>`(
          select coalesce(sum(c.volume_cbm), 0)::text
            from job_cargo c where c.job_id = "jobs"."id"
        )`,
      })
      .from(jobs)
      .innerJoin(customers, eq(customers.id, jobs.customerId))
      .where(eq(jobs.consolidationId, id))
      .orderBy(asc(jobs.reference))

    const charges = await tx
      .select({
        id: consolChargeLines.id,
        direction: consolChargeLines.direction,
        chargeTypeName: named(locale, chargeTypes.nameEn, chargeTypes.nameAr),
        description: consolChargeLines.description,
        amount: consolChargeLines.amount,
        currency: consolChargeLines.currency,
        amountBase: consolChargeLines.amountBase,
        baseCurrency: consolChargeLines.baseCurrency,
        allocationBasis: consolChargeLines.allocationBasis,
        allocatedAt: consolChargeLines.allocatedAt,
        counterpartyName: named(locale, partners.legalNameEn, partners.legalNameAr),
        shareCount: sql<number>`(
          select count(*)::int from consol_allocation_shares s
           where s.consol_charge_line_id = "consol_charge_lines"."id"
        )`,
      })
      .from(consolChargeLines)
      .innerJoin(chargeTypes, eq(chargeTypes.id, consolChargeLines.chargeTypeId))
      .leftJoin(partners, eq(partners.id, consolChargeLines.counterpartyPartnerId))
      .where(eq(consolChargeLines.consolidationId, id))
      .orderBy(asc(consolChargeLines.direction), asc(consolChargeLines.createdAt))

    return consolidationOf(row, houses as ConsolidationHouse[], charges as ConsolidationCharge[])
  })
}

/** The master's row, with the four figures that are sums over what is under it. */
type ConsolidationHead = Omit<
  ConsolidationDetail,
  'houseCount' | 'volumeCbm' | 'grossWeightKg' | 'unallocatedCount' | 'houses' | 'charges'
>

/**
 * The master file, totalled — and the one place those totals are reached.
 *
 * Shared by both branches so the fixture cannot state a volume its own houses
 * do not add up to. The sums go through `Number` rather than `Decimal`, which
 * is the one place in this file that is acceptable: a cubic metre is not
 * money, and the figure is a manifest total printed to three places, not a
 * balance anything reconciles against.
 */
function consolidationOf(
  row: ConsolidationHead,
  houses: readonly ConsolidationHouse[],
  charges: readonly ConsolidationCharge[],
): ConsolidationDetail {
  const totals = houses.reduce(
    (acc, h) => ({
      volume: acc.volume + Number(h.volumeCbm ?? 0),
      gross: acc.gross + Number(h.grossWeightKg ?? 0),
    }),
    { volume: 0, gross: 0 },
  )

  return {
    ...row,
    houseCount: houses.length,
    volumeCbm: totals.volume.toFixed(3),
    grossWeightKg: totals.gross.toFixed(3),
    unallocatedCount: charges.filter((c) => c.allocatedAt === null).length,
    houses,
    charges,
  }
}

/**
 * Jobs that could join this consolidation.
 *
 * Same branch, same mode, no master of their own yet. The branch match is not
 * a nicety — a trigger refuses a cross-branch house, because a Dubai house
 * allocated a share of a Kuwait master cost lands in the wrong entity's P&L
 * and the wrong entity's accounting export.
 */
/** `locale` names the customer in each label (F27). */
export async function listAttachableJobs(
  actor: Actor,
  consolidationId: string,
  locale: 'en' | 'ar' = 'en',
): Promise<{ readonly id: string; readonly label: string }[]> {
  // Awaited beside `getConsolidation` on the master file, so it needs the same
  // branch: fixing one read alone only moves the failure down the page.
  if (usePilotFixtures()) return pilotAttachableJobs(consolidationId, Date.now(), locale)

  return withActor(actor, async (tx) => {
    const [consol] = await tx
      .select({ branchId: consolidations.branchId, mode: consolidations.mode })
      .from(consolidations)
      .where(eq(consolidations.id, consolidationId))
      .limit(1)

    if (!consol) return []

    const rows = await tx
      .select({
        id: jobs.id,
        reference: jobs.reference,
        customerName: named(locale, customers.legalNameEn, customers.legalNameAr),
      })
      .from(jobs)
      .innerJoin(customers, eq(customers.id, jobs.customerId))
      .where(
        and(
          eq(jobs.branchId, consol.branchId),
          eq(jobs.mode, consol.mode),
          isNull(jobs.consolidationId),
          isNull(jobs.closedAt),
          isNull(jobs.cancelledAt),
        ),
      )
      .orderBy(desc(jobs.createdAt))
      .limit(100)

    return rows.map((r) => ({ id: r.id, label: `${r.reference} — ${r.customerName}` }))
  })
}

/** One house's slice of one allocated master cost. */
export interface ConsolAllocationShare {
  readonly consolChargeLineId: string
  readonly jobId: string
  readonly jobReference: string
  readonly shareAmount: string
}

/**
 * Where every allocated cost on one master landed — the answer to "why is this
 * on my job?".
 *
 * The whole master in one read rather than one read per charge. The file page
 * draws every cost it holds, and a per-charge query would put a round trip
 * behind each row of a list that is already on the screen — the shares are two
 * columns and there are as many of them as houses times allocated costs, which
 * on the largest master in the seed is fifteen rows.
 *
 * `shareCount` on the charge already says how many there are. This says who
 * they were, and it is the only place the answer exists: the allocation writes
 * a charge line onto each house and a share row here, and the house's line
 * says "Allocated from consolidation" without naming the master it came from.
 */
export async function listAllocationShares(
  actor: Actor,
  consolidationId: string,
): Promise<readonly ConsolAllocationShare[]> {
  if (usePilotFixtures()) return pilotAllocationShares(consolidationId)

  return withActor(actor, async (tx) =>
    tx
      .select({
        consolChargeLineId: consolAllocationShares.consolChargeLineId,
        jobId: jobs.id,
        jobReference: jobs.reference,
        shareAmount: consolAllocationShares.shareAmount,
      })
      .from(consolAllocationShares)
      .innerJoin(jobs, eq(jobs.id, consolAllocationShares.jobId))
      .innerJoin(
        consolChargeLines,
        eq(consolChargeLines.id, consolAllocationShares.consolChargeLineId),
      )
      .where(eq(consolChargeLines.consolidationId, consolidationId))
      .orderBy(asc(jobs.reference)),
  )
}
