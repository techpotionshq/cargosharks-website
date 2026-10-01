/**
 * Revenue earned and never asked for, and the one act that bills it.
 *
 * The register is a read and could be wrong quietly; `billJob` writes an
 * invoice and stamps the lines, and being wrong there costs money in both
 * directions. Billing twice puts the same charge on two documents in front of
 * a customer; billing nothing leaves the leak the register exists to close.
 *
 * So what is pinned is the stamping. `charge_lines.invoice_id` is what makes a
 * line billed, and it is set in the same transaction as the insert — a second
 * run must find nothing, and that is asserted rather than assumed.
 *
 * The other three are refusals, and each is a decision that could have gone
 * the other way:
 *
 *   - **accruals are excluded.** An accrual is our own estimate of a cost
 *     still to come. Putting one on a customer invoice bills them for a
 *     guess.
 *   - **cost lines are excluded.** A cost with no invoice means nobody has
 *     billed *us* yet, which is payables' business, not a leak.
 *   - **two currencies is refused, never converted.** The sell-side rate is
 *     one a customer agreed; inventing one here would make up a number and
 *     put it on a document.
 */

import { beforeAll, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { D } from '@qabandi/core'

const APP_URL = process.env.TEST_DATABASE_URL
const enabled = Boolean(APP_URL)
if (APP_URL) process.env.DATABASE_URL = APP_URL

const harness = vi.hoisted(() => ({ session: null as unknown }))

vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))
vi.mock('@/lib/session', () => ({ requireSession: async () => harness.session }))

/**
 * The message keys stand in for the sentences, so an assertion names the case
 * rather than a wording a translator is free to change — as in `auth/actions.test.ts`.
 */
vi.mock('next-intl/server', () => ({
  getTranslations: async (namespace: string) => (key: string, values?: Record<string, unknown>) =>
    values ? `${namespace}.${key}:${JSON.stringify(values)}` : `${namespace}.${key}`,
}))

const { chargeLines, invoiceLines, invoices, jobs, withActor } = await import('@qabandi/db')

const { AWAY_BRANCH, CUSTOMER, HOME_BRANCH, PRINCIPAL, bothBranchesActor, world } =
  await import('@/lib/testing/fixtures')

const { billJob, setInvoiceStatus } = await import('./form-actions')
const { unbilledRevenue, unbilledLinesFor } = await import('./unbilled')

const session = {
  actor: bothBranchesActor,
  principal: {
    id: PRINCIPAL,
    nameEn: 'Finance',
    nameAr: null,
    email: 'finance@qabandi.test',
    locale: 'en' as const,
  },
  permissions: new Set(['invoice.approve', 'invoice.void']),
  branchRoles: new Map([
    [HOME_BRANCH, 'finance'],
    [AWAY_BRANCH, 'finance'],
  ]),
  requiresTwoFactor: false,
}

const form = (fields: Record<string, string>): FormData => {
  const data = new FormData()
  for (const [key, value] of Object.entries(fields)) data.set(key, value)
  return data
}

