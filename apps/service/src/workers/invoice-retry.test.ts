/**
 * "Read as a bill" after a refusal (D1, R2), and a bill with no printed total.
 *
 * The automatic read on arrival is answered from the ledger on every later
 * read of the same scan, which is right for a reading that worked and wrong
 * for one that was refused: the person pressing "Read as a bill" was shown the
 * same refusal each time and no model was asked. D1 made a retry ask afresh
 * only when the cached answer did not parse; live run 5's EK bill parsed and
 * lacked only its total, so "Read as a bill" still never asked (R2). A retry
 * now always asks the model again.
 *
 * The model and the file store are replaced; the asset and the bill are real.
 */

import { randomUUID } from 'node:crypto'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import type { Actor } from '@qabandi/db'

const APP_URL = process.env.TEST_DATABASE_URL
const enabled = Boolean(APP_URL)
if (APP_URL) process.env.DATABASE_URL = APP_URL

const RUN = Date.now().toString(36).toUpperCase().slice(-5)
const NUMBER = `RTY-${RUN}-1`

vi.mock('../adapters/index', () => ({
  fileStore: async () => ({ get: async () => Buffer.from('%PDF-1.4 a bill') }),
}))

const bill = (invoiceDate: string, invoiceNumber = NUMBER) =>
  JSON.stringify({
    invoiceNumber,
    invoiceDate,
    dueOn: null,
    currency: 'KWD',
    subtotal: '250.000',
    taxAmount: '0',
    total: '250.000',
    lines: [
      {
        description: 'Air freight',
        quantity: '1',
        unitPrice: '250.000',
        amount: '250.000',
        taxAmount: '0',
        chargeType: 'OCEAN_FREIGHT',
      },
    ],
    confidence: 0.97,
  })

/*
  The ledger holds a reading whose date nobody could parse; asking the model
  afresh gets the date as the bill prints it, which the parser now reads.
*/
const calls: boolean[] = []
/** What the model answers; a test may replace it for its own scan. */
const model = vi.hoisted(() => ({ answer: null as null | ((reuse: boolean) => string) }))
vi.mock('../ai/ledger', () => ({
  invoke: async (_context: unknown, _request: unknown, options?: { reuse?: boolean }) => {
    const reuse = options?.reuse === true
    calls.push(reuse)
    return {
      invocationId: randomUUID(),
      reused: reuse,
      response: {
        text: model.answer
          ? model.answer(reuse)
          : bill(reuse ? 'early in the month' : '03 Oct 2026'),
      },
    }
  },
}))

/*
  EK's bill as the model read it in live run 5: three correct lines, the date,
  confidence 0.95, and `total: null` because "Total due" was laid out over
  three lines of the PDF. In KWD here, so no exchange rate is needed to write.
*/
const noTotal = (invoiceNumber: string, confidence = 0.95) =>
  JSON.stringify({
    invoiceNumber,
    invoiceDate: '03 Oct 2026',
    dueOn: null,
    currency: 'KWD',
    subtotal: null,
    taxAmount: null,
    total: null,
    lines: [
      {
        description: 'Air freight',
        quantity: '380',
        unitPrice: '1.100',
        amount: '418.000',
        taxAmount: '0',
        chargeType: 'AIR_FREIGHT',
      },
      {
        description: 'Fuel surcharge',
        quantity: '380',
        unitPrice: '0.170',
        amount: '64.600',
        taxAmount: '0',
        chargeType: 'FUEL_SURCHARGE',
      },
      {
        description: 'Screening and handling',
        quantity: '1',
        unitPrice: null,
        amount: '12.300',
        taxAmount: '0',
        chargeType: null,
      },
    ],
    confidence,
  })

const { assets, branches, partners, principals, supplierInvoices, withActor, workingCalendars } =
  await import('@qabandi/db')
const { extractSupplierInvoice } = await import('./invoice-extract')

const BRANCH = randomUUID()
const PRINCIPAL = randomUUID()
const PARTNER = randomUUID()
const ASSET = randomUUID()
const actor: Actor = { principalId: PRINCIPAL, type: 'internal', branchIds: [BRANCH] }

