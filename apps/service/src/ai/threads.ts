/**
 * Conversations, stored and read back.
 *
 * Everything here runs under the asking principal's own actor, which is what
 * makes the privacy claim on `assistant_threads` real rather than intended: the
 * policy narrows on `app.principal_id()`, so a thread id belonging to somebody
 * else simply does not exist as far as these queries are concerned. There is no
 * ownership check written in TypeScript because there is no need for one, and
 * a check written here would be the weaker of the two.
 *
 * ## One transaction per exchange
 *
 * A question and its answer are written together, after the model has replied.
 * Writing the question first would be more responsive and would leave a
 * question with no answer whenever a call failed — a thread that reads as
 * though the assistant ignored somebody. The failure is recorded in
 * `ai_invocations` either way, which is where a failure belongs.
 */

import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm'
import {
  ASSISTANT_HISTORY_TURNS,
  assistantMessages,
  assistantThreads,
  titleFrom,
  withActor,
  type Actor,
  type Tx,
} from '@qabandi/db'

export interface ThreadSummary {
  readonly id: string
  readonly title: string
  readonly lastMessageAt: Date
}

export interface StoredTurn {
  readonly role: 'user' | 'assistant'
  readonly content: string
  readonly proposals: Record<string, unknown>[]
  readonly used: Record<string, unknown>[]
  readonly at: Date
}

/** This person's open conversations, most recently used first. */
export async function listThreads(actor: Actor, limit = 30): Promise<ThreadSummary[]> {
  return withActor(actor, (tx: Tx) =>
    tx
      .select({
        id: assistantThreads.id,
        title: assistantThreads.title,
        lastMessageAt: assistantThreads.lastMessageAt,
      })
      .from(assistantThreads)
      .where(isNull(assistantThreads.closedAt))
      .orderBy(desc(assistantThreads.lastMessageAt))
      .limit(limit),
  )
}

/**
 * A thread's turns, oldest first.
 *
 * The whole thread, not a window. What the *model* is shown is trimmed
 * separately (`ASSISTANT_HISTORY_TURNS`) because that is the token bill; what
 * a person is shown is what they said, and truncating a conversation on screen
 * because it was expensive to re-read is the wrong economy.
 */
export async function readThread(actor: Actor, threadId: string): Promise<StoredTurn[]> {
  const rows = await withActor(actor, (tx: Tx) =>
    tx
      .select({
        direction: assistantMessages.direction,
        content: assistantMessages.content,
        proposals: assistantMessages.proposals,
        used: assistantMessages.used,
        at: assistantMessages.createdAt,
      })
      .from(assistantMessages)
      .where(eq(assistantMessages.threadId, threadId))
      .orderBy(asc(assistantMessages.createdAt)),
  )

  return rows.map((row) => ({
    role: row.direction === 'inbound' ? ('user' as const) : ('assistant' as const),
    content: row.content,
    proposals: row.proposals ?? [],
    used: row.used ?? [],
    at: row.at,
  }))
}

/**
 * What the model is shown of a conversation: the words, and only the recent ones.
 *
 * Tool results are not replayed, deliberately. They are the largest thing in a
 * transcript by a wide margin, and they go stale the moment anything moves — a
 * model reasoning from Tuesday's row counts will state them as today's. Asking
 * again is cheap and correct; remembering is neither.
 */
export async function historyFor(
  actor: Actor,
  threadId: string,
): Promise<{ role: 'user' | 'assistant'; content: string }[]> {
  const turns = await readThread(actor, threadId)
  return turns
    .slice(-ASSISTANT_HISTORY_TURNS)
    .map((turn) => ({ role: turn.role, content: turn.content }))
}

export interface RecordedExchange {
  readonly threadId: string
  readonly title: string
}

/**
 * Write a question and its answer, opening a thread if there is not one.
 *
 * `threadId` is taken from the caller and used *as a filter*, never as a
 * destination trusted on sight: the update below matches on it, RLS narrows
 * that match to threads this principal owns, and a miss means no rows updated
 * and a new thread opened instead. A thread id belonging to somebody else is
 * therefore not an error to handle — it is a value that matches nothing.
 */
export async function recordExchange(input: {
  readonly actor: Actor
  readonly branchId: string
  readonly threadId?: string | null
  readonly question: string
  readonly answer: string
  readonly proposals: readonly Record<string, unknown>[]
  readonly used: readonly Record<string, unknown>[]
  readonly invocationId?: string | null
}): Promise<RecordedExchange> {
  const { actor, branchId, question, answer } = input

  return withActor(actor, async (tx: Tx) => {
    let threadId = input.threadId ?? null
    let title = titleFrom(question)

    if (threadId) {
      const [existing] = await tx
        .update(assistantThreads)
        .set({ lastMessageAt: new Date() })
        .where(and(eq(assistantThreads.id, threadId), isNull(assistantThreads.closedAt)))
        .returning({ id: assistantThreads.id, title: assistantThreads.title })

      if (existing) {
        title = existing.title
      } else {
        // Not ours, closed, or gone. Start a fresh one rather than failing:
        // losing a question to a stale tab is a worse outcome than a duplicate.
        threadId = null
      }
    }

    if (!threadId) {
      const [created] = await tx
        .insert(assistantThreads)
        .values({ branchId, principalId: actor.principalId, title })
        .returning({ id: assistantThreads.id })
      threadId = created!.id
    }

    /*
      Both turns in one statement, so a conversation can never hold a question
      with no answer or an answer with no question. The trigger in `0033`
      checks each row against its thread's owner; carrying the actor's own
      principal here is what satisfies it.
    */
    await tx.insert(assistantMessages).values([
      {
        threadId,
        branchId,
        principalId: actor.principalId,
        direction: 'inbound' as const,
        content: question,
      },
      {
        threadId,
        branchId,
        principalId: actor.principalId,
        direction: 'outbound' as const,
        content: answer,
        proposals: [...input.proposals],
        used: [...input.used],
        invocationId: input.invocationId ?? null,
      },
    ])

    return { threadId, title }
  })
}

/**
 * Close a thread. Nothing is deleted (§5.5).
 *
 * `closed_at` rather than a delete, and the reason is not only the house rule:
 * `ai_invocations` rows point at what was spent answering these questions, and
 * a conversation removed from under them would leave a month's cost report
 * unable to say what it was for.
 */
export async function closeThread(actor: Actor, threadId: string): Promise<boolean> {
  const rows = await withActor(actor, (tx: Tx) =>
    tx
      .update(assistantThreads)
      .set({ closedAt: sql`now()` })
      .where(and(eq(assistantThreads.id, threadId), isNull(assistantThreads.closedAt)))
      .returning({ id: assistantThreads.id }),
  )

  return rows.length > 0
}
