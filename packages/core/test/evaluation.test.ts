/**
 * Scoring the corpus — the arithmetic of the evaluation harness.
 *
 * The replay routine that reads `ai_invocations` and runs the parsers lives in
 * the service and needs a database; the scoring is pure and lives here, and
 * this is where it is proved. Every case below is a hand-written outcome, so a
 * metric that drifts is caught with no model, no corpus and no infrastructure.
 */

import { describe, expect, it } from 'vitest'
import { aggregate, compareVersions, type SurfaceOutcome } from '../src/index'

const invoice = (over: Partial<Extract<SurfaceOutcome, { kind: 'invoice' }>> = {}): SurfaceOutcome => ({
  kind: 'invoice',
  parsed: true,
  reconciles: true,
  consistent: true,
  confidence: 0.9,
  lineCount: 3,
  findingCount: 0,
  ...over,
})

const enquiry = (over: Partial<Extract<SurfaceOutcome, { kind: 'enquiry' }>> = {}): SurfaceOutcome => ({
  kind: 'enquiry',
  parsed: true,
  fieldCount: 4,
  refusedCount: 0,
  confidences: [0.8, 0.9],
  ...over,
})

const rateReply = (over: Partial<Extract<SurfaceOutcome, { kind: 'rate' }>> = {}): SurfaceOutcome => ({
  kind: 'rate',
  parsed: true,
  declined: false,
  lineCount: 2,
  rejectedCount: 0,
  ...over,
})

const failed = (error = 'not JSON'): SurfaceOutcome => ({ parsed: false, error })

describe('aggregating an invoice surface', () => {
  it('scores reconcile and self-consistency over the parsed cases only', () => {
    const metrics = aggregate('invoice_extract', [
      invoice(),
      invoice({ reconciles: false, consistent: false, findingCount: 1 }),
      failed(),
    ])

    expect(metrics.caseCount).toBe(3)
    expect(metrics.parseFailures).toBe(1)
    expect(metrics.parseOkRate).toBeCloseTo(2 / 3, 5)
    // Two parsed invoices, one reconciles.
    expect(metrics.reconcileRate).toBeCloseTo(0.5, 5)
    expect(metrics.selfConsistentRate).toBeCloseTo(0.5, 5)
  })

  it('summarises confidence over the parsed invoices', () => {
    const metrics = aggregate('invoice_extract', [invoice({ confidence: 0.2 }), invoice({ confidence: 0.8 })])
    expect(metrics.confidence?.mean).toBeCloseTo(0.5, 5)
    // 0.2 → bucket 2, 0.8 → bucket 8.
    expect(metrics.confidence?.buckets[2]).toBe(1)
    expect(metrics.confidence?.buckets[8]).toBe(1)
  })

  it('reports a rate of zero rather than dividing by zero on an empty run', () => {
    const metrics = aggregate('invoice_extract', [])
    expect(metrics.parseOkRate).toBe(0)
    expect(metrics.reconcileRate).toBe(0)
    expect(metrics.confidence?.mean).toBeNull()
  })
})

describe('aggregating an enquiry surface', () => {
  it('averages fields and totals refusals', () => {
    const metrics = aggregate('enquiry_extract', [
      enquiry({ fieldCount: 6, refusedCount: 1 }),
      enquiry({ fieldCount: 2, refusedCount: 0 }),
    ])
    expect(metrics.meanFields).toBeCloseTo(4, 5)
    expect(metrics.refusedTotal).toBe(1)
    // Confidences flatten across cases.
    expect(metrics.confidence?.mean).toBeCloseTo((0.8 + 0.9 + 0.8 + 0.9) / 4, 5)
  })

  it('carries no invoice-only metric', () => {
    const metrics = aggregate('enquiry_extract', [enquiry()])
    expect(metrics.reconcileRate).toBeUndefined()
  })
})

describe('aggregating a rate surface', () => {
  it('measures declines and averages lines over the priced replies only', () => {
    const metrics = aggregate('rate_extract', [
      rateReply({ declined: false, lineCount: 4 }),
      rateReply({ declined: false, lineCount: 2 }),
      rateReply({ declined: true, lineCount: 0 }),
    ])
    expect(metrics.declineRate).toBeCloseTo(1 / 3, 5)
    // The declined reply is left out of the line average.
    expect(metrics.meanLines).toBeCloseTo(3, 5)
  })
})

describe('confidence buckets', () => {
  it('puts an exact 1.0 in the last bucket, not off the end', () => {
    const metrics = aggregate('invoice_extract', [invoice({ confidence: 1 }), invoice({ confidence: 0 })])
    expect(metrics.confidence?.buckets[9]).toBe(1)
    expect(metrics.confidence?.buckets[0]).toBe(1)
  })
})

describe('comparing two prompt versions', () => {
  it('reports the movement of every shared ratio, parse rate first', () => {
    const before = aggregate('invoice_extract', [invoice({ reconciles: false, findingCount: 1 }), failed()])
    const after = aggregate('invoice_extract', [invoice(), invoice()])

    const deltas = compareVersions(before, after)
    expect(deltas[0]!.metric).toBe('parseOkRate')
    // 0.5 → 1.0
    expect(deltas[0]!.delta).toBeCloseTo(0.5, 5)

    const reconcile = deltas.find((d) => d.metric === 'reconcileRate')
    // 0/1 parsed reconciled → 2/2.
    expect(reconcile?.delta).toBeCloseTo(1, 5)
  })

  it('diffs only what both scorecards carry, never a surface-specific field', () => {
    const invoiceMetrics = aggregate('invoice_extract', [invoice()])
    const enquiryMetrics = aggregate('enquiry_extract', [enquiry()])
    const metrics = compareVersions(invoiceMetrics, enquiryMetrics).map((d) => d.metric)
    // Both carry a parse rate and a confidence mean; neither surface's own
    // metric (reconcileRate, meanFields) crosses into the diff.
    expect(metrics).toContain('parseOkRate')
    expect(metrics).not.toContain('reconcileRate')
    expect(metrics).not.toContain('meanFields')
  })
})
