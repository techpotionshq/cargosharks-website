'use server'

/**
 * Acting on a supplier's filed mail — attach it to a job, read an attachment as
 * a bill, or mark it dealt with.
 *
 * Each is checked in the mail's own branch (`assertCanIn`, A2), with the key
 * that already governs the record it touches: putting correspondence on a job
 * is `job.update`, capturing a bill is `payable.record`, and marking it dealt
 * with takes either — somebody who could have acted on it may say it needs no
 * action. A message is never deleted: "dealt with" is `read_at`, and attaching
 * sets `job_id` on the same row.
 */

import { revalidatePath } from 'next/cache'
import { getTranslations } from 'next-intl/server'
import { and, eq, isNull } from 'drizzle-orm'
import { jobs, messageAttachments, messages, withActor } from '@qabandi/db'
import { requireSession } from '@/lib/session'
import { assertCanIn, canIn } from '@/lib/permissions'
import { fail, failWith, succeed, type ActionState } from '@/lib/form-state'
import { refuseForbidden } from '@/lib/refuse-forbidden'
import { demoReadOnly } from '@/lib/pilot/read-only'

/** The filed mail a form names, if the reader can see it at all. */
async function filedMail(actor: Parameters<typeof withActor>[0], messageId: string) {
  const [row] = await withActor(actor, (tx) =>
    tx
      .select({ id: messages.id, branchId: messages.branchId, partnerId: messages.partnerId })
      .from(messages)
      .where(and(eq(messages.id, messageId), isNull(messages.enquiryId), isNull(messages.jobId)))
      .limit(1),
  )
  return row ?? null
}

/** Put the mail on a job of the same branch, by the reference a person types. */
export const attachPartnerMailToJob = refuseForbidden(async function attachPartnerMailToJob(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const session = await requireSession()
  // Before the read the permission check needs: fixture mode has no mail to
  // read, and the panel it came from is fixture data the demo cannot change.
  const demo = await demoReadOnly(form)
  if (demo) return demo
  const t = await getTranslations('partnerMail')
  const messageId = String(form.get('messageId') ?? '')
  const reference = String(form.get('jobReference') ?? '')
    .trim()
    .toUpperCase()
  if (!reference) return fail({ jobReference: t('jobReferenceRequired') })

  const mail = await filedMail(session.actor, messageId)
  if (!mail) return failWith(t('notFound'))
  assertCanIn(session, 'job.update', mail.branchId)

  const attached = await withActor(session.actor, async (tx) => {
    const [job] = await tx
      .select({ id: jobs.id })
      .from(jobs)
      .where(and(eq(jobs.reference, reference), eq(jobs.branchId, mail.branchId)))
      .limit(1)
    if (!job) return null
    await tx
      .update(messages)
      .set({ jobId: job.id, updatedAt: new Date() })
      .where(eq(messages.id, mail.id))
    return job.id
  })
  if (!attached) return fail({ jobReference: t('jobNotFound', { reference }) })

  revalidatePath(`/partners/${mail.partnerId}`)
  revalidatePath(`/jobs/${attached}`)
  return succeed(mail.id)
})

/** Nothing to do with it — kept, and off the list. */
export const markPartnerMailHandled = refuseForbidden(async function markPartnerMailHandled(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const session = await requireSession()
  // Before the read the permission check needs: fixture mode has no mail to
  // read, and the panel it came from is fixture data the demo cannot change.
  const demo = await demoReadOnly(form)
  if (demo) return demo
  const t = await getTranslations('partnerMail')
  const mail = await filedMail(session.actor, String(form.get('messageId') ?? ''))
  if (!mail) return failWith(t('notFound'))
  if (
    !canIn(session, 'job.update', mail.branchId) &&
    !canIn(session, 'payable.record', mail.branchId)
  ) {
    assertCanIn(session, 'payable.record', mail.branchId)
  }

  await withActor(session.actor, (tx) =>
    tx
      .update(messages)
      .set({ readAt: new Date(), updatedAt: new Date() })
      .where(eq(messages.id, mail.id)),
  )
  revalidatePath(`/partners/${mail.partnerId}`)
  return succeed(mail.id)
})

/**
 * Read one attachment as this supplier's bill — the same service call the
 * payables "Read a bill" dialog makes, on a file the intake already stored, so
 * the bill lands in `received` for finance to approve exactly as a scanned one
 * does. The mail is marked dealt with once a bill is written.
 */
export const readPartnerMailAsBill = refuseForbidden(async function readPartnerMailAsBill(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const session = await requireSession()
  // Before the read the permission check needs: fixture mode has no mail to
  // read, and the panel it came from is fixture data the demo cannot change.
  const demo = await demoReadOnly(form)
  if (demo) return demo
  const t = await getTranslations('partnerMail')
  const assetId = String(form.get('assetId') ?? '')
  const mail = await filedMail(session.actor, String(form.get('messageId') ?? ''))
  if (!mail || !mail.partnerId) return failWith(t('notFound'))
  assertCanIn(session, 'payable.record', mail.branchId)

  // The file must be this mail's own: a form naming some other asset is refused.
  const [owned] = await withActor(session.actor, (tx) =>
    tx
      .select({ id: messageAttachments.id })
      .from(messageAttachments)
      .where(
        and(eq(messageAttachments.messageId, mail.id), eq(messageAttachments.assetId, assetId)),
      )
      .limit(1),
  )
  if (!owned) return failWith(t('notFound'))

  const serviceUrl = process.env.SERVICE_URL
  const secret = process.env.INTERNAL_API_SECRET
  if (!serviceUrl || !secret) return failWith(t('serviceNotConfigured'))

  try {
    const response = await fetch(`${serviceUrl.replace(/\/$/, '')}/internal/ai/supplier-invoice`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-internal-secret': secret },
      body: JSON.stringify({
        actor: session.actor,
        branchId: mail.branchId,
        assetId,
        partnerId: mail.partnerId,
        jobId: null,
        write: true,
      }),
      cache: 'no-store',
      signal: AbortSignal.timeout(120_000),
    })
    if (!response.ok) return failWith(response.status === 503 ? t('noModel') : t('notABill'))
    const body = (await response.json()) as { supplierInvoiceId?: string | null }
    if (!body.supplierInvoiceId) return failWith(t('notABill'))

    await withActor(session.actor, (tx) =>
      tx
        .update(messages)
        .set({ readAt: new Date(), updatedAt: new Date() })
        .where(eq(messages.id, mail.id)),
    )
    revalidatePath(`/partners/${mail.partnerId}`)
    revalidatePath('/payables')
    return succeed(body.supplierInvoiceId)
  } catch {
    return failWith(t('readTimedOut'))
  }
})
