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
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { jobs, podPhotos, proofOfDelivery, withActor } from '@qabandi/db'
import { requireSession } from '@/lib/session'
import { assertCan } from '@/lib/permissions'
import { echo, fail, failWith, fieldErrors, succeed, type ActionState } from '@/lib/form-state'

function read(form: FormData, key: string): string | undefined {
  const value = form.get(key)
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

const optionalCoordinate = z
  .string()
  .trim()
  .regex(/^-?\d+(\.\d+)?$/, 'Not a coordinate')
  .optional()
  .transform((v) => v ?? null)

const podSchema = z
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
    deliveredAt: z.coerce.date(),
    receivedByName: z.string().trim().min(2, 'Who signed for it?').max(120),
    receivedByIdNumber: z
      .string()
      .trim()
      .max(60)
      .optional()
      .transform((v) => v || null),
    latitude: optionalCoordinate,
    longitude: optionalCoordinate,
    accuracyMetres: optionalCoordinate,
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
    message: 'Say what was wrong — short, damaged, refused',
    path: ['exceptionNotes'],
  })
  .refine((v) => (v.latitude === null) === (v.longitude === null), {
    message: 'A partial fix is not a location',
    path: ['latitude'],
  })

export async function captureProofOfDelivery(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const session = await requireSession()
  assertCan(session, 'job.update')

  const parsed = podSchema.safeParse({
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
    tx.select({ branchId: jobs.branchId }).from(jobs).where(eq(jobs.id, data.jobId)).limit(1),
  )
  if (!job) return failWith('That shipment could not be found.')

  const failedUploads: string[] = []

  const signatureAssetId = data.signature
    ? await uploadDataUri(session, job.branchId, data.signature, 'signature.png', {
        kind: 'pod_signature',
        jobId: data.jobId,
      }).catch(() => {
        failedUploads.push('signature')
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
      failedUploads.push(file.name || `photo ${index + 1}`)
    }
  }

  await withActor(session.actor, async (tx) => {
    const [pod] = await tx
      .insert(proofOfDelivery)
      .values({
        jobId: data.jobId,
        equipmentId: data.equipmentId ?? null,
        deliveredAt: data.deliveredAt,
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
      await tx
        .update(proofOfDelivery)
        .set({ supersededById: pod!.id })
        .where(eq(proofOfDelivery.id, data.supersedesId))
    }
  })

  revalidatePath(`/jobs/${data.jobId}`)
  revalidatePath('/portal')

  /*
    A partial success, reported as one.

    The delivery is recorded — that is the fact worth keeping and it is now
    safe. Saying nothing about the photographs that did not upload would leave
    a gap discovered during a claim, which is the worst possible moment.
  */
  if (failedUploads.length > 0) {
    return failWith(
      `The delivery was recorded, but these could not be uploaded: ${failedUploads.join(', ')}. ` +
        'Add them again from the job file.',
    )
  }

  return succeed(data.jobId)
}

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
