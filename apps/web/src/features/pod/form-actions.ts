'use server'

/**
 * Capturing a delivery.
 *
 * This is the one mutation in the product designed to be used standing at a
 * gate on a phone, and every decision in it follows from that.
 *
 * **Nothing optional blocks the capture.** The signature may fail to draw, the
 * photographs may fail to upload on a bad connection, the device may refuse
 * location. None of those stop the delivery being recorded, because the
 * alternative is a driver who abandons the form and reports it on WhatsApp —
 * and then there is no record at all. What is required is the minimum that
 * makes it evidence: who signed, and when the cargo changed hands.
 *
 * **A failed photograph is reported, not swallowed.** The POD is written
 * either way, and the action says which uploads did not make it so the
 * operator can retry from a desk rather than discovering the gap during a
 * claim.
 *
 * **A correction supersedes; it never edits.** `superseded_by_id` on the old
 * row, a new row for the truth. The wrong name on a delivery note is exactly
 * the kind of thing somebody will later need to prove was corrected rather
 * than always right.
 */

import { revalidatePath } from 'next/cache'
import { getTranslations } from 'next-intl/server'
import { and, eq, isNull } from 'drizzle-orm'
import { z } from 'zod'
import { instantFromLocal, isLocalDateTime } from '@qabandi/core'
import { branches, jobs, podPhotos, proofOfDelivery, withActor } from '@qabandi/db'
import { requireSession } from '@/lib/session'
import { assertCan } from '@/lib/permissions'
import {
  echo,
  fail,
  failWith,
  fieldErrors,
  succeed,
  type ActionState,
  type Translate,
} from '@/lib/form-state'
import { localeParse } from '@/lib/validate'
import { refuseForbidden } from '@/lib/refuse-forbidden'

/** A correction naming a record it may not retire — thrown to roll back. */
class PodRefusal extends Error {}

