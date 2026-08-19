/**
 * Job P&L from the charge ledger — FR-FN-04, and the floor in FR-FN-05.
 *
 * The case worth stating plainly is the unpriced job: a shipment booked this
 * morning has costs and no revenue, and every naive margin calculation either
 * divides by zero or reports minus one hundred per cent. Neither is what an
 * operations manager should be shown, and neither should trip the approval
 * gate.
 */

import { describe, expect, it } from 'vitest'
import {
  belowFloor,
  emptyLedgerMargin,
  jobMargin,
  money,
  toScale,
  varianceOf,
  variancePercent,
  type LedgerLine,
} from '../src/index'

const cost = (amountBase: string, isAccrual = false): LedgerLine => ({
  direction: 'cost',
  amountBase,
  isAccrual,
})
const revenue = (amountBase: string): LedgerLine => ({ direction: 'revenue', amountBase })

const kwd = (v: string) => money(v, 'KWD')

describe('the job P&L', () => {
  it('sums both sides and gives the gross and the percentage', () => {
    const margin = jobMargin([revenue('1000.000'), cost('700.000'), cost('50.000')], 'KWD')

    expect(toScale(margin.revenue)).toBe('1000.000')
    expect(toScale(margin.cost)).toBe('750.000')
    expect(toScale(margin.gross)).toBe('250.000')
    expect(margin.grossPercent?.toFixed(1)).toBe('25.0')
  })

  it('separates what is accrued from what a supplier has actually billed', () => {
    const margin = jobMargin(
      [revenue('1000.000'), cost('600.000', true), cost('150.000', false)],
      'KWD',
    )

    expect(toScale(margin.accruedCost)).toBe('600.000')
    expect(toScale(margin.billedCost)).toBe('150.000')
    expect(toScale(margin.cost)).toBe('750.000')
  })

  it('counts an accrual as a real cost — excluding it would flatter every live job', () => {
    const margin = jobMargin([revenue('1000.000'), cost('900.000', true)], 'KWD')
    expect(toScale(margin.gross)).toBe('100.000')
  })

  it('has no percentage on a job nobody has priced yet', () => {
    const margin = jobMargin([cost('700.000', true)], 'KWD')
    expect(toScale(margin.gross)).toBe('-700.000')
    expect(margin.grossPercent).toBeNull()
  })

  it('reads an empty ledger as zero rather than as a loss', () => {
    const margin = emptyLedgerMargin('KWD')
    expect(toScale(margin.cost)).toBe('0.000')
    expect(margin.grossPercent).toBeNull()
  })

  it('keeps three decimals — a KWD margin rounded to two is wrong by a fils a line', () => {
    const margin = jobMargin([revenue('8.700'), cost('8.600')], 'KWD')
    expect(toScale(margin.gross)).toBe('0.100')
  })
})

describe('the margin floor', () => {
  const priced = jobMargin([revenue('1000.000'), cost('900.000')], 'KWD')

  it('holds an invoice below the floor', () => {
    expect(belowFloor(priced, '15')).toBe(true)
  })

  it('lets one through at the floor exactly', () => {
    expect(belowFloor(priced, '10')).toBe(false)
  })

  it('does nothing where no floor is configured', () => {
    expect(belowFloor(priced, null)).toBe(false)
  })

  /*
    A booked-but-unpriced job is not a margin failure, it is a job that has not
    been priced. Blocking it would fill the approval queue with every shipment
    booked that morning, and a queue nobody can clear is a queue nobody reads.
  */
  it('does not hold a job that has no revenue yet', () => {
    expect(belowFloor(jobMargin([cost('700.000', true)], 'KWD'), '15')).toBe(false)
  })
})

describe('estimate against actual', () => {
  it('reads positive as the direction that costs money', () => {
    expect(toScale(varianceOf(kwd('400.000'), kwd('460.000')))).toBe('60.000')
    expect(variancePercent(kwd('400.000'), kwd('460.000'))?.toFixed(1)).toBe('15.0')
  })

  it('has no percentage against an estimate of nothing', () => {
    expect(variancePercent(kwd('0'), kwd('75.000'))).toBeNull()
  })
})
