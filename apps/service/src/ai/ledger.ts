/**
 * Every model call, recorded — `ai_invocations`.
 *
 * One function wraps every surface, and it is the only place in the service
 * that is allowed to call a provider. Three things follow from that and all
 * three are the reason it exists rather than each worker calling `complete`
 * for itself: the spend ceiling is checked once, the ledger is written once,
 * and no surface can quietly become the one that forgot.
 *
 * ## The ledger is deliberately *not* transactional with the business write
 *
 * This is the one place in the codebase that breaks the pattern `queue.ts`
 * sets, and the break is the point.
 *
 * Everywhere else, work enqueues inside the business transaction so a job
 * never exists for a write that rolled back — a transactional outbox with no
 * extra component. A model call cannot work that way, because **the money is
 * spent whether or not the write succeeds.** An extraction that produced
 * unusable output and rolled back still cost what it cost, and a ledger that
 * rolled back with it would report a month's spend lower than the invoice
 * OpenRouter sends. The cost record is a fact about the outside world, not
 * about our transaction.
 *
 * So the row is written in its own transaction, before the caller's, and it is
 * written on failure too. A call that timed out is a row with an `error` and a
 * latency; a call that never happened is no row at all. Those have to be
 * distinguishable, because the first is a provider problem and the second is a
 * worker that is not running.
 *
 * ## Nothing here decides what the answer means
 *
 * It returns the provider's response. Whether the text parses, whether the
 * fields are admissible, whether the document adds up — all of that is
 * `core/ai.ts` and `core/extraction.ts`, where it is tested without a key.
 */

import { createHash } from 'node:crypto'
import { and, eq, gte, sql } from 'drizzle-orm'
import { aiInvocations, systemActor, withActor, type Actor, type Tx } from '@qabandi/db'
import type { AiSurface } from '@qabandi/core'
import type { ModelRequest, ModelResponse } from '../ports/index'
import { modelProvider } from '../adapters/index'
import { integration } from '../settings'
import { ModelError, monthlyBudgetUsd } from '../adapters/model'

export class AiUnavailableError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'AiUnavailableError'
    this.code = code
  }
}

/**
 * Who is asking, about what.
 *
 * `branchId` is required and not derived from the actor, because an actor may
 * hold several branches and the ledger row belongs to exactly one — the branch
 * of the *document*, which only the caller knows.
 */
export interface InvocationContext {
  readonly actor: Actor
  readonly branchId: string
  readonly surface: AiSurface
  /**
   * The prompt revision, versioned in the repository (`AI-20`).
   *
   * Required rather than defaulted. A prompt an evaluation cannot name is a
   * prompt no evaluation result describes, and a default here would let a new
   * surface ship without ever naming one.
   */
  readonly promptVersion: string
  readonly enquiryId?: string | null
  readonly jobId?: string | null
  readonly documentId?: string | null
}

export interface Invocation {
  readonly response: ModelResponse
  /** The ledger row, so a caller can point a proposal at it. */
  readonly invocationId: string
}

/**
 * The replay key.
 *
 * Over the assembled request rather than over the source document, because the
 * request is what actually determines the answer — the same PDF read under a
 * revised prompt is a different question. `assets.checksum` already covers the
 * bytes; this covers what we did with them.
 */
export function fingerprint(request: ModelRequest, model: string, promptVersion: string): string {
  return createHash('sha256')
    .update(
      JSON.stringify({ model, promptVersion, messages: request.messages, schema: request.schema }),
    )
    .digest('hex')
}

/**
 * Spend so far this calendar month, in USD, across every branch.
 *
 * Across branches deliberately: the ceiling is a property of the OpenRouter
 * account being billed, and one account pays for all five offices. A per-branch
 * cap would let a fleet of five spend five times what its holder agreed to.
 *
 * Read as the system actor, since a coordinator's own branch scope would show
 * them a fraction of the spend and let the cap pass when it should not.
 */
export async function monthToDateUsd(): Promise<number> {
  const [row] = await withActor(systemActor(), (tx: Tx) =>
    tx
      .select({ spent: sql<string>`coalesce(sum(${aiInvocations.costUsd}), 0)::text` })
      .from(aiInvocations)
      .where(gte(aiInvocations.createdAt, sql`date_trunc('month', now())`)),
  )

  return Number(row?.spent ?? 0)
}

/**
 * Ask a model, and record having asked.
 *
 * The order matters and is not the obvious one: the provider is resolved and
 * the budget checked *before* the call, the row is written *after* it, and the
 * write happens on both paths. Writing the row first and updating it would
 * double the writes and leave a row claiming a call that a crash meant never
 * happened.
 */
