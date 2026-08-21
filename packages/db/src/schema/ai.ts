/**
 * What the model was asked, what it answered, and what a person did next.
 *
 * Two tables, and the first one pays for itself three times over — which is
 * the whole argument for it existing before any surface uses it:
 *
 *   **an audit trail**, because §5 does not exempt a component for being
 *   statistical, and "why does this shipment say Jebel Ali" has to be
 *   answerable when the answer is "a model read it off line four";
 *
 *   **a cost control**, because this is the only metered port billed per
 *   document rather than per container, and the client asks what it costs in
 *   month two — grouped by surface, or the answer is not actionable;
 *
 *   **the corpus**, because `docs/Qabandi_AI_Surface.md` puts the evaluation
 *   harness before the first model call, and a golden set assembled after the
 *   fact from rows nobody kept is not a golden set.
 *
 * `extraction_proposals` is the second, and it is the reason no surface in
 * this system writes a business column directly. A model fills blanks and a
 * person's answer wins; the proposal is where those two meet.
 */

import { sql } from 'drizzle-orm'
import { boolean, index, integer, jsonb, numeric, text } from 'drizzle-orm/pg-core'
import { pgTable } from './table'
import { amount, pk, ref, timestamps, tsz } from './columns'
import { aiSurfaceEnum, proposalStatusEnum } from './enums'
import { branches, principals } from './identity'
import { documents, enquiries, jobs } from './jobs'

/**
 * One call to a model provider.
 *
 * Branch-scoped and not null, which is a decision worth defending: an
 * assistant answering a Doha coordinator, an extraction on a Kuwait enquiry
 * and a classification of a Dubai scan all belong to exactly one legal entity,
 * because the document they read does. A nullable branch would need a policy
 * arm admitting every internal principal to the unscoped rows, and that arm is
 * how one office reads another's correspondence through the ledger.
 */
export const aiInvocations = pgTable(
  'ai_invocations',
  {
    id: pk(),
    branchId: ref('branch_id')
      .notNull()
      .references(() => branches.id),
    surface: aiSurfaceEnum('surface').notNull(),
    /**
     * Who caused this call — the system principal for background work.
     *
     * Never null. Background extraction runs as `systemActor` because it *is*
     * background work and should be attributable as such; anything answering a
     * person carries that person, so RLS scopes what the model was allowed to
     * read in the first place.
     */
    principalId: ref('principal_id')
      .notNull()
      .references(() => principals.id),

    /** The slug we asked for. */
    modelRequested: text('model_requested').notNull(),
    /**
     * The slug that actually answered.
     *
     * A router may serve something other than what was named — a fallback, a
     * different quantisation, a provider outage. Recording only the request
     * makes "the extraction got worse on Tuesday" unanswerable.
     */
    modelServed: text('model_served'),
    /**
     * Which prompt produced this, versioned in the repository.
     *
     * Prompts are the one place the configuration rule is not extended (§9,
     * `AI-20`): a prompt an administrator can edit is a prompt no evaluation
     * result describes. This column is what lets a regression be attributed to
     * a specific revision rather than to a vague sense that something changed.
     */
    promptVersion: text('prompt_version').notNull(),

    /**
     * SHA-256 of the exact input. The replay key, and the cache key.
     *
     * `assets.checksum` gives the same property for files; this covers the
     * assembled request, which is what actually determines the answer. Two
     * calls with the same hash and different outputs is either a temperature
     * above zero or a provider that changed underneath a stable slug, and both
     * are worth being able to see.
     */
    inputHash: text('input_hash').notNull(),

    /**
     * The messages as sent, and the provider's body as returned.
     *
     * This duplicates content that already lives in `messages` and `assets`,
     * and it is stored anyway. Two reasons, and the second is the load-bearing
     * one. A prompt revision can only be replayed against what was actually
     * sent; reconstructing it from source rows re-runs assembly code that has
     * since changed, which answers a different question. And the first
     * question after a prompt-injection incident is *what did the model
     * actually see* — a reconstruction is a guess, and a guess is not
     * evidence. The duplicate sits in the same tenant's database under the
     * same policies as the original.
     */
    request: jsonb('request').$type<Record<string, unknown>>(),
    response: jsonb('response').$type<Record<string, unknown>>(),

    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    /**
     * USD, `numeric(19,6)`, unrounded — §11 applies to this like any money.
     *
     * Six decimals because it is the only scale that survives the arithmetic:
     * one cheap call is a fraction of a cent, and rounding each to two before
     * summing a month reports that the model is free. USD rather than KWD
     * because providers bill in dollars, and converting per call would stamp
     * an FX rate onto a cost that has not been invoiced — the conversion
     * belongs in the report, at the rate of the day it is read.
     */
    costUsd: amount('cost_usd'),
    latencyMs: integer('latency_ms'),
    finishReason: text('finish_reason'),
    /** Set when the call failed. The row is written either way. */
    error: text('error'),

    /*
      What this call was about. Nullable, explicit, and never all three.

      Explicit foreign keys rather than a `(table, id)` pair, because these are
      the joins that get run — "every model call about this job" is the
      question an operator asks, and a polymorphic column cannot answer it
      without a scan. `extraction_proposals` below makes the opposite choice
      for the opposite reason, and says so.
    */
    enquiryId: ref('enquiry_id').references(() => enquiries.id),
    jobId: ref('job_id').references(() => jobs.id),
    documentId: ref('document_id').references(() => documents.id),

    ...timestamps,
  },
  (t) => [
    // The cost report's whole query: this branch, this surface, this month.
    index('ai_invocations_cost_idx').on(t.branchId, t.surface, t.createdAt),
    // Cache and replay both look up by hash.
    index('ai_invocations_hash_idx').on(t.inputHash),
    index('ai_invocations_enquiry_idx').on(t.enquiryId),
    index('ai_invocations_job_idx').on(t.jobId),
  ],
)

