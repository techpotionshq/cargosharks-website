/**
 * The two decisions this worker makes that nothing else makes for it.
 *
 * The reading and the reconciliation are tested where they belong —
 * `core/extraction.test.ts` runs both against no infrastructure at all, which
 * is the point of them being pure. What is left here is what the worker adds:
 * **what a refusal says**, and **what gets put on the wire for a scan**.
 *
 * Both are small and both are the kind of thing that is wrong quietly. A
 * refusal that reports our own machinery instead of the supplier's figures
 * sends a coordinator to retype an invoice they could have corrected in ten
 * seconds; a PDF relabelled as an image gets read by a model that returns
 * something confident and wrong.
 *
 * The write path itself is not covered here — see the note at the end.
 */

import { describe, expect, it } from 'vitest'
import { readExtractedInvoice, reconcileInvoice, SEED_CURRENCIES } from '@qabandi/core'
import type { ImportLookups } from '@qabandi/core/import'
import { documentPart, refusalCodeFor, refusalFor } from './invoice-extract'

const KWD = SEED_CURRENCIES.find((c) => c.code === 'KWD')!

const lookups: ImportLookups = {
  currencies: new Set(['KWD', 'USD']),
  chargeTypes: new Set(['OCEAN_FREIGHT', 'THC']),
}

const line = (over: Record<string, unknown> = {}) => ({
  description: 'Ocean freight Jebel Ali to Shuwaikh',
  quantity: '2',
  unitPrice: '450.000',
  amount: '900.000',
  taxAmount: '0',
  chargeType: null,
  ...over,
})

const read = (over: Record<string, unknown> = {}) =>
  readExtractedInvoice(
    {
      invoiceNumber: 'AGT-2026-1187',
      invoiceDate: '2026-08-14',
      currency: 'KWD',
      subtotal: '900.000',
      taxAmount: '0',
      total: '900.000',
      lines: [line()],
      confidence: 0.95,
      ...over,
    },
    lookups,
  )

describe('refusalFor', () => {
  /*
    The figures, first and in full. A coordinator reading this goes straight to
    line 2 of the PDF; one reading "validation failed" opens the whole document
    and starts again.
  */
  it('leads with the arithmetic, quoting both figures', () => {
    const extracted = read({ lines: [line({ amount: '990.000' })] })
    const reason = refusalFor(extracted, reconcileInvoice(extracted, KWD))

    expect(reason).toMatch(/does not reconcile/)
    expect(reason).toMatch(/990/)
    expect(reason).toMatch(/900/)
    expect(reason).toMatch(/line 2/)
  })

  it('reports a header problem when the figures are fine', () => {
    const extracted = read({ invoiceNumber: '' })
    expect(refusalFor(extracted, [])).toMatch(/Invoice number/)
  })

  it('reports a line problem with its line number', () => {
    const extracted = read({ lines: [line({ chargeType: 'NOT-A-CODE' })] })
    const reason = refusalFor(extracted, [])

    expect(reason).toMatch(/line 2/)
    expect(reason).toMatch(/charge type/i)
  })

  /*
    Arithmetic wins over parsing when both are present. One fault, one
    sentence, pointing at the number.
  */
  it('prefers the arithmetic over a parsing complaint', () => {
    const extracted = read({ lines: [line({ amount: '990.000', chargeType: 'NOT-A-CODE' })] })
    const reason = refusalFor(extracted, reconcileInvoice(extracted, KWD))
    expect(reason).toMatch(/does not reconcile/)
    expect(reason).not.toMatch(/charge type/i)
  })

  /*
    Nothing is wrong with the reading — the model simply was not sure. Said
    plainly, because there is nothing for the coordinator to correct and the
    answer is to look at the PDF.
  */
  it('says so plainly when there is nothing to correct', () => {
    const extracted = read({ confidence: 0.2 })
    expect(refusalFor(extracted, [])).toMatch(/not confident enough/)
  })
})

/*
  The code the screen translates. Same four cases, same order: if this and
  `refusalFor` ever disagreed, the log would name one reason and the
  coordinator would read another.
*/
describe('refusalCodeFor', () => {
  it('names the arithmetic first', () => {
    const extracted = read({ lines: [line({ amount: '990.000', chargeType: 'NOT-A-CODE' })] })
    expect(refusalCodeFor(extracted, reconcileInvoice(extracted, KWD))).toBe('not_reconciled')
  })

  it('names a parse problem when the figures are fine', () => {
    expect(refusalCodeFor(read({ invoiceNumber: '' }), [])).toBe('unreadable_fields')
    expect(refusalCodeFor(read({ lines: [line({ chargeType: 'NOT-A-CODE' })] }), [])).toBe(
      'unreadable_fields',
    )
  })

  it('names low confidence when there is nothing to correct', () => {
    expect(refusalCodeFor(read({ confidence: 0.2 }), [])).toBe('low_confidence')
  })
})

describe('documentPart', () => {
  const bytes = Buffer.from('%PDF-1.7 ...')

  it('sends a PDF as a document, carrying its filename', () => {
    const part = documentPart(bytes, 'application/pdf', 'AGT-1187.pdf')

    expect(part.type).toBe('document')
    expect(part).toMatchObject({ filename: 'AGT-1187.pdf' })
    expect((part as { dataUri: string }).dataUri).toMatch(/^data:application\/pdf;base64,/)
  })

  it('sends a photographed invoice as an image', () => {
    const part = documentPart(bytes, 'image/jpeg', 'scan.jpg')
    expect(part.type).toBe('image')
    expect((part as { dataUri: string }).dataUri).toMatch(/^data:image\/jpeg;base64,/)
  })

  /*
    Refused rather than relabelled. A `.docx` invoice exists, and a model asked
    to read one as an image answers confidently about nothing.
  */
  it('refuses a type it cannot read rather than guessing', () => {
    expect(() =>
      documentPart(
        bytes,
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'bill.docx',
      ),
    ).toThrow(/PDF or an image/)
  })

  /*
    The bytes go in the body, never a link — the security property on
    `ModelContent`. Worth asserting here as well as in the adapter, because
    this is where a future change would be tempted to hand over a signed URL to
    save memory on a large scan.
  */
  it('inlines the bytes rather than referencing them', () => {
    const part = documentPart(bytes, 'application/pdf', 'x.pdf') as { dataUri: string }
    expect(part.dataUri).toContain(bytes.toString('base64'))
    expect(part.dataUri).not.toMatch(/^https?:/)
  })
})

/*
  Not covered here: the write.

  `write()` inserts a `supplier_invoices` row and its lines under the asking
  principal's actor, so what it is really exercising is RLS and the unique
  index on `(partner_id, reference)` — neither of which a mocked transaction
  can tell you anything about. It belongs in a suite gated on
  `TEST_DATABASE_URL`, beside the other database-backed worker tests, and it is
  not written yet. Stated here rather than left as an absence, because a
  missing test that nobody has named reads exactly like a covered one.
*/
