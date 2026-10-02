'use server'

/**
 * The customer's answer to a quotation — `FR-CP-07`, D12.
 *
 * Accept and Decline from the portal, run through `moveQuote`, the same
 * transition the operations screen's Accept and Reject use. The state machine,
 * the validity rule and the audit trail are therefore identical whichever side
 * pressed the button; what differs is who the actor is. Here it is the
 * customer contact, so RLS is the authority: a quotation that is not theirs,
 * not sent, or no longer the current version is simply not there, and the only
 * write their policy admits is `sent -> accepted | rejected`.
 *
 * Acceptance is recorded against the contact (`audit_log.principal_id`), the
 * moment (`decided_at`) and their address (`audit_log.ip`), which is what
 * FR-CP-07 asks for. Booking the shipment stays a branch decision, as it is
 * when a coordinator records an acceptance: the `quote.accepted` notice tells
 * them it is ready.
 */

import { revalidatePath } from 'next/cache'
import { getTranslations } from 'next-intl/server'
import { moveQuote, withActor } from '@qabandi/db'
import { requireSession } from '@/lib/session'
import { ForbiddenError } from '@/lib/permissions'
import { failWith, succeed, type ActionState } from '@/lib/form-state'
import { refuseForbidden } from '@/lib/refuse-forbidden'
import { demoReadOnly } from '@/lib/pilot/read-only'
import { isUuid } from '@/lib/ids'

/** A reason is a sentence or two, not a document. */
const REASON_LIMIT = 1000

export const decidePortalQuote = refuseForbidden(async function decidePortalQuote(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const session = await requireSession()

  /*
    Fixture mode first, unusually. The offline portal is previewed by the
    internal pilot persona (the layout's one exception to A9), so the check
    below would answer the demo's visitor "not allowed" for a button the
    customer they are pretending to be could press. Nothing is written in
    fixture mode either way; this only picks the true sentence.
  */
  const demo = await demoReadOnly(form)
  if (demo) return demo

  /*
    The portal's own principal, and nobody else's (A9).

    Staff hold `quote.accept` and answer from the operations screen, where the
    action checks it. A staff or agent session posting here would otherwise
    accept with its own branch-wide RLS and none of the customer's limits, so
    it is refused before anything is read.
  */
  if (session.actor.type !== 'customer_contact') throw new ForbiddenError('portal.quote.decide')

  const t = await getTranslations('portalQuotes')
  const quoteId = String(form.get('quoteId') ?? '')
  const decision = String(form.get('decision') ?? '')
  const reason = String(form.get('reason') ?? '')
    .trim()
    .slice(0, REASON_LIMIT)

  if (!isUuid(quoteId) || (decision !== 'accepted' && decision !== 'rejected')) {
    return failWith(t('refusedMissing'))
  }

  const moved = await withActor(session.actor, (tx) =>
    moveQuote(tx, quoteId, decision, { by: 'customer', reason }),
  )

  if (!moved.ok) {
    /*
      Each refusal in words the customer can act on. `not_found` covers every
      quotation their policy hides: another company's, and a version the
      branch has since replaced, which is the case a customer actually meets
      (a tab left open on v1 after v2 arrived). One sentence for all of them
      says no more than that: FR-ID-04, no enumeration signal.
    */
    if (moved.refusal === 'lapsed' || moved.from === 'expired') {
      return failWith(t('refusedExpired'))
    }
    if (moved.from === 'accepted' || moved.from === 'rejected') {
      return failWith(t('refusedDecided'))
    }
    return failWith(t('refusedMissing'))
  }

  revalidatePath('/portal/quotes')
  revalidatePath(`/portal/quotes/${quoteId}`)
  return succeed(decision)
})
