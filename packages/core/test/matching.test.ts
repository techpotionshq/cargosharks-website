/**
 * Cost verification — the arithmetic behind FR-FN-09.
 *
 * The cases that matter are the asymmetric ones. A supplier line has a hard
 * ceiling and a charge line deliberately does not, and a reviewer coming to
 * this module from `settlement.ts` will expect the symmetry that is not there.
 * The block named for it is the guard against somebody "fixing" that.
 */

import { describe, expect, it } from 'vitest'
import {
  EXACT,
  MatchingError,
  againstQuote,
  checkMatch,
  compareToAccrual,
  matchPositionFromDb,
  money,
  resolveTolerance,
  summariseInvoice,
  toScale,
  tolerance,
  unmatched,
  type CurrencySpec,
} from '../src/index'

const KWD: CurrencySpec = { code: 'KWD', minorUnits: 3 }
const USD: CurrencySpec = { code: 'USD', minorUnits: 2 }

const kwd = (v: string) => money(v, 'KWD')

describe('comparing a bill with an accrual', () => {
  it('calls an exact agreement exact, and asks nobody to look at it', () => {
    const outcome = compareToAccrual(kwd('420.000'), kwd('420.000'), EXACT, KWD)
    expect(outcome.verdict).toBe('exact')
    expect(outcome.needsReview).toBe(false)
    expect(toScale(outcome.variance)).toBe('0.000')
  })

  it('flags an agent billing over, with the variance and the percentage', () => {
    const outcome = compareToAccrual(kwd('400.000'), kwd('460.000'), EXACT, KWD)
    expect(outcome.verdict).toBe('over')
    expect(outcome.needsReview).toBe(true)
    expect(toScale(outcome.variance)).toBe('60.000')
    expect(outcome.variancePercent?.toFixed(1)).toBe('15.0')
  })

  it('separates under from over, because the next action differs', () => {
    const outcome = compareToAccrual(kwd('400.000'), kwd('380.000'), EXACT, KWD)
    expect(outcome.verdict).toBe('under')
    expect(toScale(outcome.variance)).toBe('-20.000')
  })

  it('names a cost nobody has billed for, and does not treat it as a variance to chase', () => {
    const outcome = compareToAccrual(kwd('120.000'), kwd('0'), EXACT, KWD)
    expect(outcome.verdict).toBe('unbilled')
    expect(outcome.needsReview).toBe(false)
  })

  it('has no percentage where nothing was accrued — a charge we never expected', () => {
    const outcome = compareToAccrual(kwd('0'), kwd('75.000'), EXACT, KWD)
    expect(outcome.verdict).toBe('over')
    expect(outcome.variancePercent).toBeNull()
  })
})

describe('tolerance', () => {
  it('waves through a drift inside the percentage', () => {
    const outcome = compareToAccrual(kwd('400.000'), kwd('401.500'), tolerance('0.5', '0'), KWD)
    expect(outcome.verdict).toBe('within_tolerance')
    expect(toScale(outcome.allowed)).toBe('2.000')
  })

  it('takes whichever limit is the more generous', () => {
    // 0.5% of 2.000 is 0.010; the absolute limit of 5.000 is what applies.
    const outcome = compareToAccrual(kwd('2.000'), kwd('6.000'), tolerance('0.5', '5'), KWD)
    expect(outcome.verdict).toBe('within_tolerance')
    expect(toScale(outcome.allowed)).toBe('5.000')
  })

  it('still escalates once both limits are passed', () => {
    const outcome = compareToAccrual(kwd('400.000'), kwd('410.000'), tolerance('0.5', '5'), KWD)
    expect(outcome.verdict).toBe('over')
  })

  it('rounds the allowance to the currency, not to two places', () => {
    // 0.25% of 100.000 KWD is 0.250 — three decimals, and a fils is a real
    // amount here. A global toFixed(2) would allow 0.25 and refuse 0.253.
    const outcome = compareToAccrual(kwd('100.000'), kwd('100.250'), tolerance('0.25', '0'), KWD)
    expect(toScale(outcome.allowed)).toBe('0.250')
    expect(outcome.verdict).toBe('within_tolerance')
  })

  it('lets a partner override the charge type, and treats a blank row as no override', () => {
    const ct = tolerance('0.5', '5')
    expect(resolveTolerance(ct, tolerance('2', '0')).percent.toString()).toBe('2')
    expect(resolveTolerance(ct, tolerance('0', '0')).percent.toString()).toBe('0.5')
    expect(resolveTolerance(ct, null).absolute.toString()).toBe('5')
  })

  it('holds everyone to the figure when nothing is configured at all', () => {
    expect(resolveTolerance(null, null)).toBe(EXACT)
  })
})