function read(form: FormData, key: string): string | undefined {
  const value = form.get(key)
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

const optionalCoordinate = (tv: Translate) =>
  z
    .string()
    .trim()
    .regex(/^-?\d+(\.\d+)?$/, tv('notCoordinate'))
    .optional()
    .transform((v) => v ?? null)

const podSchema = (tv: Translate) =>
  z
    .object({
      jobId: z.uuid(),
      equipmentId: z.uuid().optional(),
      /*
      A datetime, and it defaults to now in the form rather than here.

      Backdating is legitimate and common — the delivery happened at the gate
      at 14:20 and the form is submitted at 16:05 from the office — so the
      column takes what the operator states. What it must not become is
      `now()`, which would quietly replace the fact with the moment somebody
      typed it up.
    */
      deliveredAt: z
        .string()
        .trim()
        .refine((v) => isLocalDateTime(v), { message: tv('notDeliveryTime') }),
      receivedByName: z.string().trim().min(2, tv('whoSigned')).max(120),
      receivedByIdNumber: z
        .string()
        .trim()
        .max(60)
        .optional()
        .transform((v) => v || null),
      latitude: optionalCoordinate(tv),
      longitude: optionalCoordinate(tv),
      accuracyMetres: optionalCoordinate(tv),
      hasException: z
        .string()
        .optional()
        .transform((v) => v === 'on' || v === 'true'),
      exceptionNotes: z
        .string()
        .trim()
        .max(1000)
        .optional()
        .transform((v) => v || null),
      notes: z
        .string()
        .trim()
        .max(1000)
        .optional()
        .transform((v) => v || null),
      /** Set when this capture replaces an earlier one. */
      supersedesId: z.uuid().optional(),
      /** A PNG data URI drawn on the signature pad, or absent. */
      signature: z.string().optional(),
    })
    .refine((v) => !v.hasException || (v.exceptionNotes && v.exceptionNotes.length > 0), {
      // The database says the same thing. Stated here too, because a constraint
      // violation reaches the driver as "something went wrong" and this reaches
      // them as a field with a message under it.
      message: tv('sayWhatWasWrong'),
      path: ['exceptionNotes'],
    })
    .refine((v) => (v.latitude === null) === (v.longitude === null), {
      message: tv('partialFix'),
      path: ['latitude'],
    })

export const captureProofOfDelivery = refuseForbidden(async function captureProofOfDelivery(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const session = await requireSession()
  assertCan(session, 'job.update')
  const tv = await getTranslations('podValidation')

  const parsed = await localeParse(podSchema(tv), {
    jobId: read(form, 'jobId'),
    equipmentId: read(form, 'equipmentId'),
    deliveredAt: read(form, 'deliveredAt'),
    receivedByName: read(form, 'receivedByName'),
    receivedByIdNumber: read(form, 'receivedByIdNumber'),
    latitude: read(form, 'latitude'),
    longitude: read(form, 'longitude'),
    accuracyMetres: read(form, 'accuracyMetres'),
    hasException: read(form, 'hasException'),
    exceptionNotes: read(form, 'exceptionNotes'),
    notes: read(form, 'notes'),
    supersedesId: read(form, 'supersedesId'),
    signature: read(form, 'signature'),
  })
  if (!parsed.success) return fail(fieldErrors(parsed.error), echo(form))

  const data = parsed.data

  /*
    The branch comes from the job, not the form.

    An asset is scoped by branch and that scope is what RLS reads. Taking it
    from a hidden input would let a posted form store a photograph against a
    branch the principal happens to hold but the shipment does not belong to.
  */
  const [job] = await withActor(session.actor, (tx) =>
    tx
      .select({ branchId: jobs.branchId, timeZone: branches.timeZone })
      .from(jobs)
      .innerJoin(branches, eq(branches.id, jobs.branchId))
      .where(eq(jobs.id, data.jobId))
      .limit(1),
  )
  if (!job) return failWith(tv('shipmentNotFound'))
  /*
    The time the cargo changed hands, as typed at the gate, read in the
    branch's zone. `z.coerce.date()` read it as UTC on the server, so a
    delivery signed at 14:20 in Kuwait was stored as 17:20.
  */
  const deliveredAt = instantFromLocal(data.deliveredAt, job.timeZone)!

  const failedUploads: string[] = []

  const signatureAssetId = data.signature
    ? await uploadDataUri(session, job.branchId, data.signature, 'signature.png', {
        kind: 'pod_signature',
        jobId: data.jobId,
      }).catch(() => {
        failedUploads.push(tv('uploadSignature'))
        return null
      })
    : null

  const photoFiles = form
    .getAll('photos')
    .filter((entry): entry is File => entry instanceof File && entry.size > 0)

  const photoAssetIds: string[] = []
  for (const [index, file] of photoFiles.entries()) {
    try {
      const buffer = Buffer.from(await file.arrayBuffer())
      const id = await upload(session, job.branchId, buffer, file.name || `photo-${index + 1}`, {
        contentType: file.type,
        meta: { kind: 'pod_photo', jobId: data.jobId },
      })
      photoAssetIds.push(id)
    } catch {
      failedUploads.push(file.name || tv('uploadPhoto', { number: index + 1 }))
    }
  }

  const outcome = await withActor(session.actor, async (tx) => {
    const [pod] = await tx
      .insert(proofOfDelivery)
      .values({
        jobId: data.jobId,
        equipmentId: data.equipmentId ?? null,
        deliveredAt,
        receivedByName: data.receivedByName,
        receivedByIdNumber: data.receivedByIdNumber,
        signatureAssetId,
        latitude: data.latitude,
        longitude: data.longitude,
        accuracyMetres: data.accuracyMetres,
        hasException: data.hasException,
        exceptionNotes: data.exceptionNotes,
        notes: data.notes,
        capturedById: session.principal.id,
      })
      .returning({ id: proofOfDelivery.id })

    if (photoAssetIds.length > 0) {
      await tx
        .insert(podPhotos)
        .values(photoAssetIds.map((assetId, sortOrder) => ({ podId: pod!.id, assetId, sortOrder })))
    }

    /*
      The supersede is inside the same transaction as the replacement.

      Marking the old row first and failing on the new one would leave a job
      whose only delivery record is retired — which reads as "never delivered"
      on the customer portal.
    */
    if (data.supersedesId) {
      /*
        Only a record on this job, and only one still standing (O16). The id
        is a hidden field: unchecked, a correction posted against job A could
        retire job B's delivery record, which then reads as "never delivered"
        on B's portal. Matching nothing rolls the new record back with it.
      */
      const retired = await tx
        .update(proofOfDelivery)
        .set({ supersededById: pod!.id })
        .where(
          and(
            eq(proofOfDelivery.id, data.supersedesId),
            eq(proofOfDelivery.jobId, data.jobId),
            isNull(proofOfDelivery.supersededById),
          ),
        )
        .returning({ id: proofOfDelivery.id })
      if (retired.length === 0) throw new PodRefusal()
    }
  }).catch((error: unknown) => {
    if (error instanceof PodRefusal) return 'refused' as const
    throw error
  })
  if (outcome === 'refused') return failWith(tv('nothingToCorrect'))

  revalidatePath(`/jobs/${data.jobId}`)
  revalidatePath('/portal')

  /*
    A partial success, reported as one.

    The delivery is recorded — that is the fact worth keeping and it is now
    safe. Saying nothing about the photographs that did not upload would leave
    a gap discovered during a claim, which is the worst possible moment.
  */
  if (failedUploads.length > 0) {
    return failWith(tv('uploadsFailed', { files: failedUploads.join(tv('listSeparator')) }))
  }

  return succeed(data.jobId)
})

/**
 * Sends bytes to the service, which owns the storage credentials.
 *
 * `apps/web` never holds the object-store secret — the same boundary the
 * signed-URL route keeps for downloads, described at length in
 * `service/src/api/internal.ts`.
 */
async function upload(
  session: Awaited<ReturnType<typeof requireSession>>,
  branchId: string,
  bytes: Buffer,
  fileName: string,
  options: { contentType: string; meta?: Record<string, unknown> },
): Promise<string> {
  const serviceUrl = process.env.SERVICE_URL
  const secret = process.env.INTERNAL_API_SECRET
  if (!serviceUrl || !secret) throw new Error('storage_not_configured')

  const response = await fetch(`${serviceUrl.replace(/\/$/, '')}/internal/files/upload`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-internal-secret': secret },
    body: JSON.stringify({
      actor: session.actor,
      branchId,
      fileName,
      contentType: options.contentType,
      data: bytes.toString('base64'),
      meta: options.meta,
    }),
    signal: AbortSignal.timeout(30_000),
  })

  if (!response.ok) throw new Error(`upload_failed_${response.status}`)
  const body = (await response.json()) as { assetId?: string }
  if (!body.assetId) throw new Error('upload_failed_no_asset')
  return body.assetId
}

/** The signature pad hands back a `data:image/png;base64,...` string. */
async function uploadDataUri(
  session: Awaited<ReturnType<typeof requireSession>>,
  branchId: string,
  dataUri: string,
  fileName: string,
  meta: Record<string, unknown>,
): Promise<string | null> {
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(dataUri)
  // Not an error worth failing the delivery over. A signature pad that
  // produced nothing usable is a missing signature, which the record allows.
  if (!match) return null

  return upload(session, branchId, Buffer.from(match[2]!, 'base64'), fileName, {
    contentType: match[1]!,
    meta,
  })
}
