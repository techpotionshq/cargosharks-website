'use server'

/**
 * An operator taking the conversation over from the intake agent, and handing
 * it back.
 *
 * On `enquiry.assign`, in the enquiry's own branch: deciding who talks to the
 * customer about an enquiry is the same authority as deciding who owns it, and
 * a coordinator who can be given the enquiry can tell the bot to stand down on
 * it. Checked per branch (`assertCanIn`, A2), because a pooled permission from
 * another office is not authority over this one's customers.
 *
 * Off is immediate and total: the next turn reads `agent_enabled` and stays
 * silent without asking the model. Back on, the agent resumes at the next
 * customer message — it does not go back and answer what arrived while a
 * person had it, because that person may already have.
 */

import { revalidatePath } from 'next/cache'
import { getTranslations } from 'next-intl/server'
import { eq } from 'drizzle-orm'
import { intakeConversations, withActor } from '@qabandi/db'
import { requireSession } from '@/lib/session'
import { assertCan, assertCanIn } from '@/lib/permissions'
import { fail, succeed, type ActionState } from '@/lib/form-state'
import { refuseForbidden } from '@/lib/refuse-forbidden'

export const setIntakeAgent = refuseForbidden(async function setIntakeAgent(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const session = await requireSession()
  assertCan(session, 'enquiry.assign')
  const t = await getTranslations('intakeAgent')

  const enquiryId = String(form.get('enquiryId') ?? '')
  const enabled = form.get('enabled') === 'true'
  if (!enquiryId) return fail({ _: t('notFound') })

  const done = await withActor(session.actor, async (tx) => {
    const [conversation] = await tx
      .select({ id: intakeConversations.id, branchId: intakeConversations.branchId })
      .from(intakeConversations)
      .where(eq(intakeConversations.enquiryId, enquiryId))
      .limit(1)
    // Invisible under RLS is not-found: no signal about another branch's enquiry.
    if (!conversation) return false
    assertCanIn(session, 'enquiry.assign', conversation.branchId)

    await tx
      .update(intakeConversations)
      .set({
        agentEnabled: enabled,
        agentToggledById: session.actor.principalId,
        agentToggledAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(intakeConversations.id, conversation.id))
    return true
  })
  if (!done) return fail({ _: t('notFound') })

  revalidatePath(`/enquiries/${enquiryId}`)
  return succeed(enquiryId)
})
