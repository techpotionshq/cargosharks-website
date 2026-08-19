/**
 * Recording a credit override — one act, and the record it leaves.
 *
 * There is exactly one thing to do in this slice: decide that a customer may
 * trade past their limit, and leave behind who decided it and why. What the
 * tests defend is the *record*, because the arithmetic is `checkCredit`'s and
 * is tested against a real database in `packages/db`.
 *
 * **An override rather than a raised limit.** Raising the limit is what
 * happens when there is no override: a container is urgent, somebody edits
 * 40,000 to 60,000 to get it moving, and nobody ever lowers it again. Six
 * months later the limit is a number ratcheted upwards by every emergency the
 * customer has had, which is the opposite of a credit control.
 *
 * **The figures are stamped, not recomputed.** Six weeks on, the customer has
 * paid two invoices and raised three; a screen that recomputed would show a
 * manager approving an amount nobody ever saw. The exposure written here is
 * also the *unproposed* position — a manager is answering "how far in is this
 * customer", and folding in a shipment that may never happen would put a
 * number on the record that was never true.
 *
 * **A reason somebody can review.** "ok", "approved" and "per MD" all satisfy
 * a required field and none of them is any use in a year. The column is
 * non-empty at the database; this layer is the one that asks for a sentence.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { desc, eq } from 'drizzle-orm'

const APP_URL = process.env.TEST_DATABASE_URL
const enabled = Boolean(APP_URL)
if (APP_URL) process.env.DATABASE_URL = APP_URL

const harness = vi.hoisted(() => ({ session: null as unknown, revalidated: [] as string[] }))

vi.mock('next/cache', () => ({
  revalidatePath: (path: string) => harness.revalidated.push(path),
  revalidateTag: vi.fn(),
}))
vi.mock('@/lib/session', () => ({ requireSession: async () => harness.session }))

const {
  branches,
  creditOverrides,
  customerBranchTerms,
  customers,
  invoices,
  jobs,
  principals,
  withActor,
  workingCalendars,
} = await import('@qabandi/db')

const { recordCreditOverride } = await import('./form-actions')
const { ForbiddenError } = await import('@/lib/permissions')

const BRANCH = '00000000-0000-7000-8000-00000000cf01'
const OTHER_BRANCH = '00000000-0000-7000-8000-00000000cf02'
const PRINCIPAL = '00000000-0000-7000-8000-00000000cf03'

const actor = { principalId: PRINCIPAL, type: 'internal' as const, branchIds: [BRANCH] }
const systemActor = { ...actor, type: 'system' as const }

function sessionWith(permissions: readonly string[]) {
  return {
    actor,
    principal: {
      id: PRINCIPAL,
      nameEn: 'Credit Manager',
      nameAr: null,
      email: 'credit-control@qabandi.test',
      locale: 'en' as const,
    },
    permissions: new Set(permissions),
    branchRoles: new Map([[BRANCH, 'finance']]),
    requiresTwoFactor: false,
  }
}

const RUN = Date.now().toString(36).toUpperCase().slice(-5)
let seq = 0

const REASON = 'Payment of 12,400 KWD in transit, confirmed by the bank this morning'

const form = (fields: Record<string, string>): FormData => {
  const data = new FormData()
  for (const [key, value] of Object.entries(fields)) data.set(key, value)
  return data
}

/**
 * A customer of this test's own, with terms at this branch.
 *
 * The limit lives on `customer_branch_terms`, not on the customer: five legal
 * entities means one group can hold a different limit at each, and a customer
 * blocked in Kuwait may still be trading in Dubai. Exposure accumulates and is
 * never cleared, so nothing here is shared with another case.
 */
async function customer(terms: Record<string, unknown> = {}): Promise<string> {
  seq += 1
  return withActor(systemActor, async (tx) => {
    const [row] = await tx
      .insert(customers)
      .values({
        code: `CRD-${RUN}-${seq}`,
        legalNameEn: `Credit Override Customer ${RUN}-${seq}`,
        primaryBranchId: BRANCH,
      })
      .returning({ id: customers.id })

    await tx.insert(customerBranchTerms).values({
      customerId: row!.id,
      branchId: BRANCH,
      paymentTermsDays: 30,
      creditLimit: '1000.000',
      creditCurrency: 'KWD',
      ...terms,
    })
    return row!.id
  })
}

/** An issued invoice, which is what exposure is made of. */
async function owed(customerId: string, total: string): Promise<void> {
  seq += 1
  await withActor(systemActor, (tx) =>
    tx.insert(invoices).values({
      branchId: BRANCH,
      customerId,
      status: 'issued',
      seriesNo: `CRD-${RUN}-${seq}`,
      currency: 'KWD',
      subtotal: total,
      taxAmount: '0.000',
      total,
      issuedAt: new Date('2026-06-01T09:00:00Z'),
      dueOn: '2026-07-01',
    }),
  )
}

