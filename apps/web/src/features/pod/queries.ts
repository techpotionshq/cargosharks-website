import 'server-only'

/**
 * Proof of delivery reads.
 *
 * One question, asked from three places: the job file, the customer portal and
 * — when a claim arrives — the audit. All three want the same thing, which is
 * why there is one query rather than a lean one for the portal and a full one
 * for operations. RLS already decides what each principal may see: the policy
 * on `proof_of_delivery` hides a record whose `customer_visible` is false from
 * everyone external, so the portal gets the narrow answer without this file
 * knowing the portal exists (§5.3).
 *
 * ## Superseded records are returned, not filtered
 *
 * A corrected POD and the one it corrected are both facts, and the second is
 * the one somebody will ask about. They are ordered so the current record
 * leads and the history follows, and the caller decides how much to show.
 */

import { asc, desc, eq } from 'drizzle-orm'
import {
  equipment,
  podPhotos,
  principals,
  proofOfDelivery,
  withActor,
  type Actor,
} from '@qabandi/db'

export interface PodPhotoRow {
  readonly id: string
  readonly assetId: string
  readonly caption: string | null
}

export interface PodRow {
  readonly id: string
  readonly deliveredAt: Date
  readonly receivedByName: string
  readonly receivedByIdNumber: string | null
  readonly signatureAssetId: string | null
  readonly containerNo: string | null
  readonly latitude: string | null
  readonly longitude: string | null
  readonly accuracyMetres: string | null
  readonly hasException: boolean
  readonly exceptionNotes: string | null
  readonly notes: string | null
  readonly capturedByEn: string | null
  readonly capturedByAr: string | null
  readonly createdAt: Date
  readonly supersededById: string | null
  readonly photos: readonly PodPhotoRow[]
}

export async function jobProofOfDelivery(actor: Actor, jobId: string): Promise<PodRow[]> {
  return withActor(actor, async (tx) => {
    const rows = await tx
      .select({
        id: proofOfDelivery.id,
        deliveredAt: proofOfDelivery.deliveredAt,
        receivedByName: proofOfDelivery.receivedByName,
        receivedByIdNumber: proofOfDelivery.receivedByIdNumber,
        signatureAssetId: proofOfDelivery.signatureAssetId,
        latitude: proofOfDelivery.latitude,
        longitude: proofOfDelivery.longitude,
        accuracyMetres: proofOfDelivery.accuracyMetres,
        hasException: proofOfDelivery.hasException,
        exceptionNotes: proofOfDelivery.exceptionNotes,
        notes: proofOfDelivery.notes,
        createdAt: proofOfDelivery.createdAt,
        supersededById: proofOfDelivery.supersededById,
        containerNo: equipment.containerNo,
        capturedByEn: principals.nameEn,
        capturedByAr: principals.nameAr,
      })
      .from(proofOfDelivery)
      /*
        Both joins are left. A POD on loose cargo names no container, and one
        captured through an agent portal may have no internal principal behind
        it — an inner join would drop exactly the deliveries that are hardest
        to reconstruct later.
      */
      .leftJoin(equipment, eq(equipment.id, proofOfDelivery.equipmentId))
      .leftJoin(principals, eq(principals.id, proofOfDelivery.capturedById))
      .where(eq(proofOfDelivery.jobId, jobId))
      .orderBy(desc(proofOfDelivery.deliveredAt))

    if (rows.length === 0) return []

    /*
      One query for every photograph on the job, grouped in memory.

      A per-POD query would be an N+1 on the screen most likely to hold several
      part deliveries, and the row count here is bounded by how many
      photographs a driver takes.
    */
    const photos = await tx
      .select({
        id: podPhotos.id,
        podId: podPhotos.podId,
        assetId: podPhotos.assetId,
        caption: podPhotos.caption,
      })
      .from(podPhotos)
      .innerJoin(proofOfDelivery, eq(proofOfDelivery.id, podPhotos.podId))
      .where(eq(proofOfDelivery.jobId, jobId))
      .orderBy(asc(podPhotos.sortOrder))

    const byPod = new Map<string, PodPhotoRow[]>()
    for (const photo of photos) {
      const list = byPod.get(photo.podId) ?? []
      list.push({ id: photo.id, assetId: photo.assetId, caption: photo.caption })
      byPod.set(photo.podId, list)
    }

    return rows.map((row) => ({ ...row, photos: byPod.get(row.id) ?? [] }))
  })
}

/** The containers on a job, for the "which part was delivered" picker. */
export async function jobEquipmentOptions(
  actor: Actor,
  jobId: string,
): Promise<{ value: string; label: string }[]> {
  return withActor(actor, async (tx) => {
    const rows = await tx
      .select({
        id: equipment.id,
        containerNo: equipment.containerNo,
        containerType: equipment.containerType,
      })
      .from(equipment)
      .where(eq(equipment.jobId, jobId))

    return rows
      .filter((r) => r.containerNo)
      .map((r) => ({
        value: r.id,
        label: r.containerType ? `${r.containerNo} · ${r.containerType}` : r.containerNo!,
      }))
  })
}