export async function invoke(
  context: InvocationContext,
  request: ModelRequest,
): Promise<Invocation> {
  const provider = await modelProvider()

  /*
    Refused rather than silently skipped.

    A surface that finds no provider has not "found nothing in the document" —
    it has not looked. Returning an empty result here would make an
    unconfigured deployment indistinguishable from a stack of blank invoices,
    which is the failure `noModel` exists to prevent and would be undone by one
    convenient `catch` in a worker.
  */
  if (!provider.available) {
    throw new AiUnavailableError(
      'ai.not_configured',
      'No model provider is configured for this deployment.',
    )
  }

  const settings = await integration('ai')
  const ceiling = monthlyBudgetUsd(settings)
  if (ceiling > 0) {
    const spent = await monthToDateUsd()
    if (spent >= ceiling) {
      throw new AiUnavailableError(
        'ai.budget_exhausted',
        `This month's model spend (${spent.toFixed(2)} USD) has reached the ceiling of ${ceiling.toFixed(2)} USD.`,
      )
    }
  }

  /*
    The model name off the resolved provider rather than out of the settings
    again. `key` is `openrouter:<model>`, and reading it here is what keeps the
    ledger's `model_requested` in step with what was actually sent when a
    surface override and a default disagree.
  */
  const requested = provider.key.includes(':')
    ? provider.key.split(':').slice(1).join(':')
    : provider.key
  const inputHash = fingerprint(request, requested, context.promptVersion)

  const startedAt = Date.now()
  let response: ModelResponse | undefined
  let failure: Error | undefined

  try {
    response = await provider.complete(request)
  } catch (error) {
    failure = error instanceof Error ? error : new Error(String(error))
  }

  const latencyMs = Date.now() - startedAt

  const invocationId = await record({
    context,
    request,
    requested,
    inputHash,
    latencyMs,
    response,
    failure,
  })

  if (failure) throw failure
  return { response: response!, invocationId }
}

interface RecordInput {
  readonly context: InvocationContext
  readonly request: ModelRequest
  readonly requested: string
  readonly inputHash: string
  readonly latencyMs: number
  readonly response?: ModelResponse
  readonly failure?: Error
}

/**
 * The row, in its own transaction.
 *
 * As the system actor rather than the asking principal, and the reason is
 * narrow: a coordinator's actor is scoped to their branches by RLS, which is
 * exactly right for reading a document and wrong for writing an accounting
 * record about what the company spent. The *asking* principal is recorded in
 * `principal_id`, so attribution survives without the write depending on that
 * principal's scope.
 */
async function record(input: RecordInput): Promise<string> {
  const { context, response, failure } = input

  const [row] = await withActor(systemActor([context.branchId]), (tx: Tx) =>
    tx
      .insert(aiInvocations)
      .values({
        branchId: context.branchId,
        surface: context.surface,
        principalId: context.actor.principalId,
        modelRequested: input.requested,
        modelServed: response?.model ?? null,
        promptVersion: context.promptVersion,
        inputHash: input.inputHash,
        /*
          The messages as sent, and the provider's body as returned.

          This duplicates content that lives in `messages` and `assets`, and the
          schema argues why it is stored anyway: a prompt revision can only be
          replayed against what was actually sent, and the first question after
          a prompt-injection incident is what the model actually saw.
        */
        request: { surface: context.surface, messages: input.request.messages } as Record<
          string,
          unknown
        >,
        response: (response?.raw as Record<string, unknown> | undefined) ?? null,
        inputTokens: response?.inputTokens ?? 0,
        outputTokens: response?.outputTokens ?? 0,
        costUsd: response?.costUsd ?? null,
        latencyMs: input.latencyMs,
        finishReason: response?.finishReason ?? null,
        error: failure ? describeFailure(failure) : null,
        enquiryId: context.enquiryId ?? null,
        jobId: context.jobId ?? null,
        documentId: context.documentId ?? null,
      })
      .returning({ id: aiInvocations.id }),
  )

  return row!.id
}

/**
 * What to write in `error`.
 *
 * The provider's code where there is one, because `model.out_of_credit` and
 * `model.rate_limited` are the two an operator can act on and only one of them
 * is fixed by waiting. A bare message loses that distinction into prose.
 */
function describeFailure(error: Error): string {
  return error instanceof ModelError ? `${error.code}: ${error.message}` : error.message
}

/**
 * What this deployment has spent, by surface, for the month.
 *
 * The shape the cost report wants, and the reason `surface` is a column rather
 * than telemetry: an assistant answering forty questions a day and an
 * extraction reading four hundred invoices a month fail economically in
 * completely different ways, and a single total hides which one is happening.
 */
export async function spendBySurface(
  branchIds: readonly string[],
): Promise<{ surface: string; calls: number; usd: string }[]> {
  return withActor(systemActor([...branchIds]), (tx: Tx) =>
    tx
      .select({
        surface: aiInvocations.surface,
        calls: sql<number>`count(*)::int`,
        usd: sql<string>`coalesce(sum(${aiInvocations.costUsd}), 0)::text`,
      })
      .from(aiInvocations)
      .where(gte(aiInvocations.createdAt, sql`date_trunc('month', now())`))
      .groupBy(aiInvocations.surface),
  )
}

/**
 * A previous answer to exactly this question, if there is one.
 *
 * The cache `assets.checksum` and `input_hash` were both put there for. Re-reading
 * a scan that was already read costs nothing, which matters most in the case
 * that actually happens: the same agent invoice attached to two jobs, or a
 * coordinator retrying an extraction because the first result scrolled away.
 *
 * Deliberately not automatic. `invoke` does not consult this, because a caller
 * that wants a fresh reading after a prompt change must be able to get one —
 * and because a cache that cannot be bypassed is a cache that hides a
 * regression. The callers that want it ask for it.
 */
export async function previousResponse(
  branchIds: readonly string[],
  surface: AiSurface,
  inputHash: string,
): Promise<{ id: string; response: unknown } | undefined> {
  const [row] = await withActor(systemActor([...branchIds]), (tx: Tx) =>
    tx
      .select({ id: aiInvocations.id, response: aiInvocations.response })
      .from(aiInvocations)
      .where(
        and(
          eq(aiInvocations.inputHash, inputHash),
          eq(aiInvocations.surface, surface),
          sql`${aiInvocations.error} is null`,
        ),
      )
      .limit(1),
  )

  return row
}
