/**
 * The assistant's conversations, kept.
 *
 * An earlier revision deliberately did not keep them, on the reasoning that a
 * conversation about "what is overdue" is true for as long as it takes to read
 * and that `ai_invocations` already holds the audit. Both halves of that are
 * still true and it was still the wrong call, for a reason that has nothing to
 * do with audit: **people work in threads.**
 *
 * A coordinator asks about a shipment on Tuesday, is interrupted, and comes
 * back on Wednesday. A transcript that evaporated makes them retype the
 * context and re-run every lookup — which costs a second set of model calls to
 * arrive back where they already were. `ai_invocations` cannot serve that: it
 * is one row per *call*, keyed for cost and replay, and reconstructing a
 * readable conversation from it means reassembling prompts nobody wrote for a
 * person to read.
 *
 * So: two tables, shaped like a messaging inbox rather than like a log.
 *
 * ## Threads are private to the person who opened them
 *
 * Unlike almost everything else in this schema, which is branch-scoped and
 * shared. A colleague's half-finished question is not a record of the
 * business — it is somebody thinking out loud, and a register that showed
 * everyone's would stop people using it honestly. The policy conditions on
 * `app.principal_id()` for that reason, and it is the only table here that
 * does.
 *
 * Branch is still carried and still not null, because the *cost* is the
 * company's even when the conversation is not: `ai_invocations` files spend
 * per branch, and a thread that could not name one would be spend nobody owns.
 */

import { index, jsonb, text } from 'drizzle-orm/pg-core'
import { pgTable } from './table'
import { pk, ref, timestamps, tsz } from './columns'
import { messageDirectionEnum } from './enums'
import { branches, principals } from './identity'
import { aiInvocations } from './ai'

/**
 * One conversation.
 *
 * `title` is the first question, trimmed — not a generated summary. A summary
 * would be a second model call on every new thread, billed per conversation, to
 * produce something less useful than the words the person actually typed: a
 * list showing *"Which invoices are overdue for Al Madina?"* is scannable, and
 * one showing *"Receivables enquiry"* is not.
 */
export const assistantThreads = pgTable(
  'assistant_threads',
  {
    id: pk(),
    branchId: ref('branch_id')
      .notNull()
      .references(() => branches.id),
    /** Whose conversation this is. The policy narrows on this column. */
    principalId: ref('principal_id')
      .notNull()
      .references(() => principals.id),
    title: text('title').notNull(),
    /**
     * Denormalised so the thread list orders without touching the messages.
     *
     * The list is the first thing rendered when the panel opens, on every
     * screen, for every internal user — so it is the one query here worth
     * keeping to a single index scan. Maintained by the application on write
     * rather than by a trigger, because the write is a single well-known path
     * and a trigger would fire on the audit's behalf too.
     */
    lastMessageAt: tsz('last_message_at').notNull().defaultNow(),
    /** Nothing is deleted (§5.5). Closing hides a thread; it does not remove it. */
    closedAt: tsz('closed_at'),
    ...timestamps,
  },
  (t) => [
    // The inbox: this person's open threads, most recent first.
    index('assistant_threads_inbox_idx').on(t.principalId, t.closedAt, t.lastMessageAt),
  ],
)

/**
 * One turn in a conversation.
 *
 * `direction` is reused from the messaging enum rather than a new one:
 * `inbound` is the person, `outbound` is the assistant. The same words mean
 * the same things on `messages`, and a second two-valued enum meaning the same
 * thing is a second one to get backwards.
 */
export const assistantMessages = pgTable(
  'assistant_messages',
  {
    id: pk(),
    threadId: ref('thread_id')
      .notNull()
      .references(() => assistantThreads.id),
    /**
     * Carried rather than derived, as on every other child table here.
     *
     * The policy on this table must not query `assistant_threads` to find out
     * who may read a row — two policies that reference each other are
     * infinitely recursive and PostgreSQL rejects them. `job_partners` carries
     * its branch for exactly this reason and says so.
     */
    branchId: ref('branch_id')
      .notNull()
      .references(() => branches.id),
    principalId: ref('principal_id')
      .notNull()
      .references(() => principals.id),
    direction: messageDirectionEnum('direction').notNull(),
    content: text('content').notNull(),
    /**
     * The actions this turn offered, exactly as they were offered.
     *
     * Stored rather than recomputed, and that is the point of storing them: a
     * proposal is a statement about a record *at a moment*. Re-deriving it on
     * read would silently change or remove a button a person is looking at,
     * and a shipment that has since moved would produce a different offer
     * beside the same sentence. The confirm path re-checks legality at the
     * moment it is pressed, which is where that check belongs.
     */
    proposals: jsonb('proposals').$type<Record<string, unknown>[]>().notNull().default([]),
    /** Which tools ran, so the panel can show its working after a reload. */
    used: jsonb('used').$type<Record<string, unknown>[]>().notNull().default([]),
    /**
     * The ledger row this turn cost, where it cost one.
     *
     * Nullable because a person's own message costs nothing, and because a
     * turn recorded after a provider failure has no successful invocation to
     * point at. `set null`-style orphaning is not a concern: `ai_invocations`
     * is never deleted.
     */
    invocationId: ref('invocation_id').references(() => aiInvocations.id),
    ...timestamps,
  },
  (t) => [index('assistant_messages_thread_idx').on(t.threadId, t.createdAt)],
)

export type AssistantThread = typeof assistantThreads.$inferSelect
export type AssistantMessage = typeof assistantMessages.$inferSelect

/**
 * How much of a conversation is replayed to the model.
 *
 * Sixteen turns, which is eight exchanges — comfortably more than any
 * question a coordinator actually follows up on, and bounded because the
 * transcript is the input token bill. A thread that has run longer is not
 * truncated on screen; only what the model is shown is.
 */
export const ASSISTANT_HISTORY_TURNS = 16

/** A thread's title: the first question, trimmed to something scannable. */
export function titleFrom(question: string): string {
  const cleaned = question.trim().replace(/\s+/g, ' ')
  return cleaned.length <= 70 ? cleaned : `${cleaned.slice(0, 69)}…`
}
