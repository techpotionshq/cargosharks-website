/**
 * "Read as a bill" after a refusal (D1).
 *
 * The automatic read on arrival is answered from the ledger on every later
 * read of the same scan, which is right for a reading that worked and wrong
 * for one that was refused: the person pressing "Read as a bill" was shown the
 * same refusal each time and no model was asked. A retry now asks afresh when
 * the cached answer does not read as a bill, and only then.
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

const bill = (invoiceDate: string) =>
  JSON.stringify({
    invoiceNumber: NUMBER,
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
vi.mock('../ai/ledger', () => ({
  invoke: async (_context: unknown, _request: unknown, options?: { reuse?: boolean }) => {
    const reuse = options?.reuse === true
    calls.push(reuse)
    return {
      invocationId: randomUUID(),
      reused: reuse,
      response: { text: bill(reuse ? 'early in the month' : '03 Oct 2026') },
    }
  },
}))

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
  })

  it('the automatic read keeps the cached answer, and is refused on it', async () => {
    const auto = await read(false)
    expect(calls).toEqual([true])
    expect(auto.refusalCode).toBe('unreadable_fields')
    expect(auto.supplierInvoiceId).toBeUndefined()
  })

  it('a retry asks again when the cached answer did not read, and files the bill', async () => {
    const retried = await read(true)
    expect(calls).toEqual([true, false])
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
})
