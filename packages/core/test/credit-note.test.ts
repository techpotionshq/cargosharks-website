/**
 * Partial credit notes — F9. The note is the invoice's lines scaled to the
 * amount credited, so the export reverses revenue on the right accounts; what
 * matters is that it sums exactly, never exceeds what is owed, and respects
 * the currency's precision.
 */

import { describe, expect, it } from 'vitest'
import { creditableAmount, dec, planCreditNote, type CreditableInvoice } from '../src/index'

const KWD = { code: 'KWD', minorUnits: 3 }
const AED = { code: 'AED', minorUnits: 2 }

// 300 + 700 net, 5% on the second: 1035 gross.
const invoice = (patch: Partial<CreditableInvoice> = {}): CreditableInvoice => ({
  subtotal: '1000.000',
  taxAmount: '35.000',
  total: '1035.000',
  amountPaid: '0',
  amountCredited: '0',
  lines: [
    { amount: '300.000', taxAmount: '0' },
    { amount: '700.000', taxAmount: '35.000' },
  ],
  ...patch,
})

describe('creditableAmount', () => {
  it('is what is still owed, never below zero', () => {
    expect(creditableAmount(invoice()).toFixed(3)).toBe('1035.000')
    expect(creditableAmount(invoice({ amountPaid: '400', amountCredited: '100' })).toFixed(3)).toBe(
      '535.000',
    )
    // Credited in full before payments were netted from the ceiling.
    expect(creditableAmount(invoice({ amountPaid: '100', amountCredited: '1035' })).toFixed()).toBe(
      '0',
    )
  })
})

describe('planCreditNote', () => {
  it('reproduces the invoice exactly when the whole of it is credited', () => {
    const result = planCreditNote(invoice(), '1035.000', KWD)
    if (!result.ok) throw new Error(result.reason)
    expect(result.plan.lines).toEqual([
      { amount: '300', taxAmount: '0' },
      { amount: '700', taxAmount: '35' },
    ])
    expect(result.plan.closes).toBe(true)
  })

  it('scales every line by one ratio and sums to the amount to the last fils', () => {
    const result = planCreditNote(invoice(), '100.000', KWD)
    if (!result.ok) throw new Error(result.reason)
    // 100/1035 of each figure, rounded to three places; the residual lands
    // on the largest net line, never on the tax.
    expect(result.plan.lines[1]!.taxAmount).toBe('3.382')
    expect(result.plan.total).toBe('100')
    const sum = result.plan.lines.reduce(
      (acc, l) => acc.plus(dec(l.amount)).plus(dec(l.taxAmount)),
      dec(0),
    )
    expect(sum.toFixed(3)).toBe('100.000')
    expect(result.plan.subtotal).toBe('96.618')
    expect(result.plan.taxAmount).toBe('3.382')
    expect(result.plan.closes).toBe(false)
  })

  it('says it closes the invoice when it credits exactly what is still owed', () => {
    const result = planCreditNote(invoice({ amountPaid: '35' }), '1000', KWD)
    expect(result.ok && result.plan.closes).toBe(true)
  })

  it('refuses more than is owed, nothing, and more places than the currency has', () => {
    expect(planCreditNote(invoice({ amountPaid: '1000' }), '35.001', KWD)).toEqual({
      ok: false,
      reason: 'exceeds_creditable',
      creditable: '35.000',
    })
    expect(planCreditNote(invoice(), '0', KWD)).toMatchObject({ reason: 'not_positive' })
    expect(planCreditNote(invoice(), '10.005', AED)).toMatchObject({ reason: 'too_precise' })
  })

  it('splits a header with no lines in the same proportion', () => {
    const result = planCreditNote(invoice({ lines: [] }), '103.500', KWD)
    if (!result.ok) throw new Error(result.reason)
    expect(result.plan.lines).toEqual([])
    expect(result.plan.taxAmount).toBe('3.5')
    expect(result.plan.subtotal).toBe('100')
  })
})
