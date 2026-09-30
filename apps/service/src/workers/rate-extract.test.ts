/**
 * What an agent's reply is ranked on — the charge context `rate-extract` prices
 * it against (F66).
 *
 * No database and no model: the extraction itself is covered in
 * `packages/core/test/rate-extract.test.ts`. What is pinned here is the one rule
 * the worker adds — which enquiry figure is the container count — through the
 * same `summariseRateReply` the worker stores as `quoted_total`, because the
 * failure was a total, not a context: a FCL reply stored as its flat fee alone.
 */

import { describe, expect, it } from 'vitest'
import { summariseRateReply } from '@qabandi/core'
import type { ImportRow, RateRowValues } from '@qabandi/core/import'
import { chargeContextFor } from './rate-extract'

const row = (line: number, over: Partial<RateRowValues>): ImportRow<RateRowValues> => ({
  line,
  values: {
    mode: 'sea_fcl',
    originCode: 'CNSHA',
    destinationCode: 'KWSWK',
    currency: 'USD',
    validFrom: '2026-09-01',
    validTo: null,
    chargeCode: 'OCEAN_FREIGHT',
    basis: 'per_container',
    rate: '0',
    minimum: null,
    maximum: null,
    containerType: null,
    transitDays: null,
    notes: null,
    ...over,
  },
})

/** The live reply: USD 1,850 per 40HC, 180 per container, 60 flat. */
const reply = [
  row(1, {
    chargeCode: 'OCEAN_FREIGHT',
    basis: 'per_container',
    rate: '1850',
    containerType: '40HC',
  }),
  row(2, { chargeCode: 'THC', basis: 'per_container', rate: '180' }),
  row(3, { chargeCode: 'DOCUMENTATION', basis: 'flat', rate: '60' }),
]

describe('the charge context an agent reply is ranked on', () => {
  it('counts containers from container_count on FCL, with no pieces', () => {
    const ctx = chargeContextFor({
      mode: 'sea_fcl',
      grossWeightKg: null,
      pieces: null,
      containerCount: 2,
    })

    const summary = summariseRateReply(reply, ctx)

    // 2 × 1,850 + 2 × 180 + 60 — was 60, the flat fee alone.
    expect(summary.primary?.amount.amount.toString()).toBe('4120')
    expect(summary.unpriced).toBe(0)
  })

  it('never reads pieces as the container count', () => {
    const ctx = chargeContextFor({
      mode: 'sea_fcl',
      grossWeightKg: null,
      pieces: 200,
      containerCount: 2,
    })

    expect(ctx.containers).toBe(2)
    expect(ctx.units).toBe(200)
  })

  it('leaves per-container lines unpriced rather than guessing a count', () => {
    const ctx = chargeContextFor({
      mode: 'sea_fcl',
      grossWeightKg: null,
      pieces: 12,
      containerCount: null,
    })

    const summary = summariseRateReply(reply, ctx)

    expect(ctx.containers).toBeUndefined()
    expect(summary.unpriced).toBe(2)
  })

  it('gives no container count to a mode that is not FCL', () => {
    const ctx = chargeContextFor({
      mode: 'sea_lcl',
      grossWeightKg: '1200',
      pieces: 4,
      containerCount: 3,
    })

    expect(ctx.containers).toBeUndefined()
    expect(ctx.kg).toBe('1200')
    expect(ctx.units).toBe(4)
  })
})
