'use server'

/**
 * Answering the customer from the enquiry screen (D5).
 *
 * The send itself is the service's: the web app holds no WhatsApp key and no
 * relay password, by design, so this checks who may answer and hands the words
 * to `/internal/enquiries/:id/reply` with the actor, the way the document and
 * export actions reach the service. The service records the message as this
 * person's, which is what tells the intake agent a human has the conversation.
 *
 * On `enquiry.assign` in the enquiry's own branch (A2): deciding who talks to a
 * customer about an enquiry is the authority the take-over switch already asks
 * for. Allowed in every status, closed included, since a customer who writes
 * after a loss still deserves an answer.
 *
 * Every refusal is a sentence against the box, with the text echoed back so a
 * failed send never costs the coordinator what they typed.
 */

import { revalidatePath } from 'next/cache'
import { getTranslations } from 'next-intl/server'
import { eq } from 'drizzle-orm'
import { enquiries, withActor } from '@qabandi/db'
import { requireSession } from '@/lib/session'
import { assertCan, assertCanIn } from '@/lib/permissions'
import { echo, fail, failWith, succeed, type ActionState } from '@/lib/form-state'
import { refuseForbidden } from '@/lib/refuse-forbidden'
import { demoReadOnly } from '@/lib/pilot/read-only'

/** WhatsApp's own limit for a text body; the service holds the same line. */
const MAX_REPLY_CHARS = 4096

export const replyToCustomer = refuseForbidden(async function replyToCustomer(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const session = await requireSession()
  assertCan(session, 'enquiry.assign')
  const demo = await demoReadOnly(form)
  if (demo) return demo
  const t = await getTranslations('conversation')

  const enquiryId = String(form.get('enquiryId') ?? '').trim()
  const body = String(form.get('body') ?? '').trim()
  if (!enquiryId) return failWith(t('notFound'))
  if (body === '') return fail({ body: t('bodyRequired') }, echo(form))
  if (body.length > MAX_REPLY_CHARS) {
    return fail({ body: t('bodyTooLong', { max: MAX_REPLY_CHARS }) }, echo(form))
  }

  const [enquiry] = await withActor(session.actor, (tx) =>
    tx
      .select({ branchId: enquiries.branchId })
      .from(enquiries)
      .where(eq(enquiries.id, enquiryId))
      .limit(1),
  )
  // Invisible under RLS is not-found, never forbidden (FR-ID-04).
  if (!enquiry) return failWith(t('notFound'))
  assertCanIn(session, 'enquiry.assign', enquiry.branchId)

  const serviceUrl = process.env.SERVICE_URL
  const secret = process.env.INTERNAL_API_SECRET
  if (!serviceUrl || !secret) return failWith(t('serviceNotConfigured'), echo(form))

  let response: Response
  try {
    response = await fetch(
      `${serviceUrl.replace(/\/$/, '')}/internal/enquiries/${encodeURIComponent(enquiryId)}/reply`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-internal-secret': secret },
        body: JSON.stringify({ actor: session.actor, body }),
        cache: 'no-store',
        // The service retries a provider's bad second for up to ~7s itself.
        signal: AbortSignal.timeout(30_000),
      },
    )
  } catch {
    return failWith(t('serviceUnreachable'), echo(form))
  }

  if (!response.ok) {
    const refusal = (await response.json().catch(() => ({}))) as {
      error?: string
      detail?: string | null
    }
    /*
      The codes the coordinator can act on get their own sentence. The
      WhatsApp one matters most: past 24 hours since the customer last wrote,
      Meta refuses free text, and "send failed" would send them to retry a
      message that will fail every time.
    */
    switch (refusal.error) {
      case 'whatsapp_window':
        return failWith(t('windowClosed'), echo(form))
      case 'no_thread':
        return failWith(t('noThread'), echo(form))
      case 'not_customer':
        return failWith(t('notCustomer'), echo(form))
      case 'channel_off':
        return failWith(t('channelOff'), echo(form))
      case 'not_found':
        return failWith(t('notFound'))
      case 'empty':
        return fail({ body: t('bodyRequired') }, echo(form))
      case 'too_long':
        return fail({ body: t('bodyTooLong', { max: MAX_REPLY_CHARS }) }, echo(form))
      default:
        /*
          Never the provider's words on the screen: they are English JSON on an
          Arabic page (NEW-2). The service logged them; the web logs them too,
          beside the request that failed, and says a sentence in the reader's
          language.
        */
        console.warn(
          { enquiryId, status: response.status, error: refusal.error, detail: refusal.detail },
          'reply to customer: not sent',
        )
        return failWith(t('sendFailed'), echo(form))
    }
  }

  revalidatePath(`/enquiries/${enquiryId}`)
  revalidatePath('/enquiries')
  return succeed(enquiryId)
})