/** The shipment an exception is granted for. */
async function job(customerId: string): Promise<string> {
  seq += 1
  return withActor(systemActor, async (tx) => {
    const [row] = await tx
      .insert(jobs)
      .values({
        reference: `CRD-JOB-${RUN}-${seq}`,
        branchId: BRANCH,
        customerId,
        mode: 'sea_fcl',
        tradeDirection: 'import',
        status: 'booked',
      })
      .returning({ id: jobs.id })
    return row!.id
  })
}

const latestOverride = async (customerId: string) => {
  const [row] = await withActor(actor, (tx) =>
    tx
      .select()
      .from(creditOverrides)
      .where(eq(creditOverrides.customerId, customerId))
      .orderBy(desc(creditOverrides.approvedAt))
      .limit(1),
  )
  return row
}

describe.skipIf(!enabled)('recording a credit override', () => {
  beforeAll(async () => {
    harness.session = sessionWith(['credit.override'])

    await withActor(systemActor, async (tx) => {
      const [calendar] = await tx
        .select({ id: workingCalendars.id })
        .from(workingCalendars)
        .where(eq(workingCalendars.key, 'kuwait'))
        .limit(1)
      if (!calendar) throw new Error('Run `pnpm db:seed` before this suite')

      await tx
        .insert(principals)
        .values({
          id: PRINCIPAL,
          type: 'internal',
          email: 'credit-override@qabandi.test',
          nameEn: 'Credit Override Fixture',
        })
        .onConflictDoNothing()

      await tx
        .insert(branches)
        .values([
          {
            id: BRANCH,
            code: 'CRO',
            legalNameEn: 'Credit Override Branch Co.',
            legalNameAr: 'فرع الائتمان',
            country: 'KW',
            baseCurrency: 'KWD',
            invoiceSeries: 'CRO',
            calendarId: calendar.id,
          },
          {
            id: OTHER_BRANCH,
            code: 'CRX',
            legalNameEn: 'Somewhere This Manager Cannot Reach',
            legalNameAr: 'فرع آخر',
            country: 'KW',
            baseCurrency: 'KWD',
            invoiceSeries: 'CRX',
            calendarId: calendar.id,
          },
        ])
        .onConflictDoNothing()
    })
  })

  afterAll(async () => {
    if (!enabled) return
    await withActor(systemActor, async (tx) => {
      await tx.update(invoices).set({ status: 'paid' }).where(eq(invoices.branchId, BRANCH))
      await tx.update(jobs).set({ closedAt: new Date() }).where(eq(jobs.branchId, BRANCH))
    })
  })

  describe('who may record one', () => {
    it('refuses a manager without the key', async () => {
      harness.session = sessionWith(['credit.read'])

      await expect(
        recordCreditOverride(
          {},
          form({ customerId: await customer(), branchId: BRANCH, reason: REASON }),
        ),
      ).rejects.toBeInstanceOf(ForbiddenError)

      harness.session = sessionWith(['credit.override'])
    })

    /**
     * The permission is not enough on its own. A finance manager at Kuwait
     * holding `credit.override` must not be able to authorise an exception at
     * Dubai, whose credit decisions are not theirs to take.
     */
    it('refuses a branch this manager does not sit in', async () => {
      await expect(
        recordCreditOverride(
          {},
          form({ customerId: await customer(), branchId: OTHER_BRANCH, reason: REASON }),
        ),
      ).rejects.toBeInstanceOf(ForbiddenError)
    })
  })

  describe('what it insists on', () => {
    it('wants a customer and a branch', async () => {
      const state = await recordCreditOverride({}, form({ reason: REASON }))

      expect(state.errors?.customerId).toBeTruthy()
      expect(state.errors?.branchId).toBeTruthy()
    })

    /**
     * Twenty characters, and the floor is the point. Three words satisfy a
     * required field and tell the person reviewing it in a year nothing at
     * all.
     */
    it('refuses a reason nobody could review', async () => {
      const state = await recordCreditOverride(
        {},
        form({ customerId: await customer(), branchId: BRANCH, reason: 'ok' }),
      )

      expect(state.errors?.reason).toMatch(/sentence/)
      // What was typed comes back, so the manager is not made to start again.
      expect(state.values?.reason).toBe('ok')
    })

    it('refuses a date it cannot read', async () => {
      const state = await recordCreditOverride(
        {},
        form({
          customerId: await customer(),
          branchId: BRANCH,
          reason: REASON,
          expiresOn: '31/12/2035',
        }),
      )

      expect(state.errors?.expiresOn).toMatch(/YYYY-MM-DD/)
    })

    /** An override that expired before it was written authorises nothing. */
    it('refuses an expiry that has already passed', async () => {
      const state = await recordCreditOverride(
        {},
        form({
          customerId: await customer(),
          branchId: BRANCH,
          reason: REASON,
          expiresOn: '2020-01-01',
        }),
      )

      expect(state.errors?.expiresOn).toMatch(/already passed/)
    })

    /**
     * Refused rather than stored. It would be a permanent, unreviewable row
     * authorising an exception to a rule that is not being applied — and the
     * moment somebody later sets a limit, it silently becomes an exemption
     * from it that nobody chose.
     */
    it('refuses a customer who has no limit to be excepted from', async () => {
      const id = await customer({ creditLimit: null, creditCurrency: null })

      const state = await recordCreditOverride(
        {},
        form({ customerId: id, branchId: BRANCH, reason: REASON }),
      )

      expect(state.errors?._).toMatch(/no credit limit/)
      expect(await latestOverride(id)).toBeUndefined()
    })
  })

  describe('the record it leaves', () => {
    it('names who approved it, and why', async () => {
      const id = await customer()

      const state = await recordCreditOverride(
        {},
        form({ customerId: id, branchId: BRANCH, reason: REASON }),
      )

      const row = await latestOverride(id)
      expect(state.ok).toMatch(new RegExp(`^${id}:`))
      expect(row?.approvedById).toBe(PRINCIPAL)
      expect(row?.reason).toBe(REASON)
      expect(row?.branchId).toBe(BRANCH)
    })

    /**
     * Stamped as they stand at approval, not recomputed on review. Same
     * reasoning as `quotes.priced_snapshot`.
     */
    it('stamps the exposure and the limit as they stood', async () => {
      const id = await customer()
      await owed(id, '250.000')

      await recordCreditOverride({}, form({ customerId: id, branchId: BRANCH, reason: REASON }))

      const row = await latestOverride(id)
      expect(Number(row?.exposure)).toBeCloseTo(250, 3)
      expect(Number(row?.creditLimit)).toBeCloseTo(1000, 3)
      expect(row?.currency).toBe('KWD')
    })

    /**
     * The unproposed position. A manager approving an override is answering
     * "how far in is this customer", and a figure that included the shipment
     * about to be booked would be a number that was never true of them.
     */
    it('records what is owed today, not what is about to be booked', async () => {
      const id = await customer()
      await owed(id, '100.000')

      await recordCreditOverride(
        {},
        // The form carries the booking, and the exposure still ignores it.
        form({ customerId: id, branchId: BRANCH, reason: REASON, proposed: '5000.000' }),
      )

      expect(Number((await latestOverride(id))?.exposure)).toBeCloseTo(100, 3)
    })

    /**
     * Blank is a one-shot tied to the job or invoice named on it. A date makes
     * it standing until then — which is the only thing that can release a
     * *booking*, since a job has no id before it exists.
     */
    it('is a one-shot unless a date makes it standing', async () => {
      const oneShot = await customer()
      const standing = await customer()

      await recordCreditOverride(
        {},
        form({ customerId: oneShot, branchId: BRANCH, reason: REASON }),
      )
      await recordCreditOverride(
        {},
        form({ customerId: standing, branchId: BRANCH, reason: REASON, expiresOn: '2035-12-31' }),
      )

      expect((await latestOverride(oneShot))?.expiresOn).toBeNull()
      expect((await latestOverride(standing))?.expiresOn).toBe('2035-12-31')
    })

    /**
     * A one-shot exception belongs to the shipment it was granted for, and
     * `credit_overrides_job_fk` will not let it point at a shipment that does
     * not exist — which is what keeps a stale form from filing an
     * authorisation against nothing.
     */
    it('ties the exception to the shipment it was granted for', async () => {
      const id = await customer()
      const jobId = await job(id)

      harness.revalidated.length = 0
      await recordCreditOverride(
        {},
        form({ customerId: id, branchId: BRANCH, reason: REASON, jobId }),
      )

      expect((await latestOverride(id))?.jobId).toBe(jobId)
      expect(harness.revalidated).toContain(`/customers/${id}`)
      expect(harness.revalidated).toContain(`/jobs/${jobId}`)
    })

    it('leaves the shipment and the invoice unset where neither was named', async () => {
      const id = await customer()

      harness.revalidated.length = 0
      await recordCreditOverride({}, form({ customerId: id, branchId: BRANCH, reason: REASON }))

      const row = await latestOverride(id)
      expect(row?.jobId).toBeNull()
      expect(row?.invoiceId).toBeNull()
      expect(harness.revalidated).toEqual([`/customers/${id}`])
    })

    /** Two exceptions are two rows. Nothing here is an update. */
    it('adds a second exception rather than editing the first', async () => {
      const id = await customer()

      await recordCreditOverride({}, form({ customerId: id, branchId: BRANCH, reason: REASON }))
      await recordCreditOverride(
        {},
        form({ customerId: id, branchId: BRANCH, reason: `${REASON}, and again` }),
      )

      const rows = await withActor(actor, (tx) =>
        tx.select().from(creditOverrides).where(eq(creditOverrides.customerId, id)),
      )
      expect(rows).toHaveLength(2)
    })
  })
})
