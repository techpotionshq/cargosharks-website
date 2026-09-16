import { describe, expect, it } from 'vitest'
import {
  MODES,
  RATE_EXTRACTION_SCHEMA,
  readExtractedRateReply,
  summariseRateReply,
  type RateReplyLane,
  type RawExtractedRateReply,
  type RawRateLine,
} from '../src/extraction'
import { EXTRACTABLE_FIELDS } from '../src/ai'
import type { ImportLookups } from '../src/import'

/*
  A broker's reply is read against a lane we already hold, so the lookups carry
  the two ports we asked about, the charge codes this deployment has, and the
  currencies it settles in. Everything else the model might name is refused by
  the same validators the CSV importer uses — the point of the exercise.
*/
const lookups: ImportLookups = {
  locations: new Set(['AEJEA', 'KWSWK', 'CNSHA']),
  chargeTypes: new Set(['OFR', 'THC', 'DOC']),
  currencies: new Set(['USD', 'KWD', 'AED']),
}

const lane: RateReplyLane = { mode: 'sea_fcl', originCode: 'AEJEA', destinationCode: 'KWSWK' }

const rline = (over: Partial<RawRateLine> = {}): RawRateLine => ({
  chargeType: 'OFR',
  basis: 'per_container',
  rate: '950.000',
  currency: null,
  minimum: null,
  maximum: null,
  containerType: '40HC',
  ...over,
})

const reply = (over: Partial<RawExtractedRateReply> = {}): RawExtractedRateReply => ({
  declined: false,
  declinedReason: null,
  currency: 'USD',
  validFrom: '2026-09-01',
  validTo: '2026-09-30',
  origin: 'AEJEA',
  destination: 'KWSWK',
  mode: 'sea_fcl',
  lines: [rline()],
  confidence: 0.9,
  ...over,
})

describe('the rate-extract schema', () => {
  it('asks only for line fields the surface is allowed to speak to', () => {
    // The schema and the allowlist are two places that must not drift.
    const properties = RATE_EXTRACTION_SCHEMA.properties as {
      lines: { items: { properties: Record<string, unknown> } }
    }
    const lineFields = Object.keys(properties.lines.items.properties)
    const allowed = new Set(EXTRACTABLE_FIELDS.rate_extract)
    for (const field of lineFields) {
      expect(allowed.has(field)).toBe(true)
    }
  })

  it('pins MODES to the transport_mode enum', () => {
    expect([...MODES]).toEqual(['sea_fcl', 'sea_lcl', 'air', 'land', 'courier'])
  })
})

describe('readExtractedRateReply', () => {
  it('welds our lane onto the model’s charges', () => {
    const result = readExtractedRateReply(reply(), lookups, lane)
    expect(result.declined).toBe(false)
    expect(result.lines.ok).toBe(true)
    expect(result.lines.rows).toHaveLength(1)
    const row = result.lines.rows[0]!.values
    // The lane is ours, not the model's — even though the model restated it.
    expect(row.mode).toBe('sea_fcl')
    expect(row.originCode).toBe('AEJEA')
    expect(row.destinationCode).toBe('KWSWK')
    expect(row.chargeCode).toBe('OFR')
    expect(row.basis).toBe('per_container')
    expect(row.rate).toBe('950.000')
    expect(row.currency).toBe('USD')
  })

  it('short-circuits a declined reply and keeps the reason', () => {
    const result = readExtractedRateReply(
      reply({ declined: true, declinedReason: 'No space to Shuwaikh this month', lines: [] }),
      lookups,
      lane,
    )
    expect(result.declined).toBe(true)
    expect(result.declinedReason).toBe('No space to Shuwaikh this month')
    // A declined reply with no lines is not a header issue — declining is an answer.
    expect(result.headerIssues).toHaveLength(0)
  })

  it('flags a reply that prices a different lane', () => {
    const result = readExtractedRateReply(reply({ origin: 'CNSHA' }), lookups, lane)
    expect(result.laneMismatch).toBeDefined()
    expect(result.laneMismatch).toContain('CNSHA')
  })

  it('refuses a charge code we do not hold', () => {
    const result = readExtractedRateReply(reply({ lines: [rline({ chargeType: 'BRIBE' })] }), lookups, lane)
    expect(result.lines.ok).toBe(false)
  })

  it('defaults an unstated start date to the reply day (a real agent rarely states one)', () => {
    // The failure a live reply produced: three good lines rejected for a missing
    // "valid from" the agent never wrote. With the reply's own date, they validate.
    const withoutStart = reply({ validFrom: null })
    const rejected = readExtractedRateReply(withoutStart, lookups, lane)
    expect(rejected.lines.ok).toBe(false)

    const accepted = readExtractedRateReply(withoutStart, lookups, lane, '2026-09-16')
    expect(accepted.lines.ok).toBe(true)
    expect(accepted.lines.rows[0]!.values.validFrom).toBe('2026-09-16')
  })

  it('notes a reply that is neither declined nor carries lines', () => {
    const result = readExtractedRateReply(reply({ lines: [] }), lookups, lane)
    expect(result.headerIssues.join(' ')).toContain('no rate lines')
  })
})

describe('summariseRateReply', () => {
  it('prices per-container lines against the enquiry’s container count', () => {
    const result = readExtractedRateReply(reply(), lookups, lane)
    const summary = summariseRateReply(result.lines.rows, { containers: 2 })
    expect(summary.primary?.currency).toBe('USD')
    // 950 × 2 containers.
    expect(summary.primary?.amount.amount.toString()).toBe('1900')
    expect(summary.unpriced).toBe(0)
  })

  it('keeps a mixed-currency quote honest — no primary, both totals', () => {
    const result = readExtractedRateReply(
      reply({
        lines: [
          rline({ chargeType: 'OFR', currency: 'USD', basis: 'per_container', rate: '900.000' }),
          rline({ chargeType: 'THC', currency: 'KWD', basis: 'flat', rate: '35.000', containerType: null }),
        ],
      }),
      lookups,
      lane,
    )
    const summary = summariseRateReply(result.lines.rows, { containers: 1 })
    expect(summary.primary).toBeUndefined()
    expect(summary.totals).toHaveLength(2)
  })

  it('counts a line it cannot price rather than guessing', () => {
    const result = readExtractedRateReply(
      reply({ lines: [rline({ basis: 'percent', rate: '2.5', containerType: null })] }),
      lookups,
      lane,
    )
    // No `of` in the context, so a percent line has nothing to take a percent of.
    const summary = summariseRateReply(result.lines.rows, { containers: 1 })
    expect(summary.unpriced).toBe(1)
    expect(summary.totals).toHaveLength(0)
  })
})
