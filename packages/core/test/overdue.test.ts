import { describe, expect, it } from 'vitest'
import {
  D,
  OWED_BILL_STATUSES,
  OWED_INVOICE_STATUSES,
  isBillOverdue,
  isInvoiceOverdue,
  isPastDay,
} from '../src/index'

const TODAY = '2026-10-05'

/**
 * The case that started it: half paid, a month late. The invoices register
 * read only `issued` and said nothing, while the KPI and the portal said
 * overdue. Every screen now asks this one function.
 */
describe('isInvoiceOverdue', () => {
  const base = { status: 'issued', dueOn: '2026-09-01', balance: '120.500' }

  it('flags a part-paid invoice past its due day', () => {
    expect(isInvoiceOverdue({ ...base, status: 'part_paid', balance: '60.250' }, TODAY)).toBe(true)
  })

  it('flags an issued invoice past its due day', () => {
    expect(isInvoiceOverdue(base, TODAY)).toBe(true)
  })

  it('is not late on the last day of terms', () => {
    expect(isInvoiceOverdue({ ...base, dueOn: TODAY }, TODAY)).toBe(false)
    expect(isInvoiceOverdue({ ...base, dueOn: '2026-10-04' }, TODAY)).toBe(true)
  })

  it('is never late for a settled, credited, voided, draft or approved invoice', () => {
    for (const status of ['paid', 'credited', 'void', 'draft', 'approved']) {
      expect(isInvoiceOverdue({ ...base, status }, TODAY)).toBe(false)
    }
  })

  it('reads the balance as a Decimal, so a zero string is not owing', () => {
    expect(isInvoiceOverdue({ ...base, balance: '0.000000' }, TODAY)).toBe(false)
    expect(isInvoiceOverdue({ ...base, balance: '-5.000' }, TODAY)).toBe(false)
    // One fils, the smallest KWD amount, is still owed.
    expect(isInvoiceOverdue({ ...base, balance: '0.001' }, TODAY)).toBe(true)
    expect(isInvoiceOverdue({ ...base, balance: new D('0.001') }, TODAY)).toBe(true)
  })

  it('never flags a credit note or an invoice with no due day', () => {
    expect(isInvoiceOverdue({ ...base, isCreditNote: true }, TODAY)).toBe(false)
    expect(isInvoiceOverdue({ ...base, dueOn: null }, TODAY)).toBe(false)
  })

  it('reads a timestamp due date to its day', () => {
    expect(isInvoiceOverdue({ ...base, dueOn: '2026-10-05T00:00:00.000Z' }, TODAY)).toBe(false)
    expect(isInvoiceOverdue({ ...base, dueOn: '2026-10-04T23:59:59.000Z' }, TODAY)).toBe(true)
  })
})

describe('isBillOverdue', () => {
  const bill = { status: 'approved', dueOn: '2026-09-20', balance: '400.000' }

  it('flags received, approved and part-paid bills past their due day', () => {
    for (const status of ['received', 'approved', 'part_paid']) {
      expect(isBillOverdue({ ...bill, status }, TODAY)).toBe(true)
    }
  })

  it('does not flag a paid, disputed or voided bill', () => {
    for (const status of ['paid', 'disputed', 'void']) {
      expect(isBillOverdue({ ...bill, status }, TODAY)).toBe(false)
    }
  })
})

describe('status lists', () => {
  it('include part paid on both sides, which is the state that was missed', () => {
    expect(OWED_INVOICE_STATUSES).toContain('part_paid')
    expect(OWED_BILL_STATUSES).toContain('part_paid')
  })
})

describe('isPastDay', () => {
  it('compares calendar days', () => {
    expect(isPastDay('2026-10-04', TODAY)).toBe(true)
    expect(isPastDay(TODAY, TODAY)).toBe(false)
    expect(isPastDay(null, TODAY)).toBe(false)
  })
})
