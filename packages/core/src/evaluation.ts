/**
 * Scoring what a model produced, without asking one again — the evaluation
 * harness `docs/Qabandi_AI_Surface.md` §10 puts before the next model surface.
 *
 * The corpus already exists: every extraction is recorded in `ai_invocations`
 * with the exact request, the provider's response and a hash, precisely so a
 * prompt or parser change can be measured against real traffic. What was
 * missing is the thing that reads it back and says whether it got better or
 * worse. This module is that — the arithmetic of it, kept pure.
 *
 * ## Intrinsic metrics first, a golden set later
 *
 * The doc frames the harness around a hand-labelled golden set scored per
 * field. That is the richer thing and it needs a person to sit and label,
 * which nobody has done yet. What can be measured *today*, over the whole
 * corpus, for nothing, is the set of signals that need no label: did the model
 * produce valid JSON, does the invoice it read reconcile, did it clear the
 * self-consistency gate, how many fields did it fill, how confident was it.
 * A prompt revision that drops the parse rate or the reconcile rate has
 * regressed, and this catches that without a golden set — which is the cut the
 * corpus supports on day one. The label-based "agreement with what the
 * coordinator accepted" metric is a second pass over `extraction_proposals`,
 * additive to the shapes here.
 *
 * ## Why this module scores primitives, not reader output
 *
 * It takes booleans and counts — a `SurfaceOutcome` — rather than an
 * `ExtractedInvoice`. The reduction from reader output to those primitives
 * belongs with the replay routine, which is the half that needs the reference
 * data (`lookups`, currency specs, a lane) and therefore cannot be pure. Kept
 * that side of the line, this module imports nothing and is scored from
 * hand-written outcomes in a millisecond — the same split `matching.ts` and
 * its callers keep, and for the same reason.
 */

/** The surfaces with a golden parse to replay. The assistant is not one — it
 *  has no structured output to score against. */
export type EvalSurface = 'invoice_extract' | 'enquiry_extract' | 'rate_extract'

/**
 * One recorded invocation's identity, carried alongside its outcome so a
 * detailed report can name the row and so a future ground-truth pass has
 * somewhere to hang the accepted value.
 */
export interface EvalCase {
  readonly invocationId: string
  readonly surface: EvalSurface
  readonly promptVersion: string
  readonly inputHash: string
}

/**
 * A row the replay could not turn back into structured output.
 *
 * The highest-signal failure there is: a prompt that has stopped producing
 * valid JSON, or a provider that changed under a stable slug. Kept as an
 * outcome rather than thrown, because a single unreadable row must not end the
 * run over the other nine hundred.
 */
export interface ParseFailure {
  readonly parsed: false
  readonly error: string
}

/** A supplier invoice, reduced to what a P&L-blind score needs. */
export interface InvoiceOutcome {
  readonly kind: 'invoice'
  readonly parsed: true
  /** No arithmetic findings — the figures add up. */
  readonly reconciles: boolean
  /** Cleared the unattended-write gate (`isSelfConsistent`). */
  readonly consistent: boolean
  /** The model's own estimate, already clamped to 0..1. */
  readonly confidence: number
  readonly lineCount: number
  readonly findingCount: number
}

/** An emailed enquiry, reduced. */
export interface EnquiryOutcome {
  readonly kind: 'enquiry'
  readonly parsed: true
  /** Fields the model proposed after the admissibility filter. */
  readonly fieldCount: number
  /** Proposals refused as fields the surface may not write — a security signal. */
  readonly refusedCount: number
  /** One confidence per proposed field. */
  readonly confidences: readonly number[]
}

/** A broker's rate reply, reduced. */
export interface RateOutcome {
  readonly kind: 'rate'
  readonly parsed: true
  readonly declined: boolean
  readonly lineCount: number
  readonly rejectedCount: number
}

export type SurfaceOutcome = InvoiceOutcome | EnquiryOutcome | RateOutcome | ParseFailure

/** A histogram of confidences across a surface's cases. */
export interface ConfidenceSummary {
  /** Mean of every confidence seen, or null where none was. */
  readonly mean: number | null
  /** Ten deciles: `[0,0.1) … [0.9,1.0]`. A value of exactly 1 lands in the last. */
  readonly buckets: readonly number[]
}

/**
 * One surface's scorecard over a set of cases.
 *
 * The surface-specific fields are optional because a metric that does not apply
 * is absent rather than zero — a `reconcileRate` of 0 on the enquiry surface
 * would read as "every enquiry failed to reconcile", which is a category error,
 * not a bad day. `compareVersions` diffs only the fields both sides carry, so
 * absence stays absence.
 */
