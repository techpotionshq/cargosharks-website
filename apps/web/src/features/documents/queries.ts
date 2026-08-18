/**
 * Party and cargo reads.
 *
 * Deliberately not folded into `getJobDetail`. That query returns `JobDetail`,
 * a type the pilot fixtures also satisfy — widening it would mean either
 * inventing fixture parties for twenty demo shipments or making every field
 * optional and letting the job page guess. These are their own reads, called
 * only by the panels that show them, and they return nothing where there is a
 * fixture behind the page rather than a database.
 */

import 'server-only'
import { asc, eq } from 'drizzle-orm'
import { equipment, jobCargo, jobParties, withActor, type Actor } from '@qabandi/db'
import { usePilotFixtures } from '@/lib/pilot/source'

export interface PartyRow {
  readonly id: string
  readonly role: string
  readonly nameEn: string
  readonly nameAr: string | null
  readonly address: string | null
  readonly city: string | null
  readonly country: string | null
  readonly contactName: string | null
  readonly phone: string | null
  readonly email: string | null
  readonly taxId: string | null
}

export interface CargoRow {
  readonly id: string
  readonly lineNo: number
  readonly marksAndNumbers: string | null
  readonly packageCount: number | null
  readonly packageType: string | null
  readonly descriptionEn: string
  readonly descriptionAr: string | null
  readonly hsCode: string | null
  readonly grossWeightKg: string | null
  readonly netWeightKg: string | null
  readonly volumeCbm: string | null
  readonly equipmentId: string | null
  readonly containerNo: string | null
}

export async function listJobParties(actor: Actor, jobId: string): Promise<PartyRow[]> {
  if (usePilotFixtures()) return []

  return withActor(actor, async (tx) =>
    tx
      .select({
        id: jobParties.id,
        role: jobParties.role,
        nameEn: jobParties.nameEn,
        nameAr: jobParties.nameAr,
        address: jobParties.address,
        city: jobParties.city,
        country: jobParties.country,
        contactName: jobParties.contactName,
        phone: jobParties.phone,
        email: jobParties.email,
        taxId: jobParties.taxId,
      })
      .from(jobParties)
      .where(eq(jobParties.jobId, jobId))
      .orderBy(asc(jobParties.role), asc(jobParties.sortOrder)),
  )
}

export async function listJobCargo(actor: Actor, jobId: string): Promise<CargoRow[]> {
  if (usePilotFixtures()) return []

  return withActor(actor, async (tx) =>
    tx
      .select({
        id: jobCargo.id,
        lineNo: jobCargo.lineNo,
        marksAndNumbers: jobCargo.marksAndNumbers,
        packageCount: jobCargo.packageCount,
        packageType: jobCargo.packageType,
        descriptionEn: jobCargo.descriptionEn,
        descriptionAr: jobCargo.descriptionAr,
        hsCode: jobCargo.hsCode,
        grossWeightKg: jobCargo.grossWeightKg,
        netWeightKg: jobCargo.netWeightKg,
        volumeCbm: jobCargo.volumeCbm,
        equipmentId: jobCargo.equipmentId,
        containerNo: equipment.containerNo,
      })
      .from(jobCargo)
      .leftJoin(equipment, eq(equipment.id, jobCargo.equipmentId))
      .where(eq(jobCargo.jobId, jobId))
      .orderBy(asc(jobCargo.lineNo)),
  )
}

/** Container options for the cargo form — which box a line is stuffed in. */
export async function listJobContainers(
  actor: Actor,
  jobId: string,
): Promise<{ value: string; label: string }[]> {
  if (usePilotFixtures()) return []

  return withActor(actor, async (tx) => {
    const rows = await tx
      .select({
        id: equipment.id,
        containerNo: equipment.containerNo,
        containerType: equipment.containerType,
      })
      .from(equipment)
      .where(eq(equipment.jobId, jobId))
      .orderBy(asc(equipment.containerNo))

    return rows
      .filter((r) => r.containerNo)
      .map((r) => ({
        value: r.id,
        label: r.containerType ? `${r.containerNo} · ${r.containerType}` : r.containerNo!,
      }))
  })
}
