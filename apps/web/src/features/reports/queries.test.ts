/**
 * The margin report, against a real database.
 *
 * What is pinned here is the grouping. `amount_base` is in each branch's own
 * base currency, and every cut except the branch one used to sum across
 * branches — dinars and dirhams in one figure, labelled with whichever
 * currency sorted first. Each row now carries one base currency, so a group
 * that spans two is two rows (F16).
 */

import { beforeAll, describe, expect, it } from 'vitest'

const APP_URL = process.env.TEST_DATABASE_URL
const enabled = Boolean(APP_URL)
if (APP_URL) process.env.DATABASE_URL = APP_URL

const { chargeLines, invoices, jobs, locations, withActor } = await import('@qabandi/db')
const { CUSTOMER, HOME_BRANCH, bothBranchesActor, world } = await import('@/lib/testing/fixtures')
const { REPORT_DIMENSIONS, marginByDimension } = await import('./queries')
const { getJobLedger } = await import('@/features/costing/queries')

describe.skipIf(!enabled)('margin by dimension', () => {
  let chargeTypeId: string

  beforeAll(async () => {
    chargeTypeId = (await world()).chargeTypeId
  })

  /*
    R7, live run 5: job C was invoiced KWD 575.072 and credited KWD 50. The
    job P&L read "Revenue KWD 525.072 After KWD 50.000 in credit notes"; the
    margin report and its CSV still said 575.072. The report now nets credit
    notes by the same SQL the P&L uses, so the two agree on every cut.
  */
  it('takes credit notes off revenue, as the job P&L does', async () => {
    const run = Math.random().toString(36).slice(2, 8).toUpperCase()
    const jobId = await withActor(bothBranchesActor, async (tx) => {
      // A lane of its own, so the lane row is this job alone.
      const ports = await tx
        .insert(locations)
        .values([
          { nameEn: `R7 Origin ${run}`, countryCode: 'AE', kind: 'airport' },
          { nameEn: `R7 Destination ${run}`, countryCode: 'KW', kind: 'airport' },
        ] as never)
        .returning({ id: locations.id })
      const [job] = await tx
        .insert(jobs)
        .values({
          reference: `R7-${run}`,
          branchId: HOME_BRANCH,
          customerId: CUSTOMER,
          mode: 'air',
          tradeDirection: 'import',
          status: 'delivered',
          originId: ports[0]!.id,
          destinationId: ports[1]!.id,
          etd: new Date('2031-03-10T08:00:00Z'),
        })
        .returning({ id: jobs.id })
      const [invoice] = await tx
        .insert(invoices)
        .values({
          branchId: HOME_BRANCH,
          customerId: CUSTOMER,
          seriesNo: `R7-${run}-1`,
          status: 'paid',
          currency: 'KWD',
          subtotal: '575.072',
          total: '575.072',
        })
        .returning({ id: invoices.id })
      const line = (direction: 'revenue' | 'cost', amount: string, invoiceId?: string) => ({
        branchId: HOME_BRANCH,
        jobId: job!.id,
        chargeTypeId,
        direction,
        basis: 'flat' as const,
        quantity: '1',
        rate: amount,
        amount,
        currency: 'KWD',
        fxRate: '1',
        amountBase: amount,
        baseCurrency: 'KWD',
        ...(invoiceId ? { invoiceId } : {}),
      })
      await tx
        .insert(chargeLines)
        .values([line('revenue', '575.072', invoice!.id), line('cost', '479.227')])
      await tx.insert(invoices).values({
        branchId: HOME_BRANCH,
        customerId: CUSTOMER,
        seriesNo: `R7-${run}-2`,
        status: 'issued',
        isCreditNote: true,
        creditsInvoiceId: invoice!.id,
        currency: 'KWD',
        subtotal: '50.000',
        total: '50.000',
      })
      return job!.id
    })

    const rows = await marginByDimension(bothBranchesActor, 'lane', {
      from: '2031-03-01',
      to: '2031-03-31',
    })
    const row = rows.find((r) => r.labelEn.startsWith(`R7 Origin ${run}`))!
    expect(row.revenue).toMatch(/^525\.0720*$/)
    expect(row.cost).toMatch(/^479\.2270*$/)
    expect(row.grossProfit).toMatch(/^45\.8450*$/)
    expect(row.jobCount).toBe(1)

    // The same figure the job's own P&L shows.
    const ledger = await getJobLedger(bothBranchesActor, jobId)
    expect(ledger!.margin.revenue.amount.toFixed(3)).toBe('525.072')
    expect(ledger!.margin.gross.amount.toFixed(3)).toBe('45.845')
  })

  it.each(REPORT_DIMENSIONS)('keeps each %s row in one base currency', async (dimension) => {
    const rows = await marginByDimension(bothBranchesActor, dimension, {
      from: '2000-01-01',
      to: '2100-12-31',
    })

    const keys = rows.map((row) => `${row.key}:${row.currency}`)
    expect(new Set(keys).size).toBe(keys.length)
    for (const row of rows) expect(row.currency).toMatch(/^[A-Z]{3}$/)
  })
})