export interface EvalMetrics {
  readonly surface: EvalSurface
  readonly caseCount: number
  readonly parseFailures: number
  /** Share of cases that produced structured output at all. */
  readonly parseOkRate: number
  /** Invoice: share of parsed invoices whose figures add up. */
  readonly reconcileRate?: number
  /** Invoice: share of parsed invoices that cleared the write gate. */
  readonly selfConsistentRate?: number
  /** Enquiry: mean fields proposed per parsed case. */
  readonly meanFields?: number
  /** Enquiry: total proposals refused by the admissibility filter. */
  readonly refusedTotal?: number
  /** Rate: share of parsed replies the model read as a decline. */
  readonly declineRate?: number
  /** Rate: mean line items per parsed reply. */
  readonly meanLines?: number
  /** Where the surface carries a confidence, its distribution. */
  readonly confidence?: ConfidenceSummary
}

const BUCKET_COUNT = 10

function summariseConfidence(values: readonly number[]): ConfidenceSummary {
  const buckets = new Array<number>(BUCKET_COUNT).fill(0)
  for (const value of values) {
    // Clamp defensively; the reducers already pass clamped values, but a
    // histogram that throws on a stray 1.0000001 is a report nobody can run.
    const clamped = value < 0 ? 0 : value > 1 ? 1 : value
    const index = Math.min(BUCKET_COUNT - 1, Math.floor(clamped * BUCKET_COUNT))
    buckets[index] = (buckets[index] ?? 0) + 1
  }
  const mean = values.length === 0 ? null : values.reduce((a, b) => a + b, 0) / values.length
  return { mean, buckets }
}

function rate(part: number, whole: number): number {
  return whole === 0 ? 0 : part / whole
}

/**
 * Fold one surface's outcomes into a scorecard.
 *
 * Per surface rather than across all of them, because the replay routine reads
 * the corpus one surface at a time and the metrics that matter differ per
 * surface. A `ParseFailure` counts against `parseOkRate` for every surface and
 * contributes to nothing else — it has no fields to score.
 */
export function aggregate(surface: EvalSurface, outcomes: readonly SurfaceOutcome[]): EvalMetrics {
  const caseCount = outcomes.length
  const parsed = outcomes.filter((o): o is Exclude<SurfaceOutcome, ParseFailure> => o.parsed)
  const parseFailures = caseCount - parsed.length

  const base: EvalMetrics = {
    surface,
    caseCount,
    parseFailures,
    parseOkRate: rate(parsed.length, caseCount),
  }

  if (surface === 'invoice_extract') {
    const invoices = parsed.filter((o): o is InvoiceOutcome => o.kind === 'invoice')
    return {
      ...base,
      reconcileRate: rate(invoices.filter((o) => o.reconciles).length, invoices.length),
      selfConsistentRate: rate(invoices.filter((o) => o.consistent).length, invoices.length),
      confidence: summariseConfidence(invoices.map((o) => o.confidence)),
    }
  }

  if (surface === 'enquiry_extract') {
    const enquiries = parsed.filter((o): o is EnquiryOutcome => o.kind === 'enquiry')
    const fieldTotal = enquiries.reduce((sum, o) => sum + o.fieldCount, 0)
    return {
      ...base,
      meanFields: enquiries.length === 0 ? 0 : fieldTotal / enquiries.length,
      refusedTotal: enquiries.reduce((sum, o) => sum + o.refusedCount, 0),
      confidence: summariseConfidence(enquiries.flatMap((o) => o.confidences)),
    }
  }

  const rates = parsed.filter((o): o is RateOutcome => o.kind === 'rate')
  const priced = rates.filter((o) => !o.declined)
  return {
    ...base,
    declineRate: rate(rates.filter((o) => o.declined).length, rates.length),
    meanLines: priced.length === 0 ? 0 : priced.reduce((sum, o) => sum + o.lineCount, 0) / priced.length,
  }
}

/** One metric's movement between two prompt versions. */
export interface MetricDelta {
  readonly metric: string
  readonly before: number
  readonly after: number
  readonly delta: number
}

/**
 * What changed between two prompt versions of the same surface.
 *
 * Only the ratio metrics both scorecards carry — a version that added the
 * confidence summary where the older run had none is not a regression to
 * report, it is a shape change. `parseOkRate` is always present and always
 * first, because a prompt that regressed parsing regressed everything
 * downstream of it and that is the number to read before any other.
 */
export function compareVersions(before: EvalMetrics, after: EvalMetrics): MetricDelta[] {
  const fields: readonly (keyof EvalMetrics)[] = [
    'parseOkRate',
    'reconcileRate',
    'selfConsistentRate',
    'meanFields',
    'refusedTotal',
    'declineRate',
    'meanLines',
  ]

  const deltas: MetricDelta[] = []
  for (const field of fields) {
    const b = before[field]
    const a = after[field]
    if (typeof b === 'number' && typeof a === 'number') {
      deltas.push({ metric: field, before: b, after: a, delta: a - b })
    }
  }

  const bMean = before.confidence?.mean
  const aMean = after.confidence?.mean
  if (typeof bMean === 'number' && typeof aMean === 'number') {
    deltas.push({ metric: 'meanConfidence', before: bMean, after: aMean, delta: aMean - bMean })
  }

  return deltas
}