describe.skipIf(!enabled)('revenue that was never billed', () => {
  let chargeTypeId: string

  beforeAll(async () => {
    // `charge_type_id` is not null on `charge_lines` — every ledger line is
    // coded, which is what makes the P&L groupable at all.
    chargeTypeId = (await world()).chargeTypeId
    harness.session = session
  })

  /**
   * Charge lines are written directly rather than through the costing form.
   *
   * The form is a different slice's contract and would drag its validation
   * into a test about billing. What matters here is the ledger row's shape —
   * direction, accrual, invoice_id — which is what `unbilled.ts` reads.
   */
  async function aLine(jobId: string, over: Record<string, unknown> = {}): Promise<string> {
    return withActor(bothBranchesActor, async (tx) => {
      const [row] = await tx
        .insert(chargeLines)
        .values({
          branchId: HOME_BRANCH,
          jobId,
          chargeTypeId,
          direction: 'revenue',
          basis: 'flat',
          description: 'Ocean freight',
          quantity: '1',
          rate: '450.000',
          amount: '450.000',
          currency: 'KWD',
          fxRate: '1',
          amountBase: '450.000',
          baseCurrency: 'KWD',
          isAccrual: false,
          ...over,
        })
        .returning({ id: chargeLines.id })
      return row!.id
    })
  }

  const readLine = async (id: string) =>
    withActor(bothBranchesActor, async (tx) => {
      const [row] = await tx
        .select({ invoiceId: chargeLines.invoiceId })
        .from(chargeLines)
        .where(eq(chargeLines.id, id))
        .limit(1)
      return row
    })

  /**
   * A shipment of its own per case, rather than clearing a shared one.
   *
   * `DELETE` is revoked from `app_user` — nothing in this system is deleted
   * (§5.5) — so a `clearJob` helper is not merely untidy here, it is refused
   * by the grant. Isolation therefore comes from a fresh row, which is also
   * what stops these cases from deciding each other's outcome when the suite
   * runs beside its siblings.
   */
  async function aJob(): Promise<string> {
    return withActor(bothBranchesActor, async (tx) => {
      const [row] = await tx
        .insert(jobs)
        .values({
          reference: `UNB-${Math.random().toString(36).slice(2, 10).toUpperCase()}`,
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

  it('drafts an invoice from the lines and stamps them billed', async () => {
    const jobId = await aJob()
    const first = await aLine(jobId)
    const second = await aLine(jobId, {
      description: 'Terminal handling',
      rate: '80.000',
      amount: '80.000',
      amountBase: '80.000',
    })

    const state = await billJob({}, form({ jobId }))

    expect(state.message).toBeUndefined()

    /*
      The invoice is found through the stamped line rather than through the
      action's return, and that is the stronger assertion: `succeed()` hands
      back an opaque change token for the dialog to close on, while
      `charge_lines.invoice_id` is the column that actually decides whether
      this revenue can be billed a second time.
    */
    const invoiceId = (await readLine(first))?.invoiceId
    expect(invoiceId).toBeTruthy()

    const [invoice] = await withActor(bothBranchesActor, (tx) =>
      tx.select().from(invoices).where(eq(invoices.id, invoiceId!)).limit(1),
    )
    expect(invoice?.status).toBe('draft')
    // Summed from the lines, not typed: 450 + 80.
    expect(Number(invoice?.subtotal)).toBeCloseTo(530, 3)
    expect(Number(invoice?.total)).toBeCloseTo(530, 3)

    const lines = await withActor(bothBranchesActor, (tx) =>
      tx.select().from(invoiceLines).where(eq(invoiceLines.invoiceId, invoiceId!)),
    )
    expect(lines).toHaveLength(2)

    expect((await readLine(second))?.invoiceId).toBe(invoiceId)
  })

  /**
   * The property that stops the same money reaching two documents.
   *
   * `invoice_id` is set in the same transaction as the insert, so a crash
   * leaves nothing rather than an invoice with loose lines behind it — which
   * is exactly the state that would bill them again from this register.
   */
  it('finds nothing left to bill on a second run', async () => {
    const jobId = await aJob()
    await aLine(jobId)
    await billJob({}, form({ jobId }))

    const again = await billJob({}, form({ jobId }))

    expect(again.message).toBe('ledgerValidation.nothingUnbilled')
    expect(await unbilledLinesFor(bothBranchesActor, jobId)).toEqual([])
  })

  /** Our own estimate of a cost to come is not a thing to bill a customer for. */
  /*
    F11. Voiding the draft left \`charge_lines.invoice_id\` pointing at it, so
    the revenue left the register and could never be billed again.
  */
  it('gives the revenue back when the draft is voided', async () => {
    const jobId = await aJob()
    const line = await aLine(jobId)
    await billJob({}, form({ jobId }))
    const invoiceId = (await readLine(line))!.invoiceId!

    const voided = await setInvoiceStatus({}, form({ invoiceId, status: 'void' }))

    expect(voided.message).toBeUndefined()
    expect((await readLine(line))?.invoiceId).toBeNull()
    const again = await billJob({}, form({ jobId }))
    expect(again.message).toBeUndefined()
    expect((await readLine(line))?.invoiceId).toBeTruthy()
  })

  /** F11. No due date meant no ageing bucket, and never overdue. */
  it('gives the draft a due date from the terms, and a note in the reader’s language', async () => {
    const jobId = await aJob()
    const line = await aLine(jobId)
    await billJob({}, form({ jobId }))
    const invoiceId = (await readLine(line))!.invoiceId!

    const [invoice] = await withActor(bothBranchesActor, (tx) =>
      tx.select().from(invoices).where(eq(invoices.id, invoiceId)).limit(1),
    )
    expect(invoice?.dueOn).toBeTruthy()
    expect(invoice?.notes).toMatch(/^invoices\.billedFrom:/)
  })

  it('leaves an accrual alone', async () => {
    const jobId = await aJob()
    const accrual = await aLine(jobId, { isAccrual: true })

    const state = await billJob({}, form({ jobId }))

    expect(state.message).toBe('ledgerValidation.nothingUnbilled')
    expect((await readLine(accrual))?.invoiceId).toBeNull()
  })

  /** A cost with no invoice means nobody has billed *us*. That is payables. */
  it('leaves a cost line alone', async () => {
    const jobId = await aJob()
    const cost = await aLine(jobId, { direction: 'cost' })

    const state = await billJob({}, form({ jobId }))

    expect(state.message).toBe('ledgerValidation.nothingUnbilled')
    expect((await readLine(cost))?.invoiceId).toBeNull()
  })

  /**
   * Two currencies is refused, and nothing is written.
   *
   * Converting would invent a sell-side rate nobody agreed with the customer.
   * The partial failure would be worse than the refusal: one currency billed
   * and the other left loose reads, on this register, as a job already done.
   */
  it('refuses a shipment billing in two currencies, and writes nothing', async () => {
    const jobId = await aJob()
    const kwd = await aLine(jobId)
    const usd = await aLine(jobId, {
      currency: 'USD',
      rate: '200.000',
      amount: '200.000',
      fxRate: '0.307',
      amountBase: '61.400',
    })

    const state = await billJob({}, form({ jobId }))

    expect(state.message).toContain('ledgerValidation.mixedCurrency')
    expect((await readLine(kwd))?.invoiceId).toBeNull()
    expect((await readLine(usd))?.invoiceId).toBeNull()
  })

  it('shows the shipment on the register with its total and its age', async () => {
    const jobId = await aJob()
    await aLine(jobId)
    await aLine(jobId, { rate: '80.000', amount: '80.000', amountBase: '80.000' })

    const summary = await unbilledRevenue(bothBranchesActor)
    const row = summary.jobs.find((job) => job.jobId === jobId)

    expect(row).toBeDefined()
    expect(row?.lines).toBe(2)
    expect(Number(row?.amountBase)).toBeCloseTo(530, 3)
    expect(row?.currencies).toEqual(['KWD'])
    expect(row?.oldestAt).toBeInstanceOf(Date)
  })

  /** A billed line has left the register — that is what the column means. */
  it('drops off the register once it is billed', async () => {
    const jobId = await aJob()
    await aLine(jobId)
    await billJob({}, form({ jobId }))

    const summary = await unbilledRevenue(bothBranchesActor)

    expect(summary.jobs.find((job) => job.jobId === jobId)).toBeUndefined()
  })

  /*
    The header total is one figure per base currency. It used to be a single
    `Number` sum over every row, `toFixed(3)`, labelled with the first row's
    currency — so a Dubai branch's dirhams were added to Kuwait's dinars.

    A wide limit so this job is on the page however much the register holds.
  */
  it('totals each base currency on its own, as strings', async () => {
    const kwdJob = await aJob()
    await aLine(kwdJob)
    const aedJob = await aJob()
    await aLine(aedJob, {
      currency: 'AED',
      rate: '120.00',
      amount: '120.00',
      amountBase: '120.00',
      baseCurrency: 'AED',
    })

    const summary = await unbilledRevenue(bothBranchesActor, 100_000)
    const total = (currency: string) =>
      summary.totals.find((entry) => entry.currency === currency)?.amount

    const codes = summary.totals.map((entry) => entry.currency)
    expect(new Set(codes).size).toBe(codes.length)
    for (const entry of summary.totals) expect(typeof entry.amount).toBe('string')

    // Each total is exactly the sum of its own rows, and of nothing else.
    for (const currency of ['KWD', 'AED']) {
      const rows = summary.jobs.filter((job) => job.baseCurrency === currency)
      const expected = rows.reduce((acc, job) => acc.plus(job.amountBase), new D(0))
      expect(new D(total(currency)!).equals(expected)).toBe(true)
    }
    expect(new D(total('AED')!).greaterThanOrEqualTo('120')).toBe(true)
  })

  it('names the mixed currencies on the register so the refusal is visible first', async () => {
    const jobId = await aJob()
    await aLine(jobId)
    await aLine(jobId, { currency: 'USD', amountBase: '61.400' })

    const summary = await unbilledRevenue(bothBranchesActor)
    const row = summary.jobs.find((job) => job.jobId === jobId)

    expect([...(row?.currencies ?? [])].sort()).toEqual(['KWD', 'USD'])
  })
})
