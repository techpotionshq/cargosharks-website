import { describe, expect, it } from 'vitest'
import {
  MODES,
  RATE_EXTRACTION_SCHEMA,
  rateReplyContext,
  readExtractedRateReply,
  rateReplyReview,
  replyIsRankable,
  UNCLASSIFIED_CHARGE,
  summariseRateReply,
  type RateReplyLane,
  type RawExtractedRateReply,
  type RawRateLine,
} from '../src/extraction'
import { EXTRACTABLE_FIELDS } from '../src/ai'
import { SEED_CHARGEABLE_RULES } from '../src/chargeable'
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

  /*
    ai-4. The model writes places the way the agent did — "Shanghai",
    "Shuwaikh" — and comparing that text with our codes flagged correct replies
    as a different lane, which drops them from ranking and auto-award. Names
    are resolved through `locations` first (the caller passes what they
    resolved to), and only a resolvable difference is a mismatch.
  */
  describe('the lane a reply names', () => {
    const asked: RateReplyLane = {
      mode: 'sea_fcl',
      originCode: 'CNSHA',
      destinationCode: 'KWSWK',
      places: {
        shanghai: ['CNSHA'],
        shuwaikh: ['KWSWK'],
        'ميناء الشويخ': ['KWSWK'],
        'jebel ali, uae': ['AEJEA'],
        ningbo: ['CNNGB'],
      },
    }

    it('accepts place names that resolve to the ports we asked about', () => {
      const result = readExtractedRateReply(
        reply({ origin: 'Shanghai', destination: 'Shuwaikh' }),
        lookups,
        asked,
      )
      expect(result.laneMismatch).toBeUndefined()
      expect(result.headerIssues).toEqual([])
    })

    it('accepts an Arabic name and a code written in lower case with a space', () => {
      const result = readExtractedRateReply(
        reply({ origin: 'cn sha', destination: 'ميناء الشويخ' }),
        lookups,
        asked,
      )
      expect(result.laneMismatch).toBeUndefined()
    })

    it('flags a name that resolves to a different port', () => {
      const result = readExtractedRateReply(
        reply({ origin: 'Ningbo', destination: 'Shuwaikh' }),
        lookups,
        asked,
      )
      expect(result.laneMismatch).toContain('Ningbo')
      expect(result.laneMismatch).toContain('CNSHA')
    })

    it('flags a different code even when no name was resolved', () => {
      const result = readExtractedRateReply(
        reply({ origin: 'CNSHA', destination: 'AEJEA' }),
        lookups,
        asked,
      )
      expect(result.laneMismatch).toBeDefined()
    })

    /* Live run 6 (N6): the model echoes our subject's "Name (CODE)" form. */
    it('reads the code in "Name (CODE)" and raises no place warning for it', () => {
      const ours = readExtractedRateReply(
        reply({ origin: 'Shanghai (CNSHA)', destination: 'Shuwaikh (KW SWK)' }),
        lookups,
        asked,
      )
      expect(ours.laneMismatch).toBeUndefined()
      expect(ours.headerIssues).toEqual([])

      const other = readExtractedRateReply(
        reply({ origin: 'Ningbo (CNNGB)', destination: 'Shuwaikh (KWSWK)' }),
        lookups,
        asked,
      )
      expect(other.laneMismatch).toContain('Ningbo (CNNGB)')
      expect(other.headerIssues).toEqual([])
    })

    it('reports a name it cannot resolve without calling it a mismatch', () => {
      const result = readExtractedRateReply(
        reply({ origin: 'Dubai', destination: 'Shuwaikh' }),
        lookups,
        asked,
      )
      expect(result.laneMismatch).toBeUndefined()
      expect(result.headerIssues.join(' ')).toContain('Dubai')
    })
  })

  it('refuses a charge code we do not hold', () => {
    const result = readExtractedRateReply(
      reply({ lines: [rline({ chargeType: 'BRIBE' })] }),
      lookups,
      lane,
    )
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
          rline({
            chargeType: 'THC',
            currency: 'KWD',
            basis: 'flat',
            rate: '35.000',
            containerType: null,
          }),
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

describe('rateReplyContext', () => {
  const rule = (mode: string) => SEED_CHARGEABLE_RULES.find((r) => r.mode === mode)!

  /**
   * N1, the run's own reply: "EUR 62 per cbm W/M, EUR 18 per cbm, EUR 40 per
   * shipment" on 8 cbm / 6 pallets was totalled on the pallets at EUR 520.
   */
  it('prices an LCL reply on the volume, not the pallets', () => {
    const lcl: RateReplyLane = { mode: 'sea_lcl', originCode: 'AEJEA', destinationCode: 'KWSWK' }
    const result = readExtractedRateReply(
      reply({
        currency: 'EUR',
        mode: 'sea_lcl',
        lines: [
          rline({ basis: 'per_wm', rate: '62', containerType: null }),
          rline({ chargeType: 'THC', basis: 'per_cbm', rate: '18', containerType: null }),
          rline({ chargeType: 'DOC', basis: 'flat', rate: '40', containerType: null }),
        ],
      }),
      { ...lookups, currencies: new Set(['EUR', 'KWD']) },
      lcl,
    )
    const ctx = rateReplyContext(
      {
        mode: 'sea_lcl',
        grossWeightKg: '2400',
        volumeCbm: '8.000',
        pieces: 6,
        containerCount: null,
      },
      rule('sea_lcl'),
    )
    const summary = summariseRateReply(result.lines.rows, ctx)
    expect(summary.unpriced).toBe(0)
    expect(summary.primary?.amount.amount.toString()).toBe('680')
  })

  /**
   * N3: 336 kg gross in 2.28 cbm is 380 kg chargeable at the air divisor, and
   * pricing strikes the quote on 380. The comparison ranked it on 336.
   */
  it('weighs an air reply at the chargeable weight pricing uses', () => {
    const e = {
      mode: 'air',
      grossWeightKg: '336',
      volumeCbm: '2.28',
      pieces: 4,
      containerCount: null,
    }
    expect(rateReplyContext(e, rule('air')).kg?.toString()).toBe('380')
    // A branch rule that is heavier per cbm, as an airline may agree, moves it.
    const divisor5000 = { ...rule('air'), divisorCm3PerKg: rule('courier').divisorCm3PerKg }
    expect(rateReplyContext(e, divisor5000).kg?.toString()).toBe('456')
    // With no rule loaded, the gross stands rather than a guessed divisor.
    expect(rateReplyContext(e).kg?.toString()).toBe('336')
  })
})

/*
  R1, live run 5. EK quoted "Air freight USD 3.60 per kg chargeable (minimum
  USD 150) / Fuel surcharge USD 0.55 per kg / Screening and handling USD 40 per
  shipment" on 380 kg chargeable: USD 1,617. The model returned the USD 40 line
  with no charge type, the line was rejected, and the reply ranked Cheapest at
  1,577 with nothing on screen to say a line had gone.
*/
describe('a priced line the model cannot classify (R1)', () => {
  const airLane: RateReplyLane = { mode: 'air', originCode: 'AEJEA', destinationCode: 'KWSWK' }
  const withOther: ImportLookups = {
    ...lookups,
    chargeTypes: new Set(['AIR_FREIGHT', 'FUEL_SURCHARGE', UNCLASSIFIED_CHARGE.toUpperCase()]),
  }
  const ek = (over: Partial<RawExtractedRateReply> = {}) =>
    reply({
      origin: null,
      destination: null,
      mode: 'air',
      lines: [
        rline({
          chargeType: 'air_freight',
          basis: 'per_kg',
          rate: '3.60',
          minimum: '150',
          containerType: null,
          description: 'Air freight',
        }),
        rline({
          chargeType: 'fuel_surcharge',
          basis: 'per_kg',
          rate: '0.55',
          containerType: null,
          description: 'Fuel surcharge',
        }),
        rline({
          chargeType: null,
          basis: 'flat',
          rate: '40',
          containerType: null,
          description: 'Screening and handling',
        }),
      ],
      ...over,
    })

  /** What `rate-extract.ts` stores, reduced to the fields the review reads. */
  const stored = (raw: RawExtractedRateReply, lk: ImportLookups) => {
    const result = readExtractedRateReply(raw, lk, airLane)
    const summary = summariseRateReply(result.lines.rows, { kg: '380', days: 1 })
    return {
      result,
      summary,
      response: {
        ok: result.lines.ok,
        issues: result.lines.issues,
        currency: result.currency,
        unclassified: result.unclassified,
        statedTotal: result.statedTotal,
        totals: summary.totals.map((t) => ({
          currency: t.currency,
          amount: t.amount.amount.toString(),
        })),
      },
    }
  }

  it('keeps the line as "other", so the total is the whole 1,617', () => {
    const { result, summary, response } = stored(ek(), withOther)
    expect(result.lines.ok).toBe(true)
    expect(result.lines.rows).toHaveLength(3)
    expect(result.lines.rows[2]!.values.chargeCode).toBe(UNCLASSIFIED_CHARGE.toUpperCase())
    expect(result.unclassified).toEqual([{ line: 3, description: 'Screening and handling' }])
    expect(summary.primary?.amount.amount.toFixed(2)).toBe('1617.00')

    /*
      Flagged for a person, naming the line. The figure is whole and shown as
      it stands, but not ranked: "Cheapest" on a reply with an unnamed charge
      in it was a recommendation nobody had checked (live run 6).
    */
    const review = rateReplyReview(response)
    expect(review.needed).toBe(true)
    expect(review.ranked).toBe(false)
    expect(review.unclassified[0]!.description).toBe('Screening and handling')
  })

  /*
    Live run 6: the model wrote "OTHER" itself. It passed as a code we hold,
    so no review note appeared, the reply ranked Cheapest, and "Make rate card"
    wrote a card with an unnamed line.
  */
  it('treats a line the model itself coded "other" as unclassified', () => {
    const coded = ek({
      lines: [
        ...(ek().lines as RawRateLine[]).slice(0, 2),
        rline({
          chargeType: 'OTHER',
          basis: 'flat',
          rate: '40',
          containerType: null,
          description: 'Screening and handling',
        }),
        rline({
          chargeType: 'other',
          basis: 'flat',
          rate: '15',
          containerType: null,
          description: null,
        }),
      ],
    })
    const { result, response } = stored(coded, withOther)
    expect(result.lines.ok).toBe(true)
    // "OTHER" is not a name to quote back; the line number stands in for it.
    expect(result.unclassified).toEqual([
      { line: 3, description: 'Screening and handling' },
      { line: 4, description: '' },
    ])
    const review = rateReplyReview(response)
    expect(review.needed).toBe(true)
    expect(review.ranked).toBe(false)
  })

  it('reads an "other" row stored with no unclassified list as unclassified', () => {
    const review = rateReplyReview({
      ok: true,
      issues: [],
      rows: [{ chargeCode: 'AIR_FREIGHT' }, { chargeCode: 'OTHER' }],
      totals: [{ currency: 'USD', amount: '10' }],
    })
    expect(review.needed).toBe(true)
    expect(review.ranked).toBe(false)
    expect(review.unclassified).toEqual([{ line: 2, description: '' }])
  })

  it('keeps a code the deployment does not hold the same way, naming what the model wrote', () => {
    const { result } = stored(
      ek({
        lines: [
          rline({
            chargeType: 'SCREENING',
            basis: 'flat',
            rate: '40',
            containerType: null,
            description: null,
          }),
        ],
      }),
      withOther,
    )
    expect(result.lines.rows[0]!.values.chargeCode).toBe(UNCLASSIFIED_CHARGE.toUpperCase())
    expect(result.unclassified).toEqual([{ line: 1, description: 'SCREENING' }])
  })

  it('without an "other" row, rejects the line and keeps the reply out of the ranking', () => {
    const noOther: ImportLookups = {
      ...withOther,
      chargeTypes: new Set(['AIR_FREIGHT', 'FUEL_SURCHARGE']),
    }
    const { result, summary, response } = stored(ek(), noOther)
    expect(result.lines.ok).toBe(false)
    expect(summary.primary?.amount.amount.toFixed(2)).toBe('1577.00')
    const review = rateReplyReview(response)
    expect(review.rejected).toBe(1)
    expect(review.ranked).toBe(false)
    expect(replyIsRankable(response)).toBe(false)
  })

  it('accepts a stated total that matches the lines at the precision printed', () => {
    const { response } = stored(ek({ statedTotal: '1,617.00' }), withOther)
    expect(rateReplyReview(response).totalMismatch).toBeNull()
  })

  it('flags a stated total the lines do not reach, and does not rank it', () => {
    // The model dropped the screening line outright: the lines say 1,577.
    const dropped = ek({ statedTotal: '1617.00', lines: (ek().lines as RawRateLine[]).slice(0, 2) })
    const { response } = stored(dropped, withOther)
    const review = rateReplyReview(response)
    expect(review.totalMismatch).toEqual({ currency: 'USD', stated: '1617', computed: '1577' })
    expect(review.needed).toBe(true)
    expect(review.ranked).toBe(false)
  })

  it('reads a reply stored before any of this as clean', () => {
    const review = rateReplyReview({
      ok: true,
      issues: [],
      totals: [{ currency: 'USD', amount: '10' }],
    })
    expect(review).toEqual({
      needed: false,
      ranked: true,
      unclassified: [],
      rejected: 0,
      totalMismatch: null,
    })
  })
})
