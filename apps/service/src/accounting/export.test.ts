/**
 * The accounting export — selecting a period, storing the file, marking what
 * it consumed.
 *
 * The arithmetic lives in `@qabandi/core/accounting` and is tested there
 * against no database. What is tested here is the half that decides *which
 * rows*, and every property below is about a month somebody has to close.
 *
 * **Draft and posted are genuinely different operations.** A finance manager
 * generates January three or four times before they believe it. A draft builds
 * and stores the file and marks nothing — run it twenty times and the
 * twenty-first still sees every invoice. Posting is the deliberate act that
 * consumes them. Asserted by running a draft twice and finding the same
 * invoice both times.
 *
 * **Posting is idempotent under a race.** The `is null` condition on the read
 * is repeated in the write, so of two people posting January at the same
 * instant only one update matches. Asserted by posting twice: the second finds
 * nothing left to post.
 *
 * **Unmapped charge types are reported all at once.** `buildJournal` refuses
 * one by design and its message names a single charge type; a finance manager
 * mapping a chart of accounts wants the list, or closing a month becomes
 * twelve rounds of fix-one-and-re-run.
 *
 * **A void is the only way a period becomes exportable again.** It clears the
 * marks and nothing else — the row stays, the file stays, and the reason is
 * required, because "why was March posted twice" is answered by this row or by
 * nobody.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { and, eq, inArray } from 'drizzle-orm'
import type { Actor } from '@qabandi/db'

const APP_URL = process.env.TEST_DATABASE_URL
const enabled = Boolean(APP_URL)
if (APP_URL) process.env.DATABASE_URL = APP_URL

/*
  No object storage in a unit run. The export stores the file it built even for
  a draft — a preview somebody downloaded and circulated is a file that exists
  in the world — so the store has to be real enough to accept bytes.
*/
process.env.FILE_STORE_DRIVER = 'memory'

const {
  accountingExports,
  branches,
  chargeTypes,
  customers,
  invoiceLines,
  invoices,
  paymentAllocations,
  payments,
  withActor,
} = await import('@qabandi/db')

const { buildAccountingExport, voidAccountingExport, ExportError } = await import('./export')

/* ------------------------------------------------------------------ fixtures */

const BRANCH = '00000000-0000-7000-8000-00000000ac01'
const CUSTOMER = '00000000-0000-7000-8000-00000000ac02'
const PRINCIPAL = '00000000-0000-7000-8000-00000000ac03'

/**
 * A branch of this suite's own.
 *
 * The shared fixture branches are read by a dozen other suites and this one
 * needs a chart of accounts configured on the branch it exports — control
 * accounts are branch columns, and posting rewrites `accounting_export_id` on
 * every invoice it consumes.
 */
const actor: Actor = { principalId: PRINCIPAL, type: 'internal', branchIds: [BRANCH] }
const systemActor = { ...actor, type: 'system' as const }

let chargeTypeId: string
const RUN = Date.now().toString(36).toUpperCase().slice(-5)
let seq = 0

/** A period nothing else has used, so "what falls in it" is exactly ours. */
const PERIOD = { from: '2035-03-01', to: '2035-03-31' }

