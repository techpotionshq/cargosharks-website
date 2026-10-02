/**
 * The search box finds the references people hold — U4.
 *
 * It looked only at jobs, containers and customers, so an enquiry, quote,
 * invoice or consolidation reference, or a consolidation's master bill,
 * answered "Nothing matches" under a placeholder that said "Reference".
 *
 * Run against the pilot fixtures, which keep the same promise without a
 * database, so the assertion is about which kinds of record are searched.
 */

import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/pilot/source', () => ({ usePilotFixtures: () => true }))

const { search, recordHref } = await import('./queries')
const { pilotConsolidations, pilotEnquiries, pilotInvoices, pilotQuotes } =
  await import('@/lib/pilot/fixtures')

const actor = { principalId: 'p', type: 'internal' as const, branchIds: [] }

describe('searching for a record by its own reference', () => {
  it('finds an enquiry', async () => {
    const enquiry = pilotEnquiries()[0]!
    const results = await search(actor, enquiry.reference)
    expect(results.records).toContainEqual(
      expect.objectContaining({ kind: 'enquiry', id: enquiry.id }),
    )
  })

  it('finds a quotation', async () => {
    const quote = pilotQuotes()[0]!
    const results = await search(actor, quote.reference)
    expect(results.records.some((r) => r.kind === 'quote' && r.id === quote.id)).toBe(true)
  })

  it('finds an issued invoice by its number', async () => {
    const invoice = pilotInvoices().find((row) => row.seriesNo)!
    const results = await search(actor, invoice.seriesNo!)
    expect(results.records.some((r) => r.kind === 'invoice' && r.id === invoice.id)).toBe(true)
  })

  it('finds a consolidation by its reference and by its master bill, saying which', async () => {
    const consolidation = pilotConsolidations().find((row) => row.masterBillNumber)!
    const byReference = await search(actor, consolidation.reference)
    expect(byReference.records.some((r) => r.id === consolidation.id)).toBe(true)

    const byBill = await search(actor, consolidation.masterBillNumber!)
    const hit = byBill.records.find((r) => r.id === consolidation.id)
    expect(hit?.matchedValue).toBe(consolidation.masterBillNumber)
  })

  it('opens each kind on its own detail page', () => {
    expect(recordHref('enquiry', 'e1')).toBe('/enquiries/e1')
    expect(recordHref('quote', 'q1')).toBe('/quotes/q1')
    expect(recordHref('invoice', 'i1')).toBe('/invoices/i1')
    expect(recordHref('consolidation', 'c1')).toBe('/consolidations/c1')
  })
})