const read = (retry: boolean) =>
  extractSupplierInvoice({
    actor,
    branchId: BRANCH,
    assetId: ASSET,
    partnerId: PARTNER,
    write: true,
    retry,
  })

describe.skipIf(!enabled)('a person retrying a refused bill', () => {
  beforeAll(async () => {
    await withActor({ ...actor, type: 'system' }, async (tx) => {
      const [calendar] = await tx
        .select({ id: workingCalendars.id })
        .from(workingCalendars)
        .where(eq(workingCalendars.key, 'kuwait'))
        .limit(1)
      if (!calendar) throw new Error('Run `pnpm db:seed` before this suite')

      await tx.insert(principals).values({
        id: PRINCIPAL,
        type: 'internal',
        email: `retry-${RUN}@qabandi.test`,
        nameEn: 'Retry Fixture',
      })
      await tx.insert(branches).values({
        id: BRANCH,
        code: `RTY-${RUN}`,
        legalNameEn: 'Retry Branch',
        legalNameAr: 'فرع',
        country: 'KW',
        baseCurrency: 'KWD',
        invoiceSeries: `RTY-${RUN}`,
        calendarId: calendar.id,
      })
      await tx
        .insert(partners)
        .values({ id: PARTNER, code: `RTY-${RUN}-A`, type: 'agent', legalNameEn: 'Retry Agent' })
      await tx.insert(assets).values({
        id: ASSET,
        branchId: BRANCH,
        storageKey: `bills/retry-${RUN}.pdf`,
        fileName: 'bill.pdf',
        contentType: 'application/pdf',
        byteSize: 15,
      })
    })
  })

  beforeEach(() => {
    calls.length = 0
    model.answer = null
  })

  it('the automatic read keeps the cached answer, and is refused on it', async () => {
    const auto = await read(false)
    expect(calls).toEqual([true])
    expect(auto.refusalCode).toBe('unreadable_fields')
    expect(auto.supplierInvoiceId).toBeUndefined()
  })

  it('a retry asks the model again, never the ledger, and files the bill', async () => {
    const retried = await read(true)
    expect(calls).toEqual([false])
    expect(retried.refusalCode).toBeUndefined()
    expect(retried.extracted.header.invoiceDate).toBe('2026-10-03')

    const [row] = await withActor(actor, (tx) =>
      tx
        .select({ invoiceDate: supplierInvoices.invoiceDate })
        .from(supplierInvoices)
        .where(eq(supplierInvoices.id, retried.supplierInvoiceId!)),
    )
    expect(row?.invoiceDate).toBe('2026-10-03')
  })

  /*
    R2. Complete lines and no printed total: captured with the lines' sum,
    and flagged so it cannot be approved until a person confirms the figure.
    It is never called consistent.
  */
  it('captures a bill with no printed total, flagged for a person to confirm', async () => {
    const number = `RTY-${RUN}-EK`
    model.answer = () => noTotal(number)

    const read1 = await read(false)

    expect(read1.refusalCode).toBeUndefined()
    expect(read1.consistent).toBe(false)
    expect(read1.totalFromLines).toBe(true)
    const [row] = await withActor(actor, (tx) =>
      tx
        .select({
          status: supplierInvoices.status,
          total: supplierInvoices.total,
          totalUnconfirmed: supplierInvoices.totalUnconfirmed,
        })
        .from(supplierInvoices)
        .where(eq(supplierInvoices.id, read1.supplierInvoiceId!)),
    )
    // Never past `received`: approval is a person's, and asks about the total.
    expect(row).toEqual({ status: 'received', total: '494.900000', totalUnconfirmed: true })
  })

  it('still refuses a bill with no total when the model was unsure', async () => {
    model.answer = () => noTotal(`RTY-${RUN}-LOW`, 0.5)

    const unsure = await read(false)

    expect(unsure.refusalCode).toBe('low_confidence')
    expect(unsure.supplierInvoiceId).toBeUndefined()
  })
})
