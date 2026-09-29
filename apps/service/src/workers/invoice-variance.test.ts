/**
 * The write path of the variance flag — FR-FN-09's alert, against a database.
 *
 * The decision is pure and lives in `core/matching.ts` (`varianceAlert`, tested
 * there against no infrastructure). What this covers is the half that decision
 * cannot reach on its own: the provisional accrual query that feeds it, and the
 * `notification_outbox` row it raises under the asking principal's RLS scope.
 *
 * The assertions are deliberately tolerance-independent. A charge type carries
 * a seeded variance tolerance this test does not control, so "over" is proven
 * with a bill at double the accrual — over on any tolerance a seed would set —
 * and "not raised" is proven with under-billing and with an un-accrued code,
 * neither of which the over-only rule ever flags whatever the tolerance is.
 */

import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { eq, sql } from 'drizzle-orm'
import type { Actor } from '@qabandi/db'

const APP_URL = process.env.TEST_DATABASE_URL
const enabled = Boolean(APP_URL)
if (APP_URL) process.env.DATABASE_URL = APP_URL

const {
  branches,
  chargeLines,
  customers,
  jobs,
  notificationOutbox,
  partners,
  principals,
  withActor,
  workingCalendars,
} = await import('@qabandi/db')

const { readExtractedInvoice, seedCurrencyLookup } = await import('@qabandi/core')
const { flagVariance } = await import('./invoice-extract')

/*
  Random ids and run-scoped codes, deliberately — a fixed id block collides
  with whatever other suite happened to pick the same one (the first draft
  reused free-time-accrual's), and `onConflictDoNothing` then silently keeps
  that suite's row and this test reads it back. Fresh ids each run cannot
  collide, and this DB never deletes (§5.5), so every suite here already
  accumulates its fixtures the same way.
*/
const RUN = Date.now().toString(36).toUpperCase().slice(-5)
const BRANCH = randomUUID()
const CUSTOMER = randomUUID()
const PRINCIPAL = randomUUID()
const PARTNER = randomUUID()
const JOB = randomUUID()
const CHARGE = randomUUID()
const CODE = `VAR-${RUN}`
const JOB_REF = `VAR-JOB-${RUN}`

const actor: Actor = { principalId: PRINCIPAL, type: 'internal', branchIds: [BRANCH] }
const systemActor = { ...actor, type: 'system' as const }

const KWD = seedCurrencyLookup('KWD')!
let seq = 0

/** The charge types this run resolves against — one accrued, one not. */
let accruedKey = ''
let accruedTypeId = ''
let unaccruedKey = ''

/**
 * An extracted invoice with one line on a given charge type — enough of the
 * shape for `flagVariance`, built through the real reader so the row `values`
 * are exactly what the worker sees.
 */
function extracted(chargeKey: string, amount: string, invoiceNumber: string) {
  return readExtractedInvoice(
    {
      invoiceNumber,
      invoiceDate: '2026-08-14',
      currency: 'KWD',
      subtotal: amount,
      taxAmount: '0',
      total: amount,
      lines: [
        {
          description: 'Ocean freight Jebel Ali to Shuwaikh',
          quantity: '1',
          unitPrice: amount,
          amount,
          taxAmount: '0',
          chargeType: chargeKey.toUpperCase(),
        },
      ],
      confidence: 0.95,
    },
    { currencies: new Set(['KWD']), chargeTypes: new Set([chargeKey.toUpperCase()]) },
  )
}

/** The reference map `flagVariance` resolves a line's charge type through. */
const reference = () => ({
  chargeTypeIds: new Map([
    [accruedKey.toUpperCase(), accruedTypeId],
    // The un-accrued code resolves to itself as an id it will never find a
    // charge line for — enough to reach the "no accrual, skip it" branch.
    [unaccruedKey.toUpperCase(), CHARGE],
  ]),
  chargeTypeKeys: [accruedKey, unaccruedKey],
  lookups: {
    chargeTypes: new Set([accruedKey.toUpperCase(), unaccruedKey.toUpperCase()]),
    currencies: new Set(['KWD']),
  },
})

/** Run the flag inside one transaction, as the asking principal would. */
async function flag(chargeKey: string, amount: string, jobId: string | null): Promise<string> {
  seq += 1
  const invoiceNumber = `VAR-${RUN}-${seq}`
  await withActor(actor, (tx) =>
    flagVariance(
      tx,
      { actor, branchId: BRANCH, assetId: CHARGE, partnerId: PARTNER, jobId },
      extracted(chargeKey, amount, invoiceNumber),
      KWD,
      'KWD',
      reference(),
    ),
  )
  return invoiceNumber
}

