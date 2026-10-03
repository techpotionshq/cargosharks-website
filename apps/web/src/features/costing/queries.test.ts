/**
 * The matching picker's candidates — QA P2-9.
 *
 * Reversing a consolidation allocation posts a negative copy of each share and
 * leaves the original in place, because nothing is deleted. The picker offered
 * both halves of every such pair, unlabelled, as costs a supplier's bill could
 * be matched against. Against real rows, because the pairing is a SQL rule.
 */

import { randomUUID } from 'node:crypto'
import { beforeAll, describe, expect, it } from 'vitest'

const APP_URL = process.env.TEST_DATABASE_URL
const enabled = Boolean(APP_URL)
if (APP_URL) process.env.DATABASE_URL = APP_URL

const { chargeLines, invoices, jobs, withActor } = await import('@qabandi/db')
const { CUSTOMER, HOME_BRANCH, bothBranchesActor, world } = await import('@/lib/testing/fixtures')
const { getJobLedger, listMatchCandidates } = await import('./queries')

describe.skipIf(!enabled)('match candidates', () => {
  let chargeTypeId: string

  beforeAll(async () => {
    chargeTypeId = (await world()).chargeTypeId
  })

  async function aJob(): Promise<string> {
    return withActor(bothBranchesActor, async (tx) => {
      const [row] = await tx
        .insert(jobs)
        .values({
          reference: `MCH-${Math.random().toString(36).slice(2, 10).toUpperCase()}`,
          branchId: HOME_BRANCH,
          customerId: CUSTOMER,
          mode: 'sea_fcl',
          tradeDirection: 'import',
          status: 'in_transit',
        })
        .returning({ id: jobs.id })
      return row!.id
    })
  }

  async function aCost(
    jobId: string,
    amount: string,
    source?: { kind: string; id: string },
  ): Promise<string> {
    return withActor(bothBranchesActor, async (tx) => {
      const [row] = await tx
        .insert(chargeLines)
        .values({
          branchId: HOME_BRANCH,
          jobId,
          chargeTypeId,
          direction: 'cost',
          basis: 'flat',
          quantity: '1',
          rate: amount,
          amount,
          currency: 'KWD',
          fxRate: '1',
          amountBase: amount,
          baseCurrency: 'KWD',
          sourceKind: source?.kind ?? null,
          sourceId: source?.id ?? null,
        })
        .returning({ id: chargeLines.id })
      return row!.id
    })
  }

  it('offers live costs only — not reversals, nor the shares they undid', async () => {
    const jobId = await aJob()
    const master = randomUUID()
    const own = await aCost(jobId, '75.000')
    const undone = await aCost(jobId, '150.000', { kind: 'consol_allocation', id: master })
    const reversal = await aCost(jobId, '-150.000', {
      kind: 'consol_allocation_reversal',
      id: master,
    })
    const reallocated = await aCost(jobId, '140.000', { kind: 'consol_allocation', id: master })

    const offered = (await listMatchCandidates(bothBranchesActor, { jobId })).map((c) => c.id)

    expect(offered).toContain(own)
    expect(offered).toContain(reallocated)
    expect(offered).not.toContain(undone)
    expect(offered).not.toContain(reversal)
  })

  /**
   * N6: a credit note writes invoice lines and no charge line, so the job's
   * P&L kept the whole sell figure after one. The credit is taken off revenue
   * in base, and only the job's share of it where an invoice bills two jobs.
   */
  it('nets credit notes against the job’s revenue, in base, by its share', async () => {
    const jobId = await aJob()
    const otherJobId = await aJob()
    const run = Math.random().toString(36).slice(2, 8).toUpperCase()

    await withActor(bothBranchesActor, async (tx) => {
      // A USD invoice of 2,000.00 billing 600 KWD of this job and 400 of another.
      const [invoice] = await tx
        .insert(invoices)
        .values({
          branchId: HOME_BRANCH,
          customerId: CUSTOMER,
          seriesNo: `N6-${run}-1`,
          status: 'issued',
          currency: 'USD',
          subtotal: '2000.00',
          total: '2000.00',
        })
        .returning({ id: invoices.id })
      const revenue = (job: string, usd: string, kwd: string) => ({
        branchId: HOME_BRANCH,
        jobId: job,
        chargeTypeId,
        direction: 'revenue' as const,
        basis: 'flat' as const,
        quantity: '1',
        rate: usd,
        amount: usd,
        currency: 'USD',
        fxRate: '0.3',
        amountBase: kwd,
        baseCurrency: 'KWD',
        invoiceId: invoice!.id,
      })
      await tx
        .insert(chargeLines)
        .values([revenue(jobId, '1200.00', '600.000'), revenue(otherJobId, '800.00', '400.000')])
      // A tenth of the invoice credited, and a void note that credited nothing.
      await tx.insert(invoices).values([
        {
          branchId: HOME_BRANCH,
          customerId: CUSTOMER,
          seriesNo: `N6-${run}-2`,
          status: 'credited',
          isCreditNote: true,
          creditsInvoiceId: invoice!.id,
          currency: 'USD',
          subtotal: '200.00',
          total: '200.00',
          amountPaid: '200.00',
        },
        {
          branchId: HOME_BRANCH,
          customerId: CUSTOMER,
          seriesNo: `N6-${run}-3`,
          status: 'void',
          isCreditNote: true,
          creditsInvoiceId: invoice!.id,
          currency: 'USD',
          subtotal: '500.00',
          total: '500.00',
        },
      ])
    })
    await aCost(jobId, '450.000')

    const ledger = await getJobLedger(bothBranchesActor, jobId)
    expect(ledger!.creditedRevenue).toMatch(/^60\.0+$/)
    expect(ledger!.margin.revenue.amount.toFixed(3)).toBe('540.000')
    expect(ledger!.margin.gross.amount.toFixed(3)).toBe('90.000')
    expect(ledger!.margin.grossPercent?.toFixed(1)).toBe('16.7')
    // The charge lines themselves are untouched; the credit is not a line.
    expect(ledger!.lines.filter((l) => l.direction === 'revenue')).toHaveLength(1)

    const other = await getJobLedger(bothBranchesActor, otherJobId)
    expect(other!.margin.revenue.amount.toFixed(3)).toBe('360.000')
  })
})
