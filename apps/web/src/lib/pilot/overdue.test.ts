/**
 * Every "overdue" count matches the rows it flags — no database.
 *
 * The UI review found three screens disagreeing. The invoices register flagged
 * only `issued` invoices, so a part-paid invoice a month late was not flagged
 * while the KPI counted it. The KPI compared the due date as an instant, so it
 * also counted an invoice due today. And the payables tile said "Overdue 1"
 * while no row on the board said which. These run the tiles and the row rule
 * (`isInvoiceOverdue`, `isBillOverdue` in `core`) over the pilot dataset and
 * require the same answer.
 */

import { describe, expect, it } from 'vitest'
import { D, isBillOverdue, isInvoiceOverdue, todayIn } from '@qabandi/core'
import {
  pilotInvoiceSummary,
  pilotInvoices,
  pilotPayablesSummary,
  pilotSupplierInvoices,
} from './fixtures'
import { PAST_DUE_TONE } from '@/ui/status'

const NOW = Date.parse('2026-10-05T09:00:00Z')
const TODAY = todayIn(undefined, new Date(NOW))

const invoiceBalance = (row: ReturnType<typeof pilotInvoices>[number]) =>
  new D(row.total ?? '0').minus(row.amountPaid ?? '0').minus(row.amountCredited ?? '0')

describe('receivables overdue', () => {
  const flagged = pilotInvoices(NOW).filter((row) =>
    isInvoiceOverdue({ ...row, balance: invoiceBalance(row) }, TODAY),
  )

  it('counts exactly the invoices the register flags', () => {
    expect(pilotInvoiceSummary(NOW).overdue).toBe(flagged.length)
  })

  it('flags a part-paid invoice past its due day', () => {
    // The dataset carries one on purpose; without it this test proves nothing.
    expect(flagged.some((row) => row.status === 'part_paid')).toBe(true)
  })

  it('never flags an invoice due today', () => {
    expect(flagged.every((row) => row.dueOn !== null && row.dueOn < TODAY)).toBe(true)
  })
})

describe('payables overdue', () => {
  const flagged = pilotSupplierInvoices(NOW).filter((row) =>
    isBillOverdue({ ...row, balance: new D(row.total).minus(row.amountPaid) }, TODAY),
  )

  it('counts exactly the bills the board flags', () => {
    expect(pilotPayablesSummary(NOW).overdue).toBe(flagged.length)
  })

  it('has at least one overdue bill to flag', () => {
    expect(flagged.length).toBeGreaterThan(0)
  })
})

describe('the past-due style', () => {
  it('is the red the reply clock already uses for a breach', () => {
    expect(PAST_DUE_TONE).toBe('critical')
  })
})