/**
 * One field a model thinks should hold one value, awaiting a person.
 *
 * The row that makes "a model fills blanks and a person's answer wins" a
 * structure rather than a promise. Nothing in this system lets an extraction
 * write a business column; it writes one of these, and a coordinator's accept
 * is an ordinary audited write under their own actor — which is why the audit
 * trail can already answer *who put this on the shipment* without a new
 * concept being invented to answer it.
 */
export const extractionProposals = pgTable(
  'extraction_proposals',
  {
    id: pk(),
    branchId: ref('branch_id')
      .notNull()
      .references(() => branches.id),
    invocationId: ref('invocation_id')
      .notNull()
      .references(() => aiInvocations.id),

    /*
      The target, polymorphic — and here that is the right shape.

      A proposal is *inherently* about one field of one row, and the rows it
      may be about span enquiries, documents, supplier invoice lines and rate
      card lines. Eleven nullable foreign keys with an "exactly one is set"
      check is the alternative, and it is worse: the check is written once and
      forgotten at the twelfth column, and the joins it enables are joins
      nobody runs — a proposal is read by its own queue and by its target's
      screen, both of which already know which table they are.

      The table name is constrained in SQL rather than trusted from TypeScript,
      because the value arrives adjacent to model output and this is the column
      that decides which table an accept will write to.
    */
    targetTable: text('target_table').notNull(),
    targetId: ref('target_id').notNull(),
    field: text('field').notNull(),

    /**
     * The proposed value, as text. Always text, never typed.
     *
     * A model is another producer of untrusted rows, exactly as a spreadsheet
     * is, and `core/import.ts` has been validating untrusted rows since
     * FR-MD-11. A proposal carries a cell; it becomes a typed value only by
     * passing through the same parsers a CSV does. Typing it here would put a
     * second, weaker validator beside the tested one.
     */
    value: text('value').notNull(),
    /**
     * The model's own estimate, `numeric(5,4)`.
     *
     * Not a probability and never treated as one — an ordering hint, useful
     * for deciding what a coordinator sees first and useless for deciding what
     * happens without one. The thresholds it is compared against are rows.
     */
    confidence: numeric('confidence', { precision: 5, scale: 4 }),
    /**
     * The span of source the model says it read this from.
     *
     * Not decoration. Confirming *"2 × 20'GP, from line 4"* is a different and
     * much faster job than confirming *"2 × 20'GP"* against a screen of email,
     * and a proposal without evidence has to be re-derived by hand to be
     * checked — which costs more than typing it did.
     */
    evidence: text('evidence'),

    status: proposalStatusEnum('status').notNull().default('proposed'),
    /**
     * Whether the target column was empty when the proposal was made.
     *
     * Recorded rather than re-derived, because the answer changes: by the time
     * a coordinator opens the queue, someone may have typed the value the
     * model proposed. That is not a reason to hide the proposal — it is the
     * reason `decideProposal` is re-run at accept time against the row as it
     * is *then*, and this column is what makes the drift visible.
     */
    targetWasEmpty: boolean('target_was_empty').notNull().default(true),

    decidedById: ref('decided_by_id').references(() => principals.id),
    decidedAt: tsz('decided_at'),
    /** Nothing is deleted (§5.5). A settled proposal closes; it does not go. */
    closedAt: tsz('closed_at'),

    ...timestamps,
  },
  (t) => [
    // The review queue: open proposals for this branch, oldest first.
    index('extraction_proposals_queue_idx').on(t.branchId, t.status, t.createdAt),
    // A target's own screen, showing what is pending against it.
    index('extraction_proposals_target_idx').on(t.targetTable, t.targetId, t.status),
    index('extraction_proposals_invocation_idx').on(t.invocationId),
  ],
)

/**
 * The tables a proposal may target.
 *
 * Exported so the check constraint in the migration and the accept path in the
 * application read the same list — a constraint written once in SQL and a
 * switch statement written once in TypeScript is exactly the pair that drifts,
 * and `check-migrations.mjs` cannot see the drift because both halves are
 * individually valid.
 */
export const PROPOSAL_TARGETS = [
  'enquiries',
  'documents',
  'job_cargo',
  'supplier_invoice_lines',
  'rate_card_lines',
] as const

export type ProposalTarget = (typeof PROPOSAL_TARGETS)[number]

/**
 * Spend so far this calendar month, in USD, for the budget ceiling.
 *
 * A `sql` fragment rather than a query, because the caller supplies the
 * transaction — every read in this system goes through `withActor` and there
 * is no un-actored path (§5.2). Summed unrounded and rounded by the reader,
 * for the reason `cost_usd` gives above.
 */
export const monthToDateSpendUsd = sql`
  coalesce(sum(${aiInvocations.costUsd}), 0)
  filter (where ${aiInvocations.createdAt} >= date_trunc('month', now()))
`
