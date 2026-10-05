import 'server-only'
import { desc, eq, inArray } from 'drizzle-orm'
import { intakeConversations, intakeTurns, messages, withActor, type Actor } from '@qabandi/db'
import { usePilotFixtures } from '@/lib/pilot/source'
import { pilotEnquiryIntake } from '@/lib/pilot/fixtures'
import type { EnquiryIntakeLike, IntakeTurnLike } from '@/lib/pilot/types'

/** Turns the panel lists — enough to explain the last few decisions, not a log viewer. */
const RECENT_TURNS = 6

/**
 * Where the intake agent is with one enquiry, and its last few turns.
 *
 * The read behind the agent panel on the enquiry screen. Every turn carries the
 * reason it was decided on and, where it wrote, what it wrote — so "why did it
 * not answer this customer" and "what exactly did we tell them" are answered
 * on the screen rather than from a log. Null when the agent does not hold the
 * enquiry (a coordinator typed it, or the branch has the agent off), and the
 * panel then draws nothing.
 */
export async function enquiryIntake(
  actor: Actor,
  enquiryId: string,
): Promise<EnquiryIntakeLike | null> {
  if (usePilotFixtures()) return pilotEnquiryIntake(enquiryId)
  if (!enquiryId) return null

  return withActor(actor, async (tx) => {
    const [conversation] = await tx
      .select()
      .from(intakeConversations)
      .where(eq(intakeConversations.enquiryId, enquiryId))
      .limit(1)
    if (!conversation) return null

    const turns = await tx
      .select()
      .from(intakeTurns)
      .where(eq(intakeTurns.conversationId, conversation.id))
      .orderBy(desc(intakeTurns.createdAt))
      .limit(RECENT_TURNS)

    const replyIds = turns.map((t) => t.replyMessageId).filter((id): id is string => Boolean(id))
    const replies =
      replyIds.length === 0
        ? []
        : await tx
            .select({ id: messages.id, body: messages.body })
            .from(messages)
            .where(inArray(messages.id, replyIds))
    const bodyOf = new Map(replies.map((r) => [r.id, r.body]))

    const recent: IntakeTurnLike[] = turns.map((turn) => ({
      id: turn.id,
      at: turn.createdAt,
      action: turn.action,
      reason: turn.reason,
      missing: turn.missing ?? [],
      messagesRead: (turn.messageIds ?? []).length,
      modelCalled: turn.invocationId !== null,
      replyBody: turn.replyMessageId ? (bodyOf.get(turn.replyMessageId) ?? null) : null,
      sendError: turn.sendError,
    }))

    return {
      conversationId: conversation.id,
      branchId: conversation.branchId,
      channel: conversation.channel === 'whatsapp' ? 'whatsapp' : 'email',
      state: conversation.state,
      agentEnabled: conversation.agentEnabled,
      locale: conversation.locale === 'ar' ? 'ar' : conversation.locale === 'en' ? 'en' : null,
      // The latest turn that read something says what is still missing.
      missing: recent.find((t) => t.reason !== 'model_retry')?.missing ?? [],
      turnDueAt: conversation.turnDueAt,
      turns: conversation.turns,
      modelCalls: conversation.modelCalls,
      clarifications: conversation.clarifications,
      readyAt: conversation.readyAt,
      recent,
    }
  })
}