/** The outbox rows raised for one invoice reference. */
async function raised(invoiceNumber: string) {
  const rows = await withActor(actor, (tx) =>
    tx
      .select({ payload: notificationOutbox.payload })
      .from(notificationOutbox)
      .where(eq(notificationOutbox.eventKey, 'supplier_invoice.variance_flagged')),
  )
  return rows.filter(
    (row) => (row.payload as Record<string, unknown>).reference === invoiceNumber,
  )
}

describe.skipIf(!enabled)('the supplier-invoice variance flag', () => {
  beforeAll(async () => {
    await withActor(systemActor, async (tx) => {
      const [calendar] = await tx
        .select({ id: workingCalendars.id })
        .from(workingCalendars)
        .where(eq(workingCalendars.key, 'kuwait'))
        .limit(1)
      if (!calendar) throw new Error('Run `pnpm db:seed` before this suite')

      // Two real charge types, looked up rather than assumed: one gets an
      // accrual on the job, the other never does.
      const types = await tx.execute(sql`select id, key from charge_types limit 2`)
      const rows = types.rows as { id: string; key: string }[]
      if (rows.length < 2) throw new Error('Run `pnpm db:seed` — need two charge types')
      accruedTypeId = rows[0]!.id
      accruedKey = rows[0]!.key
      unaccruedKey = rows[1]!.key

      await tx.insert(principals).values({
        id: PRINCIPAL,
        type: 'internal',
        email: `variance-${RUN}@qabandi.test`,
        nameEn: 'Variance Fixture',
      })

      await tx.insert(branches).values({
        id: BRANCH,
        code: CODE,
        legalNameEn: 'Variance Branch',
        legalNameAr: 'فرع الفروقات',
        country: 'KW',
        baseCurrency: 'KWD',
        invoiceSeries: CODE,
        calendarId: calendar.id,
      })

      await tx
        .insert(customers)
        .values({ id: CUSTOMER, code: `${CODE}-C`, legalNameEn: 'Variance Customer' })

      await tx
        .insert(partners)
        .values({ id: PARTNER, code: `${CODE}-A`, type: 'agent', legalNameEn: 'Variance Agent' })

      await tx.insert(jobs).values({
        id: JOB,
        reference: JOB_REF,
        branchId: BRANCH,
        customerId: CUSTOMER,
        mode: 'sea_fcl',
        tradeDirection: 'import',
      })

      // The accrual: 400 KWD of cost booked to this partner for this charge
      // type. The bills below are measured against it.
      await tx
        .insert(chargeLines)
        .values({
          id: CHARGE,
          jobId: JOB,
          branchId: BRANCH,
          direction: 'cost',
          chargeTypeId: accruedTypeId,
          basis: 'flat',
          rate: '400.000000',
          amount: '400.000000',
          currency: 'KWD',
          amountBase: '400.000000',
          baseCurrency: 'KWD',
          counterpartyPartnerId: PARTNER,
        })
    })
  })

  afterAll(() => {
    // Nothing is deleted (§5.5); each test carries its own invoice reference, so
    // the outbox rows never confuse a later run.
  })

  it('raises one alert when the agent bills over the accrual', async () => {
    // 800 billed against 400 accrued — over on any tolerance a seed could set.
    const invoiceNumber = await flag(accruedKey, '800.000', JOB)

    const rows = await raised(invoiceNumber)
    expect(rows).toHaveLength(1)

    const payload = rows[0]!.payload as Record<string, unknown>
    expect(payload.jobReference).toBe(JOB_REF)
    expect(payload.currency).toBe('KWD')
    expect(payload.flaggedCount).toBe(1)
    expect(Number(payload.worstVariance)).toBeCloseTo(400, 3)
    expect(Number(payload.totalVariance)).toBeCloseTo(400, 3)
  })

  it('says nothing when the agent bills under the accrual', async () => {
    // Under is a P&L question, not money leaving — the review screen, not an alert.
    const invoiceNumber = await flag(accruedKey, '200.000', JOB)
    expect(await raised(invoiceNumber)).toEqual([])
  })

  it('says nothing about a charge type the job never accrued', async () => {
    const invoiceNumber = await flag(unaccruedKey, '900.000', JOB)
    expect(await raised(invoiceNumber)).toEqual([])
  })

  it('says nothing when no job is attached to compare against', async () => {
    const invoiceNumber = await flag(accruedKey, '800.000', null)
    expect(await raised(invoiceNumber)).toEqual([])
  })
})
