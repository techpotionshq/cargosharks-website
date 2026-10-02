/**
 * Writing to the charge ledger by hand — FR-FN-01, FR-FN-03.
 *
 * Most cost lines are written by something else: the free-time accrual worker,
 * the consolidation allocator, the duty estimator. This is the path for the
 * ones that are not — a haulier's call-out, an inspection nobody predicted —
 * and for correcting one before it has been billed or matched.
 *
 * **Two freezes, and the second is the interesting one.** A line invoiced to
 * the customer is frozen because §5.5 says nothing is deleted. A line a
 * supplier has been matched against is frozen because editing the accrual
 * after the match would silently change a variance somebody has already
 * reviewed and approved — the one number on this feature that has to stay put.
 * Both are read and written inside the same transaction, and the `where`
 * repeats the condition rather than trusting the read, so two people editing a
 * line while a third bills it cannot both pass a check that was true a moment
 * ago.
 *
 * **Money is arithmetic in `Decimal`, per currency.** The rounding is not
 * PostgreSQL's job here: a KWD line rounds to three places and a USD line to
 * two, and `numeric` has no opinion about which. `z.coerce.number()` would be
 * the obvious spelling of the input and is exactly the bug — it turns `8.700`
 * into a float on the way in and every downstream figure inherits the error.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { desc, eq } from 'drizzle-orm'

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

const { chargeLines, currencies, fxRates, jobs, withActor } = await import('@qabandi/db')

const { AWAY_BRANCH, CUSTOMER, HOME_BRANCH, PARTNER, PRINCIPAL, bothBranchesActor, world } =
  await import('@/lib/testing/fixtures')

const { saveChargeLine } = await import('./form-actions')

const systemActor = { ...bothBranchesActor, type: 'system' as const }

function sessionWith(permissions: readonly string[], branches = [HOME_BRANCH, AWAY_BRANCH]) {
  return {
    actor: bothBranchesActor,
    principal: {
      id: PRINCIPAL,
      nameEn: 'Costing Clerk',
      nameAr: null,
      email: 'costing@qabandi.test',
      locale: 'en' as const,
    },
    permissions: new Set(permissions),
    branchRoles: new Map(branches.map((id) => [id, 'operations_manager'])),
    requiresTwoFactor: false,
  }
}

const form = (fields: Record<string, string>): FormData => {
  const data = new FormData()
  for (const [key, value] of Object.entries(fields)) data.set(key, value)
  return data
}

const RUN = Date.now().toString(36).toUpperCase().slice(-5)
let seq = 0
let chargeTypeId: string

async function freshJob(branchId = HOME_BRANCH): Promise<string> {
  seq += 1
  return withActor(systemActor, async (tx) => {
    const [row] = await tx
      .insert(jobs)
      .values({
        reference: `CST-${RUN}-${seq}`,
        branchId,
        customerId: CUSTOMER,
        mode: 'sea_fcl',
        tradeDirection: 'import',
        status: 'in_transit',
      })
      .returning({ id: jobs.id })
    return row!.id
  })
}

const lineForm = (jobId: string, extra: Record<string, string> = {}) =>
  form({
    jobId,
    direction: 'cost',
    chargeTypeId,
    basis: 'flat',
    quantity: '1',
    rate: '100.000',
    currency: 'KWD',
    fxRate: '1',
    ...extra,
  })

async function latestLine(jobId: string) {
  const [row] = await withActor(bothBranchesActor, (tx) =>
    tx
      .select()
      .from(chargeLines)
      .where(eq(chargeLines.jobId, jobId))
      .orderBy(desc(chargeLines.createdAt))
      .limit(1),
  )
  return row
}

describe.skipIf(!enabled)('the charge ledger, written by hand', () => {
  beforeAll(async () => {
    const built = await world()
    chargeTypeId = built.chargeTypeId
    harness.session = sessionWith(['job.update'])
  })

  afterAll(() => {
    harness.session = null
  })

  describe('adding a line', () => {
    it('records a cost against the shipment', async () => {
      const jobId = await freshJob()

      const state = await saveChargeLine(
        {},
        lineForm(jobId, { description: 'Haulier call-out, Sunday' }),
      )

      expect(state.errors).toBeUndefined()
      expect(state.message).toBeUndefined()
      const line = await latestLine(jobId)
      expect(line?.direction).toBe('cost')
      expect(line?.description).toBe('Haulier call-out, Sunday')
      // The branch comes from the shipment, not the form.
      expect(line?.branchId).toBe(HOME_BRANCH)
    })

    /**
     * Three decimals, because KWD carries three. A global `toFixed(2)` would
     * corrupt every Kuwaiti amount, which is why the rounding is per currency
     * rather than left to the column.
     */
    it('rounds a Kuwaiti amount to three places', async () => {
      const jobId = await freshJob()
      await saveChargeLine({}, lineForm(jobId, { quantity: '3', rate: '8.7005' }))

      const line = await latestLine(jobId)
      // 3 × 8.7005 = 26.1015, to three places.
      expect(line?.amount).toBe('26.102000')
    })

    /** Two places for a dollar, from the same code path and the same input. */
    it('rounds a dollar amount to two places', async () => {
      const jobId = await freshJob()
      await saveChargeLine(
        {},
        lineForm(jobId, { quantity: '3', rate: '8.7005', currency: 'USD', fxRate: '0.307' }),
      )

      const line = await latestLine(jobId)
      expect(line?.amount).toBe('26.100000')
    })

    it('converts to the branch’s base currency at the rate it was given', async () => {
      const jobId = await freshJob()
      await saveChargeLine(
        {},
        lineForm(jobId, { rate: '100.00', currency: 'USD', fxRate: '0.307' }),
      )

      const line = await latestLine(jobId)
      expect(line?.currency).toBe('USD')
      expect(line?.baseCurrency).toBe('KWD')
      expect(line?.amountBase).toBe('30.700000')
    })

    /** No conversion where there is nothing to convert — the rate is ignored. */
    it('leaves a base-currency line at its own amount', async () => {
      const jobId = await freshJob()
      await saveChargeLine({}, lineForm(jobId, { rate: '250.500', fxRate: '99' }))

      const line = await latestLine(jobId)
      expect(line?.amount).toBe(line?.amountBase)
    })

    it('records a revenue line as well as a cost one', async () => {
      const jobId = await freshJob()
      await saveChargeLine({}, lineForm(jobId, { direction: 'revenue' }))

      expect((await latestLine(jobId))?.direction).toBe('revenue')
    })

    /*
      O3. "Rate to base" defaulted to 1 and the action trusted it, so a USD
      2,900 cost was booked as KWD 2,900. Blank now takes the latest rate on
      file; nothing on file is a sentence on the field, never 1.

      Two ISO test codes of this suite's own, because the database is never
      emptied and a rate written here for a real currency would be read by
      every other suite that converts it.
    */
    it('takes the latest rate on file when none was typed', async () => {
      const today = new Date().toISOString().slice(0, 10)
      await withActor(systemActor, async (tx) => {
        await tx
          .insert(currencies)
          .values([
            { code: 'XTS', nameEn: 'Test currency', nameAr: 'عملة اختبار', minorUnits: 2 },
            { code: 'XXX', nameEn: 'No currency', nameAr: 'بلا عملة', minorUnits: 2 },
          ])
          .onConflictDoNothing()
        await tx
          .insert(fxRates)
          .values({
            fromCurrency: 'XTS',
            toCurrency: 'KWD',
            rate: '0.30700000',
            source: 'costing-test',
            effectiveOn: today,
          })
          .onConflictDoNothing()
      })

      const jobId = await freshJob()
      const state = await saveChargeLine(
        {},
        lineForm(jobId, { rate: '2900.00', currency: 'XTS', fxRate: '' }),
      )
      expect(state.errors).toBeUndefined()
      const line = await latestLine(jobId)
      expect(line?.fxRate).toBe('0.30700000')
      expect(line?.amountBase).toBe('890.300000')

      const none = await saveChargeLine(
        {},
        lineForm(await freshJob(), { rate: '10.00', currency: 'XXX', fxRate: '' }),
      )
      expect(none.errors?.fxRate).toBe('costingValidation.noRateOnFile:{"from":"XXX","to":"KWD"}')
    })

    /*
      O10. The edit dialog was given no counterparty, so it opened on "none"
      and saving wrote null. A form without the customer field leaves that
      one alone too.
    */
    it('keeps the counterparty through an edit', async () => {
      const jobId = await freshJob()
      await saveChargeLine(
        {},
        lineForm(jobId, { counterpartyPartnerId: PARTNER, counterpartyCustomerId: CUSTOMER }),
      )
      const line = await latestLine(jobId)

      await saveChargeLine(
        {},
        lineForm(jobId, {
          chargeLineId: line!.id,
          rate: '120.000',
          counterpartyPartnerId: PARTNER,
        }),
      )

      const after = await latestLine(jobId)
      expect(after?.amount).toBe('120.000000')
      expect(after?.counterpartyPartnerId).toBe(PARTNER)
      expect(after?.counterpartyCustomerId).toBe(CUSTOMER)
    })

    it('records who the line is with', async () => {
      const jobId = await freshJob()
      await saveChargeLine({}, lineForm(jobId, { counterpartyPartnerId: PARTNER }))

      expect((await latestLine(jobId))?.counterpartyPartnerId).toBe(PARTNER)
    })

    it('records a per-container line with its quantity', async () => {
      const jobId = await freshJob()
      await saveChargeLine(
        {},
        lineForm(jobId, { basis: 'per_container', quantity: '4', rate: '75.000' }),
      )

      const line = await latestLine(jobId)
      expect(line?.basis).toBe('per_container')
      expect(line?.amount).toBe('300.000000')
    })

    it('accepts a negative rate, which is how a credit is recorded', async () => {
      const jobId = await freshJob()
      const state = await saveChargeLine({}, lineForm(jobId, { rate: '-50.000' }))

      expect(state.errors).toBeUndefined()
      expect((await latestLine(jobId))?.amount).toBe('-50.000000')
    })

    it('refuses a rate that is not a number', async () => {
      const jobId = await freshJob()
      expect(
        (await saveChargeLine({}, lineForm(jobId, { rate: 'a lot' }))).errors?.rate,
      ).toBeDefined()
    })

    /** `numeric(19,6)` — seven decimals is not a rate, it is a paste error. */
    it('refuses a rate with more precision than the column holds', async () => {
      const jobId = await freshJob()
      expect(
        (await saveChargeLine({}, lineForm(jobId, { rate: '1.1234567' }))).errors?.rate,
      ).toBeDefined()
    })

    it('insists on a charge type', async () => {
      const jobId = await freshJob()
      const state = await saveChargeLine({}, lineForm(jobId, { chargeTypeId: '' }))
      expect(state.errors?.chargeTypeId).toBeDefined()
    })

    it('refuses a basis it does not model', async () => {
      const jobId = await freshJob()
      expect(
        (await saveChargeLine({}, lineForm(jobId, { basis: 'per_smile' }))).errors?.basis,
      ).toBeDefined()
    })

    it('reports field errors rather than throwing on a bad form', async () => {
      expect((await saveChargeLine({}, form({}))).errors).toBeDefined()
    })

    /** Not-found rather than forbidden, and said rather than thrown. */
    it('says the shipment is no longer visible', async () => {
      const state = await saveChargeLine({}, lineForm('00000000-0000-7000-8000-0000000000c1'))
      expect(state.message).toBe('costingValidation.jobNotVisible')
    })

    it('refuses a caller who may not touch the shipment', async () => {
      const jobId = await freshJob()
      harness.session = sessionWith([])
      try {
        await expect(saveChargeLine({}, lineForm(jobId))).resolves.toMatchObject({
          message: expect.stringContaining('forbiddenAction'),
        })
      } finally {
        harness.session = sessionWith(['job.update'])
      }
    })

    /**
     * The branch is checked against the *shipment's* branch, read inside the
     * transaction — so a job the actor can see under RLS but holds no role in
     * is still refused.
     */
    it('refuses a shipment in a branch the clerk does not hold', async () => {
      const jobId = await freshJob(AWAY_BRANCH)
      harness.session = sessionWith(['job.update'], [HOME_BRANCH])
      try {
        await expect(saveChargeLine({}, lineForm(jobId))).resolves.toMatchObject({
          message: expect.stringContaining('forbiddenAction'),
        })
      } finally {
        harness.session = sessionWith(['job.update'])
      }
    })
  })

  describe('correcting a line', () => {
    it('edits the line it was given rather than adding another', async () => {
      const jobId = await freshJob()
      await saveChargeLine({}, lineForm(jobId, { rate: '100.000' }))
      const before = await latestLine(jobId)

      const state = await saveChargeLine(
        {},
        lineForm(jobId, { chargeLineId: before!.id, rate: '175.500' }),
      )

      expect(state.errors).toBeUndefined()
      const rows = await withActor(bothBranchesActor, (tx) =>
        tx.select({ id: chargeLines.id }).from(chargeLines).where(eq(chargeLines.jobId, jobId)),
      )
      expect(rows).toHaveLength(1)
      expect((await latestLine(jobId))?.amount).toBe('175.500000')
    })

    it('treats a line it cannot see as missing', async () => {
      const jobId = await freshJob()
      const state = await saveChargeLine(
        {},
        lineForm(jobId, { chargeLineId: '00000000-0000-7000-8000-0000000000c2' }),
      )
      expect(state.message).toBe('costingValidation.jobNotVisible')
    })

    /**
     * Frozen once billed. Nothing is deleted (§5.5), so the answer is a credit
     * note rather than an edit, and the message says so.
     */
    it('refuses to edit a line already billed to the customer', async () => {
      const jobId = await freshJob()
      await saveChargeLine({}, lineForm(jobId))
      const line = await latestLine(jobId)

      const invoiceId = await withActor(systemActor, async (tx) => {
        const [invoice] = await tx
          .execute(
            `insert into invoices (branch_id, customer_id, status, currency, subtotal, tax_amount, total, tax_treatment)
           values ('${HOME_BRANCH}', '${CUSTOMER}', 'draft', 'KWD', 100, 0, 100, 'out_of_scope')
           returning id`,
          )
          .then((r) => r.rows as { id: string }[])
        await tx
          .update(chargeLines)
          .set({ invoiceId: invoice!.id })
          .where(eq(chargeLines.id, line!.id))
        return invoice!.id
      })
      expect(invoiceId).toBeTruthy()

      const state = await saveChargeLine(
        {},
        lineForm(jobId, { chargeLineId: line!.id, rate: '999.000' }),
      )

      expect(state.message).toBe('costingValidation.lineBilled')
      // Unchanged: the refusal is a refusal, not a warning.
      expect((await latestLine(jobId))?.amount).toBe('100.000000')
    })
  })
})
