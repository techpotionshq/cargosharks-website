/**
 * The money registers — quotations, invoices, receipts, ageing.
 *
 * Read-only, and read-only is where this codebase has been bitten hardest. The
 * repository carries a lint rule about correlated subqueries because a count
 * that silently returned zero shipped six times and *looked like real data*:
 * nothing errors, the register renders, and the number is wrong. A test that
 * only asserts "it did not throw" would have passed every one of those.
 *
 * So each of these puts rows the actor must see beside rows they must not, and
 * checks the figure rather than the shape. The away-branch fixtures are the
 * whole point — a scoping bug is invisible in a database containing one
 * branch's data.
 */

import { beforeAll, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'

const APP_URL = process.env.TEST_DATABASE_URL
const enabled = Boolean(APP_URL)
if (APP_URL) process.env.DATABASE_URL = APP_URL

const { invoices, payments, quotes, enquiries, withActor } = await import('@qabandi/db')
const { AWAY_BRANCH, AWAY_CUSTOMER, CUSTOMER, HOME_BRANCH, bothBranchesActor, homeActor, world } =
  await import('@/lib/testing/fixtures')

const {
  listQuotes,
  quoteStatusCounts,
  listInvoices,
  invoiceSummary,
  listPayments,
  paymentSummary,
  hasQuotes,
  receivablesAgeing,
  topDebtors,
  getQuoteDetail,
  getInvoiceDetail,
} = await import('./queries')

const HOME_INVOICE = '00000000-0000-7000-8000-00000000c101'
const AWAY_INVOICE = '00000000-0000-7000-8000-00000000c102'
const HOME_PAYMENT = '00000000-0000-7000-8000-00000000c103'
const HOME_ENQUIRY = '00000000-0000-7000-8000-00000000c104'
const HOME_QUOTE = '00000000-0000-7000-8000-00000000c105'
const AWAY_ENQUIRY = '00000000-0000-7000-8000-00000000c106'
/*
  A rejected quotation in each branch.

  `rejected` is the marker status for the aggregate test below, and it is safe
  to use as one because nothing else in the suite reaches it: the only
  transition to it is from `sent`, and the one test that tries it does so from
  `accepted`, which is terminal and refused. So exactly these two rows carry
  the status, one on each side of the branch boundary.
*/
const HOME_REJECTED = '00000000-0000-7000-8000-00000000c107'
const AWAY_REJECTED = '00000000-0000-7000-8000-00000000c108'

describe.skipIf(!enabled)('ledger registers', () => {
  beforeAll(async () => {
    await world()

    await withActor({ ...bothBranchesActor, type: 'system' }, async (tx) => {
      await tx
        .insert(invoices)
        .values([
          {
            id: HOME_INVOICE,
            branchId: HOME_BRANCH,
            customerId: CUSTOMER,
            currency: 'KWD',
            status: 'issued',
            seriesNo: 'FXH-2026-90001',
            subtotal: '500.000',
            total: '500.000',
            issuedAt: new Date('2026-06-01T00:00:00Z'),
            dueOn: '2026-06-30',
          },
          {
            id: AWAY_INVOICE,
            branchId: AWAY_BRANCH,
            customerId: AWAY_CUSTOMER,
            currency: 'KWD',
            status: 'issued',
            seriesNo: 'FXA-2026-90001',
            subtotal: '900.000',
            total: '900.000',
            issuedAt: new Date('2026-06-01T00:00:00Z'),
            dueOn: '2026-06-30',
          },
        ])
        .onConflictDoNothing()

      await tx
        .insert(payments)
        .values({
          id: HOME_PAYMENT,
          branchId: HOME_BRANCH,
          customerId: CUSTOMER,
          amount: '120.000',
          currency: 'KWD',
          receivedOn: '2026-06-05',
          method: 'bank_transfer',
        })
        .onConflictDoNothing()

      await tx
        .insert(enquiries)
        .values({
          id: HOME_ENQUIRY,
          reference: 'FXH-ENQ-FIXTURE-1',
          branchId: HOME_BRANCH,
          customerId: CUSTOMER,
          mode: 'sea_fcl',
          tradeDirection: 'import',
        })
        .onConflictDoNothing()

      await tx
        .insert(enquiries)
        .values({
          id: AWAY_ENQUIRY,
          reference: 'FXA-ENQ-FIXTURE-1',
          branchId: AWAY_BRANCH,
          customerId: AWAY_CUSTOMER,
          mode: 'air',
          tradeDirection: 'export',
        })
        .onConflictDoNothing()

      await tx
        .insert(quotes)
        .values([
          {
            id: HOME_QUOTE,
            reference: 'FXH-QUO-FIXTURE-1',
            enquiryId: HOME_ENQUIRY,
            branchId: HOME_BRANCH,
            version: 1,
            status: 'draft',
            currency: 'KWD',
            totalSell: '600.000',
            totalCost: '400.000',
            validUntil: '2026-12-31',
          },
          {
            id: HOME_REJECTED,
            reference: 'FXH-QUO-FIXTURE-2',
            enquiryId: HOME_ENQUIRY,
            branchId: HOME_BRANCH,
            version: 2,
            status: 'rejected',
            currency: 'KWD',
            totalSell: '650.000',
            totalCost: '400.000',
          },
          {
            id: AWAY_REJECTED,
            reference: 'FXA-QUO-FIXTURE-1',
            enquiryId: AWAY_ENQUIRY,
            branchId: AWAY_BRANCH,
            version: 1,
            status: 'rejected',
            currency: 'KWD',
            totalSell: '900.000',
            totalCost: '700.000',
          },
        ])
        .onConflictDoNothing()
    })
  })

  describe('scoping — FR-ID-04', () => {
    /**
     * The assertion that matters. Both invoices exist; the home actor holds a
     * role in one branch only, so the away invoice must be invisible — not
     * filtered by the query, but absent from it.
     */
    it('shows an invoice from the actor’s branch and hides the other', async () => {
      const mine = await listInvoices(homeActor)
      const numbers = mine.map((r) => r.seriesNo)

      expect(numbers).toContain('FXH-2026-90001')
      expect(numbers).not.toContain('FXA-2026-90001')
    })

    it('shows both to a principal holding a role in both branches', async () => {
      const numbers = (await listInvoices(bothBranchesActor)).map((r) => r.seriesNo)
      expect(numbers).toContain('FXH-2026-90001')
      expect(numbers).toContain('FXA-2026-90001')
    })

    it('scopes receipts the same way', async () => {
      const mine = await listPayments(homeActor)
      expect(mine.some((p) => p.id === HOME_PAYMENT)).toBe(true)
    })

    /*
      Asserted by branch rather than by naming the fixture quotation.

      The register pages at two hundred and nothing is ever deleted, so any one
      reference eventually falls off the end. What must hold however much
      history has accumulated is the scoping itself.
    */
    it('scopes quotations the same way', async () => {
      const mine = await listQuotes(homeActor)
      expect(mine.length).toBeGreaterThan(0)
      expect(mine.every((q) => q.branchCode === 'FXH')).toBe(true)
    })
  })

  describe('the aggregates', () => {
    /**
     * A summary that counts the whole table rather than the visible rows is
     * the exact failure the correlated-subquery rule exists for: the register
     * lists one invoice and the total says two.
     */
    it('summarises only what the actor can see', async () => {
      const mine = await invoiceSummary(homeActor)
      const both = await invoiceSummary(bothBranchesActor)

      // Both fixtures are issued and unpaid, so the wider actor must see more
      // issued invoices and a larger outstanding balance than the narrow one.
      expect(both.issued).toBeGreaterThan(mine.issued)
      expect(Number(both.outstanding)).toBeGreaterThan(Number(mine.outstanding))
      expect(mine.issued).toBeGreaterThan(0)
    })

    it('summarises receipts against the rows it lists', async () => {
      const rows = await listPayments(homeActor)
      const summary = await paymentSummary(homeActor)
      expect(summary.count).toBe(rows.length)
    })

    /**
     * Measured on one status this file owns both rows of, rather than on a
     * total.
     *
     * Two earlier spellings were both measuring the wrong thing. Comparing the
     * aggregate to a page of the register broke once the table outgrew two
     * hundred rows; comparing it to a separate `count(*)` broke because three
     * suites write quotations in parallel and whatever landed between the two
     * reads showed up as a discrepancy — the test was measuring the scheduler.
     *
     * The property was never about the total. It is that the aggregate counts
     * the rows the actor can *see*, which is exactly what a count over the
     * whole table would get wrong — and that is visible in one status: the
     * away branch's rejection is in the wider actor's tally and not in the
     * narrow one's.
     */
    it('counts quotations by status against what the actor can see', async () => {
      const rejected = (rows: { status: string; count: number }[]) =>
        Number(rows.find((row) => row.status === 'rejected')?.count ?? 0)

      expect(rejected(await quoteStatusCounts(homeActor))).toBe(1)
      expect(rejected(await quoteStatusCounts(bothBranchesActor))).toBe(2)
    })

    it('knows whether any quotation exists at all', async () => {
      expect(await hasQuotes(homeActor)).toBe(true)
    })
  })

  describe('ageing and debtors', () => {
    it('buckets receivables so the buckets sum to the reported total', async () => {
      const ageing = await receivablesAgeing(homeActor)
      const summed = ageing.buckets.reduce((total, b) => total + Number(b.amount ?? 0), 0)

      // The whole point of an ageing report: the columns add up to the figure
      // printed underneath them.
      expect(summed).toBeCloseTo(Number(ageing.total), 3)
      expect(Number(ageing.total)).toBeGreaterThan(0)
    })

    it('lists debtors from visible invoices only', async () => {
      const debtors = await topDebtors(homeActor)
      const names = debtors.map((d) => d.customerName)
      expect(names).toContain('Fixture Home Customer')
      expect(names).not.toContain('Fixture Away Customer')
    })
  })

  describe('detail reads', () => {
    it('returns an invoice the actor may see', async () => {
      const detail = await getInvoiceDetail(homeActor, HOME_INVOICE)
      expect(detail?.seriesNo).toBe('FXH-2026-90001')
    })

    /**
     * FR-ID-04 stated as a read: another branch's invoice is *not found*, not
     * forbidden. There is no enumeration signal to work from.
     */
    it('returns nothing for an invoice in another branch', async () => {
      expect(await getInvoiceDetail(homeActor, AWAY_INVOICE)).toBeUndefined()
      // …and the same id is readable by a principal who holds that branch.
      expect((await getInvoiceDetail(bothBranchesActor, AWAY_INVOICE))?.seriesNo).toBe(
        'FXA-2026-90001',
      )
    })

    it('returns a quotation the actor may see', async () => {
      const detail = await getQuoteDetail(homeActor, HOME_QUOTE)
      expect(detail?.reference).toBe('FXH-QUO-FIXTURE-1')
    })

    it('returns nothing for an id that does not exist', async () => {
      expect(
        await getInvoiceDetail(homeActor, '00000000-0000-7000-8000-0000000000ff'),
      ).toBeUndefined()
    })
  })

  describe('filters', () => {
    it('filters the invoice register by status', async () => {
      const issued = await listInvoices(homeActor, 'issued')
      expect(issued.every((i) => i.status === 'issued')).toBe(true)

      const drafts = await listInvoices(homeActor, 'draft')
      expect(drafts.every((i) => i.status === 'draft')).toBe(true)
    })

    it('filters quotations by status', async () => {
      const drafts = await listQuotes(homeActor, 'draft')
      expect(drafts.every((q) => q.status === 'draft')).toBe(true)
    })
  })

  describe('money never becomes a float on the way out', () => {
    /**
     * `numeric(19,6)` arrives as a string precisely so precision survives, and
     * the register hands it to the formatter unparsed. A number here would
     * mean the third decimal of every KWD amount is already gone.
     */
    it('returns amounts as strings', async () => {
      const [invoice] = await withActor(homeActor, (tx) =>
        tx.select({ total: invoices.total }).from(invoices).where(eq(invoices.id, HOME_INVOICE)),
      )
      expect(typeof invoice!.total).toBe('string')

      const rows = await listInvoices(homeActor)
      const row = rows.find((r) => r.seriesNo === 'FXH-2026-90001')
      expect(typeof row!.total).toBe('string')
    })
  })
})
