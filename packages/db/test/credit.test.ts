/**
 * A customer's credit standing, assembled from the database.
 *
 * The *decision* is `core/credit.ts` and is tested there against no database.
 * What runs here is the assembly: which invoices count, what currency the
 * answer is stated in, and what happens when two currencies meet. It lives in
 * `db` rather than a slice because three slices need the same answer and
 * slices do not import each other — the booking screen asks before it creates
 * a job, the invoice screen before it issues, and the customer screen shows it
 * standing still. Three copies would be three definitions of what a customer
 * owes, and the one on the booking screen would be the one that drifted.
 *
 * Two properties carry the file and both are about being wrong in the safe
 * direction.
 *
 * **An invoice that cannot be converted is reported, never dropped.** Excluding
 * it makes the exposure look smaller than it is, and the check then passes a
 * customer it should have stopped. It is counted in `unconvertible` so the
 * screen can say the figure is a floor rather than a total — a credit check
 * that quietly under-counts is worse than none, because it is believed.
 *
 * **A hold is not overridable.** An over-limit customer is an arithmetic
 * judgement a branch manager can take responsibility for; a hold was placed by
 * a person who decided this customer should not trade. Releasing it is editing
 * the hold in front of whoever set it, not slipping one shipment past it.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { and, eq, isNotNull } from 'drizzle-orm'
import { money } from '@qabandi/core'

const APP_URL = process.env.TEST_DATABASE_URL
const enabled = Boolean(APP_URL)
if (APP_URL) process.env.DATABASE_URL = APP_URL

const { withActor } = await import('../src/actor')
const { creditStanding, creditOverridesFor, checkCredit, noExposure } =
  await import('../src/credit')
const { branches, principals } = await import('../src/schema/identity')
const { customers, customerBranchTerms, creditOverrides } = await import('../src/schema/commercial')
const { invoices } = await import('../src/schema/finance')
const { fxRates, workingCalendars } = await import('../src/schema/reference')

import type { Actor } from '../src/actor'

const BRANCH = '00000000-0000-7000-8000-00000000cd01'
const PRINCIPAL = '00000000-0000-7000-8000-00000000cd05'

const actor: Actor = { principalId: PRINCIPAL, type: 'internal', branchIds: [BRANCH] }
const systemActor = { ...actor, type: 'system' as const }

const RUN = Date.now().toString(36).toUpperCase().slice(-5)
let seq = 0

/** An issued invoice against a customer, in whatever currency the case needs. */
async function owed(
  customerId: string,
  total: string,
  over: Record<string, unknown> = {},
): Promise<string> {
  seq += 1
  return withActor(systemActor, async (tx) => {
    const [row] = await tx
      .insert(invoices)
      .values({
        branchId: BRANCH,
        customerId,
        seriesNo: `CR-${RUN}-${seq}`,
        status: 'issued',
        currency: 'KWD',
        subtotal: total,
        taxAmount: '0.000',
        total,
        taxTreatment: 'out_of_scope',
        issuedAt: new Date('2035-01-10T09:00:00Z'),
        ...over,
      })
      .returning({ id: invoices.id })
    return row!.id
  })
}

/**
 * A customer of this test's own, with its terms already set.
 *
 * Per test rather than shared, and the reason is the subject: exposure is a
 * running total and nothing is ever deleted (§5.5), so a customer used by two
 * tests carries the first one's invoices into the second — and every absolute
 * figure below would be measuring the suite's history rather than the code.
 * An authorised override is worse still: it outlives the run that wrote it and
 * silently unblocks a later assertion about being blocked.
 */
async function customer(terms: Record<string, unknown> = {}): Promise<string> {
  seq += 1
  return withActor(systemActor, async (tx) => {
    const [row] = await tx
      .insert(customers)
      .values({
        code: `CUST-CD-${RUN}-${seq}`,
        legalNameEn: `Credit Customer ${RUN}-${seq}`,
        primaryBranchId: BRANCH,
      })
      .returning({ id: customers.id })

    await tx.insert(customerBranchTerms).values({
      customerId: row!.id,
      branchId: BRANCH,
      paymentTermsDays: 30,
      ...terms,
    })
    return row!.id
  })
}