describe('the one ceiling', () => {
  it('allows a match up to what was billed, inclusive', () => {
    expect(checkMatch('420.000', { billed: '420.000', matched: '0' }, 'KWD')).toEqual({ ok: true })
  })

  it('refuses to match more of a supplier line than the supplier billed', () => {
    const verdict = checkMatch('100.000', { billed: '420.000', matched: '350.000' }, 'KWD')
    expect(verdict.ok).toBe(false)
    if (verdict.ok) return
    expect(verdict.reason).toBe('over_billed')
    expect(toScale(verdict.available)).toBe('70.000')
  })

  it('refuses a zero or negative match', () => {
    expect(() => checkMatch('0', { billed: '10', matched: '0' }, 'KWD')).toThrow(MatchingError)
    expect(() => checkMatch('-5', { billed: '10', matched: '0' }, 'KWD')).toThrow(MatchingError)
  })

  it('reads an absent sum as zero — the first match against a line', () => {
    const position = matchPositionFromDb({ billed: '420.000000', matched: null }, 'KWD')
    expect(toScale(unmatched(position, 'KWD'))).toBe('420.000')
  })

  /*
    The asymmetry, stated as a test so that nobody restores the symmetry.

    A charge line that accrued 400 being matched by a bill of 460 is the event
    the module exists to detect. If matching ever grows a second ceiling on the
    accrual side, this passes as an over-variance and that one fails — which is
    the failure worth having.
  */
  it('lets a bill exceed the accrual, because that is the finding', () => {
    expect(checkMatch('460.000', { billed: '460.000', matched: '0' }, 'KWD')).toEqual({ ok: true })
    const outcome = compareToAccrual(kwd('400.000'), kwd('460.000'), EXACT, KWD)
    expect(outcome.verdict).toBe('over')
  })
})

describe('the invoice as a whole', () => {
  const line = (id: string, billed: string, accrued: string, matchCount = 1) => ({
    id,
    description: id,
    billed,
    accrued,
    matchCount,
    tolerance: EXACT,
  })

  it('judges line by line rather than on the totals', () => {
    // +200 on freight, -200 on haulage: a net of zero and two arguments.
    const summary = summariseInvoice(
      [line('freight', '1200.00', '1000.00'), line('haulage', '300.00', '500.00')],
      'USD',
      USD,
    )
    expect(toScale(summary.variance)).toBe('0.00')
    expect(summary.review).toEqual(['freight', 'haulage'])
    expect(summary.clean).toBe(false)
  })

  it('is clean only when every line agrees and every line is matched', () => {
    const summary = summariseInvoice([line('freight', '1000.00', '1000.00')], 'USD', USD)
    expect(summary.clean).toBe(true)
  })

  it('is not clean while a line is matched to nothing, even at zero variance', () => {
    const summary = summariseInvoice([line('handling', '0.00', '0.00', 0)], 'USD', USD)
    expect(summary.review).toEqual([])
    expect(summary.unmatchedLines).toEqual(['handling'])
    expect(summary.clean).toBe(false)
  })

  it('totals both sides so the header can show the argument in one figure', () => {
    const summary = summariseInvoice(
      [line('freight', '1200.00', '1000.00'), line('thc', '150.00', '150.00')],
      'USD',
      USD,
    )
    expect(toScale(summary.billedTotal)).toBe('1350.00')
    expect(toScale(summary.accruedTotal)).toBe('1150.00')
    expect(toScale(summary.variance)).toBe('200.00')
  })
})

describe('against the quote', () => {
  it('is the evidence, and is absent where nothing was ever quoted', () => {
    expect(againstQuote(null, kwd('75.000'), EXACT, KWD)).toBeNull()

    const outcome = againstQuote(kwd('400.000'), kwd('460.000'), EXACT, KWD)
    expect(outcome?.verdict).toBe('over')
    expect(toScale(outcome!.variance)).toBe('60.000')
  })
})

describe('precision', () => {
  /*
    The same class of failure `settlement.ts` was written for.

    An accrual of 8.700 KWD billed at 8.600 leaves 0.100 exactly. By float
    arithmetic it leaves 0.09999999999999964, which is inside a 0.1 tolerance
    by a hair and outside it by another — so the same invoice would pass or
    fail depending on which way the wind blew.
  */
  it('settles a three-decimal difference exactly', () => {
    const outcome = compareToAccrual(kwd('8.700'), kwd('8.600'), tolerance('0', '0.1'), KWD)
    expect(toScale(outcome.variance)).toBe('-0.100')
    expect(outcome.verdict).toBe('within_tolerance')
  })

  it('does not let a fils slip past a zero tolerance', () => {
    const outcome = compareToAccrual(kwd('8.700'), kwd('8.699'), EXACT, KWD)
    expect(outcome.verdict).toBe('under')
    expect(toScale(outcome.variance)).toBe('-0.001')
  })
})
