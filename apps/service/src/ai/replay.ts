/**
 * Replaying the corpus through the parsers — the read half of the evaluation
 * harness (`docs/Qabandi_AI_Surface.md` §10).
 *
 * `core/evaluation.ts` scores outcomes; this is what produces them, from rows
 * already in `ai_invocations`. It reads each recorded response back exactly as
 * the ledger's cache path does — `readCompletion(row.response).text` then
 * `parseModelJson` — routes it to the same pure reader the live worker used,
 * and reduces the result to the booleans and counts the scorer wants.
 *
 * ## No model is ever called
 *
 * Every row here is already paid for. The routine reads `response` and runs
 * pure functions; it never touches `invoke`, `assertWithinBudget` or a
 * provider. Replaying the whole corpus costs a few hundred JSON parses and a
 * fold — which is the point of recording the response in the first place.
 *
 * ## A row that will not read back is an outcome, not a crash
 *
 * A response that no longer deserializes, or JSON the reader now rejects, is
 * the single highest-signal result there is — a prompt that stopped producing
 * valid output. It is caught and returned as a `ParseFailure` so one bad row
 * cannot end the run over the rest.
 */

import { and, eq, isNotNull, isNull } from 'drizzle-orm'
import { aiInvocations, systemActor, withActor, type Tx } from '@qabandi/db'
import {
  admissible,
  aggregate,
  isSelfConsistent,
  parseModelJson,
  readExtractedEnquiry,
  readExtractedInvoice,
  reconcileInvoice,
  seedCurrencyLookup,
  type EvalMetrics,
  type EvalSurface,
  type SurfaceOutcome,
} from '@qabandi/core'
import type { ImportLookups } from '@qabandi/core/import'
import { readCompletion } from '../adapters/model'
import { CONFIDENCE_FLOOR, loadReference } from '../workers/invoice-extract'

/** The surfaces this first cut replays. Rate needs a lane the corpus does not
 *  carry; the assistant has no golden parse. Both are out, deliberately. */
export const REPLAYABLE_SURFACES: readonly EvalSurface[] = ['invoice_extract', 'enquiry_extract']

export interface ReplayResult {
  readonly surface: EvalSurface
  /** The version filtered to, or null for every version at once. */
  readonly promptVersion: string | null
  readonly metrics: EvalMetrics
}

interface CorpusRow {
  readonly response: Record<string, unknown> | null
  readonly modelRequested: string
}

/**
 * Score one surface's corpus, optionally narrowed to a single prompt version.
 *
 * The invoice reader needs reference lookups; they are read once for the run
 * rather than per row, because charge types and currencies do not change under
 * a replay.
 */
export async function replaySurface(
  surface: EvalSurface,
  options: { readonly promptVersion?: string } = {},
): Promise<ReplayResult> {
  const actor = systemActor()

  const lookups = surface === 'invoice_extract' ? (await loadReference(actor)).lookups : undefined

  const rows = await withActor(actor, (tx: Tx) => {
    const filters = [
      eq(aiInvocations.surface, surface),
      isNotNull(aiInvocations.response),
      // A call that errored has no answer to score — that failure is the
      // ledger's to report, not the parser's.
      isNull(aiInvocations.error),
    ]
    if (options.promptVersion) filters.push(eq(aiInvocations.promptVersion, options.promptVersion))

    return tx
      .select({
        response: aiInvocations.response,
        modelRequested: aiInvocations.modelRequested,
      })
      .from(aiInvocations)
      .where(and(...filters))
      .orderBy(aiInvocations.createdAt)
  })

  const outcomes = rows.map((row) => reduce(surface, row, lookups))
  return {
    surface,
    promptVersion: options.promptVersion ?? null,
    metrics: aggregate(surface, outcomes),
  }
}

/** One recorded row, reduced to a scorable outcome. */
function reduce(
  surface: EvalSurface,
  row: CorpusRow,
  lookups: ImportLookups | undefined,
): SurfaceOutcome {
  let text: string
  try {
    // `readCompletion` takes the provider body; the row holds it verbatim.
    text = readCompletion(row.response as never, row.modelRequested).text
  } catch {
    return { parsed: false, error: 'the recorded response could not be read back' }
  }

  try {
    if (surface === 'invoice_extract') {
      const extracted = readExtractedInvoice(parseModelJson(text), lookups!)
      const spec = seedCurrencyLookup(extracted.header.currency)
      const findings = spec ? reconcileInvoice(extracted, spec) : []
      return {
        kind: 'invoice',
        parsed: true,
        // A currency the seed does not know cannot be reconciled, so it is not
        // counted as reconciling — the same guard `invoice-extract` applies.
        reconciles: Boolean(spec) && findings.length === 0,
        consistent: spec ? isSelfConsistent(extracted, spec, CONFIDENCE_FLOOR) : false,
        confidence: extracted.confidence,
        lineCount: extracted.lines.rows.length,
        findingCount: findings.length,
      }
    }

    if (surface === 'enquiry_extract') {
      const extracted = readExtractedEnquiry(parseModelJson(text))
      const { allowed, refused } = admissible('enquiry_extract', extracted.fields)
      return {
        kind: 'enquiry',
        parsed: true,
        fieldCount: allowed.length,
        // Names the schema's enum did not admit, plus names the allowlist
        // refused — both are a field the surface may not write.
        refusedCount: refused.length + extracted.unknownFields.length,
        confidences: allowed.map((proposal) => Number(proposal.confidence)),
      }
    }

    return { parsed: false, error: `replay is not implemented for ${surface}` }
  } catch (error) {
    return { parsed: false, error: error instanceof Error ? error.message : String(error) }
  }
}