/** The usual case: a thousand dinars of rope, and no hold. */
const limited = () => customer({ creditLimit: '1000.000', creditCurrency: 'KWD', isOnHold: false })

/** A manager taking responsibility for one exception, on the record. */
const authorise = (customerId: string, expiresOn: string | null = null, reason = 'Authorised') =>
  withActor(systemActor, (tx) =>
    tx.insert(creditOverrides).values({
      branchId: BRANCH,
      customerId,
      exposure: '0.000',
      creditLimit: '1000.000',
      currency: 'KWD',
      reason,
      approvedById: PRINCIPAL,
      expiresOn,
    }),
  )

describe.skipIf(!enabled)('a customer’s credit standing', () => {
  beforeAll(async () => {
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
          email: 'credit-fixture@qabandi.test',
          nameEn: 'Credit Fixture',
        })
        .onConflictDoNothing()

      await tx
        .insert(branches)
        .values({
          id: BRANCH,
          code: 'CRD',
          legalNameEn: 'Credit Branch',
          legalNameAr: 'فرع الائتمان',
          country: 'KW',
          baseCurrency: 'KWD',
          invoiceSeries: 'CRD',
          calendarId: calendar.id,
        })
        .onConflictDoNothing()

      /*
        A rate for the exposure to convert with. The unique key is
        (from, to, effective_on, source), so a rerun is a no-op — which is the
        same property the FX refresh relies on.
      */
      await tx
        .insert(fxRates)
        .values([
          {
            fromCurrency: 'USD',
            toCurrency: 'KWD',
            rate: '0.307000',
            source: 'credit-test',
            effectiveOn: '2020-01-01',
          },
        ])
        .onConflictDoNothing()
    })
  })

  afterAll(async () => {
    // Settled, so a later run of this suite does not inherit this one's
    // exposure — nothing is ever deleted (§5.5).
    if (!enabled) return
    await withActor(systemActor, (tx) =>
      tx
        .update(invoices)
        .set({ status: 'paid' })
        .where(and(eq(invoices.branchId, BRANCH), isNotNull(invoices.seriesNo))),
    )
  })

  describe('what the figure is stated in', () => {
    /**
     * The limit's own currency, because that is the number a manager agreed
     * and the one they will be asked about.
     */
    it('states the exposure in the currency the limit was agreed in', async () => {
      const id = await customer({ creditLimit: '1000.00', creditCurrency: 'USD' })

      expect((await creditStanding(actor, id, BRANCH)).currency).toBe('USD')
    })

    /** With nothing to compare against, the branch's currency and no limit. */
    it('falls back to the branch’s currency where no limit is set', async () => {
      const id = await customer({ creditLimit: null, creditCurrency: null })

      const standing = await creditStanding(actor, id, BRANCH)

      expect(standing.currency).toBe('KWD')
      expect(standing.limit).toBeNull()
    })

    it('reports nothing owed for a customer with no invoices', async () => {
      const standing = await creditStanding(actor, await limited(), BRANCH)

      expect(Number(standing.outstanding.amount)).toBe(0)
      expect(standing.unconvertible).toEqual([])
      expect(standing.onHold).toBe(false)
    })

    it('carries the hold a person placed', async () => {
      const id = await customer({ creditLimit: '1000.000', creditCurrency: 'KWD', isOnHold: true })

      expect((await creditStanding(actor, id, BRANCH)).onHold).toBe(true)
    })
  })

  describe('what counts as owed', () => {
    it('counts an issued invoice', async () => {
      const id = await limited()
      await owed(id, '250.000')

      expect(Number((await creditStanding(actor, id, BRANCH)).outstanding.amount)).toBeCloseTo(
        250,
        3,
      )
    })

    /** What is left, not what was raised. */
    it('counts only the open part of a part-paid invoice', async () => {
      const id = await limited()
      await owed(id, '400.000', { status: 'part_paid', amountPaid: '150.000' })

      expect(Number((await creditStanding(actor, id, BRANCH)).outstanding.amount)).toBeCloseTo(
        250,
        3,
      )
    })

    it('counts nothing for an invoice already settled', async () => {
      const id = await limited()
      await owed(id, '900.000', { status: 'paid', amountPaid: '900.000' })

      expect(Number((await creditStanding(actor, id, BRANCH)).outstanding.amount)).toBe(0)
    })

    /** A draft is not a claim on anybody until somebody issues it. */
    it('counts nothing for a draft nobody has issued', async () => {
      const id = await limited()
      await owed(id, '750.000', { status: 'draft', seriesNo: null })

      expect(Number((await creditStanding(actor, id, BRANCH)).outstanding.amount)).toBe(0)
    })

    it('adds up everything open at once', async () => {
      const id = await limited()
      await owed(id, '100.000')
      await owed(id, '250.500')

      expect(Number((await creditStanding(actor, id, BRANCH)).outstanding.amount)).toBeCloseTo(
        350.5,
        3,
      )
    })
  })

  describe('two currencies', () => {
    /** A Kuwaiti customer with a KWD limit routinely holds an invoice in USD. */
    it('converts a foreign invoice into the limit’s currency', async () => {
      const id = await limited()
      await owed(id, '100.00', { currency: 'USD', subtotal: '100.00' })

      const standing = await creditStanding(actor, id, BRANCH)

      // 100 USD at 0.307.
      expect(Number(standing.outstanding.amount)).toBeCloseTo(30.7, 2)
      expect(standing.unconvertible).toEqual([])
    })

    it('adds a converted invoice to one already in the limit’s currency', async () => {
      const id = await limited()
      await owed(id, '50.000')
      await owed(id, '100.00', { currency: 'USD', subtotal: '100.00' })

      expect(Number((await creditStanding(actor, id, BRANCH)).outstanding.amount)).toBeCloseTo(
        80.7,
        2,
      )
    })

    /**
     * The honest failure. Dropping it makes the exposure look smaller than it
     * is, and the check then passes a customer it should stop — so it is
     * counted separately and the screen says the figure is a floor.
     */
    it('reports an invoice it cannot convert rather than leaving it out', async () => {
      const id = await limited()
      await owed(id, '75.000')
      await owed(id, '500.00', { currency: 'GBP', subtotal: '500.00' })

      const standing = await creditStanding(actor, id, BRANCH)

      expect(standing.unconvertible).toHaveLength(1)
      expect(standing.unconvertible[0]?.currency).toBe('GBP')
      expect(Number(standing.unconvertible[0]?.amount)).toBeCloseTo(500, 2)
      // What it could convert is still counted, not abandoned alongside it.
      expect(Number(standing.outstanding.amount)).toBeCloseTo(75, 3)
    })
  })

  describe('the check the screens ask for', () => {
    it('allows a booking comfortably inside the limit', async () => {
      const result = await checkCredit(actor, {
        customerId: await limited(),
        branchId: BRANCH,
        proposed: money('10.000', 'KWD'),
      })

      expect(result.allowed).toBe(true)
      expect(result.assessment.blocked).toBe(false)
      expect(result.override).toBeNull()
    })

    it('blocks a proposal that would take the customer past the limit', async () => {
      const result = await checkCredit(actor, {
        customerId: await limited(),
        branchId: BRANCH,
        proposed: money('100000.000', 'KWD'),
      })

      expect(result.allowed).toBe(false)
      expect(result.assessment.blocked).toBe(true)
    })

    /**
     * `core/credit.ts` refuses a currency mismatch because a decision function
     * must not pick a rate. This layer may: it is already reading rates for
     * the exposure and converts with the same one, so a USD proposal is
     * measured against a KWD limit on identical terms.
     */
    it('converts a proposal in another currency rather than refusing it', async () => {
      const id = await limited()

      // 10,000 USD is about 3,070 KWD — over a 1,000 KWD limit.
      const over = await checkCredit(actor, {
        customerId: id,
        branchId: BRANCH,
        proposed: money('10000.00', 'USD'),
      })
      // 100 USD is about 30 KWD — comfortably inside it.
      const inside = await checkCredit(actor, {
        customerId: id,
        branchId: BRANCH,
        proposed: money('100.00', 'USD'),
      })

      expect(over.assessment.blocked).toBe(true)
      expect(inside.assessment.blocked).toBe(false)
    })

    /*
      F14. With no rate the proposal became null and was assessed as nothing,
      so a GBP 1,000,000 invoice passed a 1,000 KWD limit.
    */
    it('blocks a proposal it cannot convert when asked to, and says why', async () => {
      const id = await limited()

      const refused = await checkCredit(actor, {
        customerId: id,
        branchId: BRANCH,
        proposed: money('1000000.00', 'GBP'),
        refuseUnconvertible: true,
      })
      expect(refused.allowed).toBe(false)
      expect(refused.unconverted).toBe('GBP')

      // The booking screen has not opted in, and keeps its own judgement.
      const booking = await checkCredit(actor, {
        customerId: id,
        branchId: BRANCH,
        proposed: money('1000000.00', 'GBP'),
      })
      expect(booking.allowed).toBe(true)
    })

    /**
     * A hold is not overridable, and this is the assertion that keeps it that
     * way. Releasing it is editing the hold in front of whoever set it.
     */
    it('refuses to let an override past a hold', async () => {
      const id = await customer({
        creditLimit: '1000.000',
        creditCurrency: 'KWD',
        isOnHold: true,
      })
      await authorise(id)

      const result = await checkCredit(actor, {
        customerId: id,
        branchId: BRANCH,
        proposed: money('1.000', 'KWD'),
        today: '2035-06-01',
      })

      expect(result.assessment.outcome).toBe('on_hold')
      expect(result.override).toBeNull()
      expect(result.allowed).toBe(false)
    })

    /** Over-limit is an arithmetic judgement a manager may take on. */
    it('lets an override past an over-limit block', async () => {
      const id = await limited()
      await authorise(id, '2035-12-31')

      const result = await checkCredit(actor, {
        customerId: id,
        branchId: BRANCH,
        proposed: money('100000.000', 'KWD'),
        today: '2035-06-01',
      })

      expect(result.assessment.blocked).toBe(true)
      expect(result.override).not.toBeNull()
      expect(result.allowed).toBe(true)
    })

    /** An expired authorisation is a record, not a permission. */
    it('does not let an expired override past', async () => {
      const id = await limited()
      await authorise(id, '2035-12-31')

      const result = await checkCredit(actor, {
        customerId: id,
        branchId: BRANCH,
        proposed: money('100000.000', 'KWD'),
        today: '2036-06-01',
      })

      expect(result.override).toBeNull()
      expect(result.allowed).toBe(false)
    })

    /** One customer's authorisation is not another's. */
    it('does not let one customer’s override cover another', async () => {
      const authorised = await limited()
      const other = await limited()
      await authorise(authorised, '2035-12-31')

      const result = await checkCredit(actor, {
        customerId: other,
        branchId: BRANCH,
        proposed: money('100000.000', 'KWD'),
        today: '2035-06-01',
      })

      expect(result.allowed).toBe(false)
    })
  })

  describe('the record of who authorised what', () => {
    it('lists the decisions taken, most recent first', async () => {
      const id = await limited()
      await authorise(id, '2035-12-31', 'Payment in transit')
      await authorise(id, '2035-12-31', 'Second look, still fine')

      const rows = await creditOverridesFor(actor, id, BRANCH)

      expect(rows).toHaveLength(2)
      expect(rows[0]?.approvedById).toBe(PRINCIPAL)
      const times = rows.map((row) => row.approvedAt.getTime())
      expect([...times].sort((a, b) => b - a)).toEqual(times)
    })

    it('keeps one customer’s authorisations out of another’s', async () => {
      expect(await creditOverridesFor(actor, await limited(), BRANCH)).toEqual([])
    })
  })

  describe('nothing owed at all', () => {
    it('is zero in the currency it was asked about', () => {
      const nothing = noExposure('KWD')

      expect(nothing.currency).toBe('KWD')
      expect(Number(nothing.amount)).toBe(0)
    })
  })
})