describe.skipIf(!enabled)('the accounting export', () => {
  beforeAll(async () => {
    const db = await import('@qabandi/db')

    await withActor(systemActor, async (tx) => {
      const calendars = await tx.execute(
        `select id from working_calendars where key = 'kuwait' limit 1`,
      )
      const roles = await tx.execute(`select id from roles where key = 'finance' limit 1`)
      const calendarId = (calendars.rows[0] as { id: string } | undefined)?.id
      const roleId = (roles.rows[0] as { id: string } | undefined)?.id
      if (!calendarId || !roleId) throw new Error('Run `pnpm db:seed` before this suite')

      await tx
        .insert(db.principals)
        .values({
          id: PRINCIPAL,
          type: 'internal',
          email: 'accounting-export@qabandi.test',
          nameEn: 'Export Fixture',
        })
        .onConflictDoNothing()

      await tx
        .insert(branches)
        .values({
          id: BRANCH,
          code: 'FXE',
          legalNameEn: 'Export Fixture Branch',
          legalNameAr: 'فرع التصدير',
          country: 'KW',
          baseCurrency: 'KWD',
          invoiceSeries: 'FXE',
          calendarId,
        })
        .onConflictDoNothing()

      // The chart of accounts. Without these the journal has nowhere to post
      // the receivable, the tax or the rounding difference.
      await tx
        .update(branches)
        .set({
          arAccountCode: '1200',
          apAccountCode: '2100',
          taxAccountCode: '2200',
          inputTaxAccountCode: '1300',
          bankAccountCode: '1000',
          fxVarianceAccountCode: '7800',
          roundingAccountCode: '7900',
        })
        .where(eq(branches.id, BRANCH))

      await tx
        .insert(db.principalBranchRoles)
        .values({ principalId: PRINCIPAL, branchId: BRANCH, roleId })
        .onConflictDoNothing()

      await tx
        .insert(customers)
        .values({
          id: CUSTOMER,
          code: 'CUST-ACCT-EXPORT',
          legalNameEn: 'Export Fixture Customer',
          primaryBranchId: BRANCH,
        })
        .onConflictDoNothing()

      const [charge] = await tx
        .select({ id: chargeTypes.id })
        .from(chargeTypes)
        .where(eq(chargeTypes.key, 'ocean_freight'))
        .limit(1)
      chargeTypeId = charge!.id
    })
  })

  afterAll(async () => {
    // The charge type is shared reference data. Leaving a revenue account on
    // it would change what every other suite's export considers mapped.
    if (!enabled || !chargeTypeId) return
    await withActor(systemActor, (tx) =>
      tx
        .update(chargeTypes)
        .set({ revenueAccountCode: null, costAccountCode: null })
        .where(eq(chargeTypes.id, chargeTypeId)),
    )
  })

  /** An issued invoice inside the period, with one line against the charge type. */
  async function issuedInvoice(amount = '500.000'): Promise<string> {
    seq += 1
    return withActor(systemActor, async (tx) => {
      const [invoice] = await tx
        .insert(invoices)
        .values({
          branchId: BRANCH,
          customerId: CUSTOMER,
          seriesNo: `FXE-${RUN}-${seq}`,
          status: 'issued',
          currency: 'KWD',
          subtotal: amount,
          taxAmount: '0.000',
          total: amount,
          taxTreatment: 'out_of_scope',
          issuedAt: new Date('2035-03-15T09:00:00Z'),
        })
        .returning({ id: invoices.id })

      await tx.insert(invoiceLines).values({
        invoiceId: invoice!.id,
        chargeTypeId,
        descriptionEn: 'Ocean freight',
        quantity: '1.000',
        unitPrice: amount,
        amount,
        taxAmount: '0.000',
        sortOrder: 1,
      })

      return invoice!.id
    })
  }

  const mapCharge = (revenue: string | null) =>
    withActor(systemActor, (tx) =>
      tx
        .update(chargeTypes)
        .set({ revenueAccountCode: revenue, costAccountCode: revenue ? '5100' : null })
        .where(eq(chargeTypes.id, chargeTypeId)),
    )

  describe('refusing before it reads anything', () => {
    it('refuses a period that ends before it starts', async () => {
      await expect(
        buildAccountingExport(actor, { branchId: BRANCH, from: '2035-03-31', to: '2035-03-01' }),
      ).rejects.toThrow(ExportError)
    })

    it('names the reason a reversed period was refused', async () => {
      await expect(
        buildAccountingExport(actor, { branchId: BRANCH, from: '2035-03-31', to: '2035-03-01' }),
      ).rejects.toMatchObject({ code: 'period_reversed' })
    })

    /** Invisible under RLS is not-found, which is also the right answer. */
    it('treats a branch the actor cannot see as missing', async () => {
      await expect(
        buildAccountingExport(actor, {
          branchId: '00000000-0000-7000-8000-00000000acee',
          ...PERIOD,
        }),
      ).rejects.toMatchObject({ code: 'branch_not_found' })
    })
  })

  describe('an empty period', () => {
    /** A month with nothing in it still produces a file and an export row. */
    it('produces a file, a row, and no journal lines', async () => {
      const result = await buildAccountingExport(actor, {
        branchId: BRANCH,
        from: '2034-01-01',
        to: '2034-01-31',
      })

      expect(result.status).toBe('draft')
      expect(result.rowCount).toBe(0)
      expect(result.invoiceCount).toBe(0)
      expect(result.assetId).toBeTruthy()
      expect(result.filename).toBe('journal-FXE-2034-01-01-to-2034-01-31.csv')
      expect(result.checksum).toMatch(/^[0-9a-f]{64}$/)
    })

    it('records the export against the branch', async () => {
      const result = await buildAccountingExport(actor, {
        branchId: BRANCH,
        from: '2034-02-01',
        to: '2034-02-28',
      })

      const [row] = await withActor(actor, (tx) =>
        tx
          .select({ status: accountingExports.status, checksum: accountingExports.checksum })
          .from(accountingExports)
          .where(eq(accountingExports.id, result.exportId)),
      )
      expect(row?.status).toBe('draft')
      expect(row?.checksum).toBe(result.checksum)
    })
  })

  describe('a period with an invoice in it', () => {
    /**
     * The whole list, not the first offender. Mapping a chart of accounts one
     * error at a time is twelve rounds of fix-one-and-re-run.
     */
    it('names the charge types that have no account against them', async () => {
      await mapCharge(null)
      await issuedInvoice()

      await expect(
        buildAccountingExport(actor, { branchId: BRANCH, ...PERIOD }),
      ).rejects.toMatchObject({ code: 'unmapped_charge_types' })
    })

    /**
     * The names travel as values, in both languages, because the screen says
     * this sentence in the reader's language and the list sits inside it.
     */
    it('carries the names in both languages for the screen to translate', async () => {
      await mapCharge(null)
      await issuedInvoice()
      const [charge] = await withActor(systemActor, (tx) =>
        tx
          .select({ nameEn: chargeTypes.nameEn, nameAr: chargeTypes.nameAr })
          .from(chargeTypes)
          .where(eq(chargeTypes.id, chargeTypeId)),
      )

      await expect(
        buildAccountingExport(actor, { branchId: BRANCH, ...PERIOD }),
      ).rejects.toMatchObject({
        values: {
          namesEn: expect.stringContaining(charge!.nameEn),
          namesAr: expect.stringContaining(charge!.nameAr),
        },
      })
    })

    it('says where to map them', async () => {
      await mapCharge(null)
      await issuedInvoice()

      await expect(buildAccountingExport(actor, { branchId: BRANCH, ...PERIOD })).rejects.toThrow(
        'Reference → Charge types',
      )
    })

    it('builds a balanced journal once the accounts are mapped', async () => {
      await mapCharge('4100')
      await issuedInvoice('500.000')

      const result = await buildAccountingExport(actor, { branchId: BRANCH, ...PERIOD })

      expect(result.invoiceCount).toBeGreaterThan(0)
      expect(result.rowCount).toBeGreaterThan(0)
      // The only property a journal must have.
      expect(result.totalDebit).toBe(result.totalCredit)
      expect(result.csv).toContain('4100')
    })

    /**
     * A draft marks nothing. Run it twenty times and the twenty-first still
     * sees every invoice — which is what makes a preview safe to re-run.
     */
    it('leaves the invoices for the next run', async () => {
      await mapCharge('4100')
      const invoiceId = await issuedInvoice()

      await buildAccountingExport(actor, { branchId: BRANCH, ...PERIOD })
      await buildAccountingExport(actor, { branchId: BRANCH, ...PERIOD })

      const [row] = await withActor(actor, (tx) =>
        tx
          .select({ marked: invoices.accountingExportId })
          .from(invoices)
          .where(eq(invoices.id, invoiceId)),
      )
      expect(row?.marked).toBeNull()
    })
  })

  describe('posting', () => {
    it('consumes the invoices it posted', async () => {
      await mapCharge('4100')
      const invoiceId = await issuedInvoice()

      const posted = await buildAccountingExport(actor, {
        branchId: BRANCH,
        ...PERIOD,
        post: true,
      })

      expect(posted.status).toBe('posted')
      const [row] = await withActor(actor, (tx) =>
        tx
          .select({ marked: invoices.accountingExportId })
          .from(invoices)
          .where(eq(invoices.id, invoiceId)),
      )
      expect(row?.marked).toBe(posted.exportId)
    })

    /**
     * The `is null` condition repeated in the write. Two people posting the
     * same month both selected the same invoices; only one update matches, and
     * the second marks nothing rather than re-pointing them.
     */
    it('finds nothing left the second time', async () => {
      await mapCharge('4100')
      await issuedInvoice()
      await buildAccountingExport(actor, { branchId: BRANCH, ...PERIOD, post: true })

      const again = await buildAccountingExport(actor, {
        branchId: BRANCH,
        ...PERIOD,
        post: true,
      })

      expect(again.invoiceCount).toBe(0)
      expect(again.rowCount).toBe(0)
    })

    it('stamps who posted it and when', async () => {
      await mapCharge('4100')
      await issuedInvoice()

      const posted = await buildAccountingExport(actor, {
        branchId: BRANCH,
        ...PERIOD,
        post: true,
      })

      const [row] = await withActor(actor, (tx) =>
        tx
          .select({
            postedAt: accountingExports.postedAt,
            postedById: accountingExports.postedById,
          })
          .from(accountingExports)
          .where(eq(accountingExports.id, posted.exportId)),
      )
      expect(row?.postedAt).toBeInstanceOf(Date)
      expect(row?.postedById).toBe(PRINCIPAL)
    })
  })

  describe('voiding', () => {
    async function postedExport(): Promise<{ exportId: string; invoiceId: string }> {
      await mapCharge('4100')
      const invoiceId = await issuedInvoice()
      const posted = await buildAccountingExport(actor, {
        branchId: BRANCH,
        ...PERIOD,
        post: true,
      })
      return { exportId: posted.exportId, invoiceId }
    }

    it('releases what the export consumed', async () => {
      const { exportId, invoiceId } = await postedExport()

      const { released } = await voidAccountingExport(actor, exportId, 'Posted to the wrong period')

      expect(released).toBeGreaterThan(0)
      const [row] = await withActor(actor, (tx) =>
        tx
          .select({ marked: invoices.accountingExportId })
          .from(invoices)
          .where(eq(invoices.id, invoiceId)),
      )
      expect(row?.marked).toBeNull()
    })

    /** The row stays and the file stays — only the marks are cleared. */
    it('keeps the export row, with the reason on it', async () => {
      const { exportId } = await postedExport()

      await voidAccountingExport(actor, exportId, 'Duplicate of the January run')

      const [row] = await withActor(actor, (tx) =>
        tx
          .select({
            status: accountingExports.status,
            reason: accountingExports.voidReason,
            assetId: accountingExports.assetId,
            postedAt: accountingExports.postedAt,
          })
          .from(accountingExports)
          .where(eq(accountingExports.id, exportId)),
      )
      expect(row?.status).toBe('void')
      expect(row?.reason).toBe('Duplicate of the January run')
      expect(row?.assetId).toBeTruthy()
      expect(row?.postedAt).toBeNull()
    })

    it('makes the period exportable again', async () => {
      const { exportId, invoiceId } = await postedExport()
      await voidAccountingExport(actor, exportId, 'Wrong period')

      const again = await buildAccountingExport(actor, { branchId: BRANCH, ...PERIOD })

      const included = await withActor(actor, (tx) =>
        tx
          .select({ id: invoices.id })
          .from(invoices)
          .where(and(inArray(invoices.id, [invoiceId]), eq(invoices.branchId, BRANCH))),
      )
      expect(included).toHaveLength(1)
      expect(again.invoiceCount).toBeGreaterThan(0)
    })

    /** "Why was March posted twice" is answered by this row or by nobody. */
    it('insists on a reason', async () => {
      const { exportId } = await postedExport()
      await expect(voidAccountingExport(actor, exportId, '   ')).rejects.toMatchObject({
        code: 'void_needs_reason',
      })
    })

    it('refuses to void the same export twice', async () => {
      const { exportId } = await postedExport()
      await voidAccountingExport(actor, exportId, 'First void')

      await expect(voidAccountingExport(actor, exportId, 'Second void')).rejects.toMatchObject({
        code: 'already_void',
      })
    })

    it('treats an export it cannot see as missing', async () => {
      await expect(
        voidAccountingExport(actor, '00000000-0000-7000-8000-00000000acda', 'Gone'),
      ).rejects.toMatchObject({ code: 'not_found' })
    })
  })

  describe('foreign currency', () => {
    /** A USD invoice raised by hand, with the rate it was raised at on itself. */
    async function usdInvoice(issuedAt: string, fxRate: string | null): Promise<string> {
      seq += 1
      return withActor(systemActor, async (tx) => {
        const [invoice] = await tx
          .insert(invoices)
          .values({
            branchId: BRANCH,
            customerId: CUSTOMER,
            seriesNo: `FXE-${RUN}-${seq}`,
            status: 'issued',
            currency: 'USD',
            subtotal: '1000',
            total: '1000',
            fxRate,
            issuedAt: new Date(issuedAt),
          })
          .returning({ id: invoices.id })
        await tx.insert(invoiceLines).values({
          invoiceId: invoice!.id,
          chargeTypeId,
          descriptionEn: 'Ocean freight',
          unitPrice: '1000',
          amount: '1000',
        })
        return invoice!.id
      })
    }

    /*
      F1. The receipt's allocation was converted with a rate looked up by the
      *payment's* id, in a map holding only this period's invoices — so it
      always missed, and a USD receipt cleared AR at 1.
    */
    it('clears a receipt at the rate of the invoice it settles, from an earlier period', async () => {
      await mapCharge('4100')
      const invoiceId = await usdInvoice('2036-01-15T09:00:00Z', '0.307')
      await buildAccountingExport(actor, {
        branchId: BRANCH,
        from: '2036-01-01',
        to: '2036-01-31',
        post: true,
      })

      await withActor(systemActor, async (tx) => {
        const [payment] = await tx
          .insert(payments)
          .values({
            branchId: BRANCH,
            customerId: CUSTOMER,
            amount: '1000',
            currency: 'USD',
            fxRate: '0.309',
            receivedOn: '2036-02-10',
            method: 'bank_transfer',
            reference: `TT-${RUN}`,
          })
          .returning({ id: payments.id })
        await tx
          .insert(paymentAllocations)
          .values({ paymentId: payment!.id, invoiceId, amount: '1000' })
      })

      const result = await buildAccountingExport(actor, {
        branchId: BRANCH,
        from: '2036-02-01',
        to: '2036-02-28',
      })

      const rows = result.csv.split('\r\n').map((line) => line.split(','))
      const ar = rows.find((r) => r[1] === '1200')!
      const fx = rows.find((r) => r[1] === '7800')!
      expect(ar[5]).toBe('307')
      expect(fx[5]).toBe('2')
      expect(result.totalDebit).toBe(result.totalCredit)
    })

    /** F2. A foreign invoice with no rate anywhere used to post at 1. */
    it('refuses a foreign invoice that carries no rate, and names it', async () => {
      await mapCharge('4100')
      await usdInvoice('2036-03-15T09:00:00Z', null)

      await expect(
        buildAccountingExport(actor, { branchId: BRANCH, from: '2036-03-01', to: '2036-03-31' }),
      ).rejects.toMatchObject({ code: 'invoice_without_rate' })
    })

    it('posts a hand-raised foreign invoice at its own rate', async () => {
      await mapCharge('4100')
      await usdInvoice('2036-04-15T09:00:00Z', '0.307')

      const result = await buildAccountingExport(actor, {
        branchId: BRANCH,
        from: '2036-04-01',
        to: '2036-04-30',
      })

      const ar = result.csv
        .split('\r\n')
        .map((line) => line.split(','))
        .find((r) => r[1] === '1200')!
      expect(ar[4]).toBe('307')
    })
  })

  /*
    F19. Two people posting the same month at once: the \`is null\` guard kept the
    second from re-pointing the rows, but it still committed a second "posted"
    export carrying the same journal.
  */
  describe('two posts of one period at once', () => {
    it('never leaves two posted exports carrying the same invoice', async () => {
      await mapCharge('4100')
      const period = { from: '2036-05-01', to: '2036-05-31' }
      seq += 1
      await withActor(systemActor, async (tx) => {
        const [invoice] = await tx
          .insert(invoices)
          .values({
            branchId: BRANCH,
            customerId: CUSTOMER,
            seriesNo: `FXE-${RUN}-${seq}`,
            status: 'issued',
            currency: 'KWD',
            subtotal: '50',
            total: '50',
            issuedAt: new Date('2036-05-10T09:00:00Z'),
          })
          .returning({ id: invoices.id })
        await tx.insert(invoiceLines).values({
          invoiceId: invoice!.id,
          chargeTypeId,
          descriptionEn: 'Ocean freight',
          unitPrice: '50',
          amount: '50',
        })
      })

      const outcomes = await Promise.allSettled([
        buildAccountingExport(actor, { branchId: BRANCH, ...period, post: true }),
        buildAccountingExport(actor, { branchId: BRANCH, ...period, post: true }),
      ])

      const posted = outcomes.filter((o) => o.status === 'fulfilled' && o.value.invoiceCount > 0)
      expect(posted).toHaveLength(1)
      for (const o of outcomes) {
        if (o.status === 'rejected') expect(o.reason).toMatchObject({ code: 'period_changed' })
      }
    })
  })
})
