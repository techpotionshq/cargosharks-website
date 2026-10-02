/**
 * Reading a bill that is already captured (ai-10).
 *
 * `(partner_id, reference)` is unique on `supplier_invoices`, and a second
 * read of the same bill used to reach the insert and fail it: a 500 the
 * screen worded "could not be read, capture it by hand" — an invitation to
 * type the duplicate the constraint had just refused — and an exception the
 * email path retried five times. It is now a terminal refusal, with the bill
 * that is already there.
 *
 * The model and the file store are replaced; what is under test is the
 * write path against a real database and its constraint.
 */

import { randomUUID } from 'node:crypto'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import type { Actor } from '@qabandi/db'

const APP_URL = process.env.TEST_DATABASE_URL
const enabled = Boolean(APP_URL)
if (APP_URL) process.env.DATABASE_URL = APP_URL

const RUN = Date.now().toString(36).toUpperCase().slice(-5)
const NUMBER = `DUP-${RUN}-1`

vi.mock('../adapters/index', () => ({
  fileStore: async () => ({ get: async () => Buffer.from('%PDF-1.4 a bill') }),
}))

vi.mock('../ai/ledger', () => ({
  invoke: async () => ({
    invocationId: randomUUID(),
    response: {
      text: JSON.stringify({
        invoiceNumber: NUMBER,
        invoiceDate: '2026-09-20',
        dueOn: null,
        currency: 'KWD',
        subtotal: '250.000',
        taxAmount: '0',
        total: '250.000',
        lines: [
          {
            description: 'Ocean freight',
            quantity: '1',
            unitPrice: '250.000',
            amount: '250.000',
            taxAmount: '0',
            chargeType: 'OCEAN_FREIGHT',
          },
        ],
        confidence: 0.97,
      }),
    },
  }),
}))

const { assets, branches, partners, principals, supplierInvoices, withActor, workingCalendars } =
  await import('@qabandi/db')
const { extractSupplierInvoice } = await import('./invoice-extract')

const BRANCH = randomUUID()
const PRINCIPAL = randomUUID()
const PARTNER = randomUUID()
const ASSET = randomUUID()
const actor: Actor = { principalId: PRINCIPAL, type: 'internal', branchIds: [BRANCH] }

const read = (write: boolean) =>
  extractSupplierInvoice({ actor, branchId: BRANCH, assetId: ASSET, partnerId: PARTNER, write })

describe.skipIf(!enabled)('reading a bill that is already captured', () => {
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
        email: `dup-${RUN}@qabandi.test`,
        nameEn: 'Duplicate Fixture',
      })
      await tx.insert(branches).values({
        id: BRANCH,
        code: `DUP-${RUN}`,
        legalNameEn: 'Duplicate Branch',
        legalNameAr: 'فرع',
        country: 'KW',
        baseCurrency: 'KWD',
        invoiceSeries: `DUP-${RUN}`,
        calendarId: calendar.id,
      })
      await tx
        .insert(partners)
        .values({ id: PARTNER, code: `DUP-${RUN}-A`, type: 'agent', legalNameEn: 'Dup Agent' })
      await tx.insert(assets).values({
        id: ASSET,
        branchId: BRANCH,
        storageKey: `bills/dup-${RUN}.pdf`,
        fileName: 'bill.pdf',
        contentType: 'application/pdf',
        byteSize: 15,
      })
    })
  })

  it('writes the bill the first time', async () => {
    const first = await read(true)
    expect(first.refusalCode).toBeUndefined()
    expect(first.supplierInvoiceId).toBeTruthy()
  })

  it('refuses the second read as already captured, naming the bill, without throwing', async () => {
    const [existing] = await withActor(actor, (tx) =>
      tx
        .select({ id: supplierInvoices.id })
        .from(supplierInvoices)
        .where(eq(supplierInvoices.reference, NUMBER)),
    )

    const again = await read(true)

    expect(again.supplierInvoiceId).toBeUndefined()
    expect(again.refusalCode).toBe('already_captured')
    expect(again.refusalValues).toEqual({ reference: NUMBER, supplierInvoiceId: existing!.id })
  })

  it('says so on the attended read too, before anybody types it in', async () => {
    const preview = await read(false)
    expect(preview.refusalCode).toBe('already_captured')
  })
})
