/**
 * A job-billed invoice's note, stored once and said in each reader's language
 * (NEW-6). Typed notes stay exactly as typed.
 */

import { describe, expect, it } from 'vitest'
import { billedFromNote, readInvoiceNote } from '../src/invoice-note'

describe('an invoice note', () => {
  it('reads the stored job note back as the job it was billed from', () => {
    expect(readInvoiceNote(billedFromNote('KWI-JOB-2026-00001'))).toEqual({
      kind: 'billedFrom',
      reference: 'KWI-JOB-2026-00001',
    })
  })

  it('recognises the Arabic form earlier drafts stored', () => {
    expect(readInvoiceNote('مفوترة من KWI-JOB-2026-00001')).toEqual({
      kind: 'billedFrom',
      reference: 'KWI-JOB-2026-00001',
    })
  })

  it('leaves a typed note, or one a person extended, as text', () => {
    expect(readInvoiceNote('Billed from KWI-JOB-2026-00001, second leg to follow')).toEqual({
      kind: 'text',
      text: 'Billed from KWI-JOB-2026-00001, second leg to follow',
    })
    expect(readInvoiceNote('  ')).toBeNull()
    expect(readInvoiceNote(null)).toBeNull()
  })
})
