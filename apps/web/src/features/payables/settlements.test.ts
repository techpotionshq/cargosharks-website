/**
 * Netting off with an agent — the monthly set-off, against a real database.
 *
 * An agent is both a supplier and a customer: they bill us for the destination
 * leg and we bill them for ours. Settling gross means two payments crossing in
 * opposite directions every month; settling net means one, and a statement
 * both sides signed.
 *
 * Three properties carry the feature and none of them is arithmetic:
 *
 * **The totals are written, not re-derived.** A statement is a thing both
 * sides agreed to on a date. A screen that recomputes it shows a different
 * figure the moment a late invoice is captured into the period — and the agent
 * is holding the first one.
 *
 * **Agreeing claims the bills, in the same transaction.** `settlement_id` is
 * stamped on them, which is what keeps the same invoice out of next month's
 * statement. Without it they are netted twice, and no balance check catches it
 * because both settlements are individually consistent.
 *
 * **Voiding releases them again.** The one route back, and the reason is
 * required. A settled statement cannot be voided at all — the money has moved.
 *
 * The netting itself is `netPosition` in `@qabandi/core`, tested there. What
 * is tested here is what goes into it and what happens to the rows afterwards.
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

const {
  branches,
  customers,
  invoices,
  partnerSettlementLines,
  partnerSettlements,
  partners,
  principalBranchRoles,
  principals,
  roles,
  supplierInvoices,
  withActor,
  workingCalendars,
} = await import('@qabandi/db')

const {
  draftSettlement,
  setSettlementStatus,
  advanceSettlement,
  linkPartnerAccount,
  setPartnerTolerance,
} = await import('./form-actions')

/* A world of this suite's own: the agent has to be linked to a customer
   record, and the shared fixture agent is read by half a dozen other files. */
const BRANCH = '00000000-0000-7000-8000-00000000ae01'
const CUSTOMER = '00000000-0000-7000-8000-00000000ae02'
const PARTNER = '00000000-0000-7000-8000-00000000ae03'
const UNLINKED = '00000000-0000-7000-8000-00000000ae04'
const PRINCIPAL = '00000000-0000-7000-8000-00000000ae05'

const actor = { principalId: PRINCIPAL, type: 'internal' as const, branchIds: [BRANCH] }
const systemActor = { ...actor, type: 'system' as const }

function sessionWith(permissions: readonly string[]) {
  return {
    actor,
    principal: {
      id: PRINCIPAL,
      nameEn: 'Settlements Clerk',
      nameAr: null,
      email: 'settlements@qabandi.test',
      locale: 'en' as const,
    },
    permissions: new Set(permissions),
    branchRoles: new Map([[BRANCH, 'finance']]),
    requiresTwoFactor: false,
  }
}

const ALL = ['settlement.run', 'partner.write']

const form = (fields: Record<string, string>): FormData => {
  const data = new FormData()
  for (const [key, value] of Object.entries(fields)) data.set(key, value)
  return data
}

const RUN = Date.now().toString(36).toUpperCase().slice(-5)
let seq = 0

/** A period of this run's own, so "what falls in it" is exactly ours. */
const PERIOD = { periodFrom: '2033-06-01', periodTo: '2033-06-30' }

/**
 * An agent of this test's own, already linked to the customer record they
 * invoice us as.
 *
 * Isolated per test rather than per period. Nothing is ever deleted, so bills
 * a previous test left open are still open — and a settlement draft's whole
 * job is to find every open document in a period, which would find those too.
 * A fresh partner is the only boundary that holds across runs as well as
 * within one.
 */
interface Agent {
  readonly partnerId: string
  readonly customerId: string
}

async function agent(): Promise<Agent> {
  seq += 1
  const suffix = `${RUN}${seq}`
  return withActor(systemActor, async (tx) => {
    const [customer] = await tx
      .insert(customers)
      .values({
        code: `CST-${suffix}`,
        legalNameEn: `Agent ${suffix}, as a customer`,
        primaryBranchId: BRANCH,
      })
      .returning({ id: customers.id })

    const [partner] = await tx
      .insert(partners)
      .values({
        code: `AGT-${suffix}`,
        type: 'agent',
        legalNameEn: `Netting Agent ${suffix}`,
        currency: 'KWD',
        settlementCustomerId: customer!.id,
        settlementCurrency: 'KWD',
      })
      .returning({ id: partners.id })

    return { partnerId: partner!.id, customerId: customer!.id }
  })
}

/** What the agent has billed us and we have not paid. */
async function bill(
  who: Agent,
  total: string,
  over: Record<string, unknown> = {},
): Promise<string> {
  seq += 1
  return withActor(systemActor, async (tx) => {
    const [row] = await tx
      .insert(supplierInvoices)
      .values({
        branchId: BRANCH,
        partnerId: who.partnerId,
        reference: `SBILL-${RUN}-${seq}`,
        status: 'approved',
        currency: 'KWD',
        invoiceDate: '2033-06-15',
        subtotal: total,
        total,
        ...over,
      })
      .returning({ id: supplierInvoices.id })
    return row!.id
  })
}

/** What we have billed the agent and they have not paid. */
async function ourInvoice(
  who: Agent,
  total: string,
  over: Record<string, unknown> = {},
): Promise<string> {
  seq += 1
  return withActor(systemActor, async (tx) => {
    const [row] = await tx
      .insert(invoices)
      .values({
        branchId: BRANCH,
        customerId: who.customerId,
        seriesNo: `AEX-${RUN}-${seq}`,
        status: 'issued',
        currency: 'KWD',
        subtotal: total,
        taxAmount: '0.000',
        total,
        taxTreatment: 'out_of_scope',
        issuedAt: new Date('2033-06-10T09:00:00Z'),
        ...over,
      })
      .returning({ id: invoices.id })
    return row!.id
  })
}

const draft = (who: Agent, extra: Record<string, string> = {}) =>
  draftSettlement(
    {},
    form({ branchId: BRANCH, partnerId: who.partnerId, fxRate: '1', ...PERIOD, ...extra }),
  )

async function latestSettlement(who: Agent) {
  const [row] = await withActor(actor, (tx) =>
    tx
      .select()
      .from(partnerSettlements)
      .where(eq(partnerSettlements.partnerId, who.partnerId))
      .orderBy(desc(partnerSettlements.createdAt))
      .limit(1),
  )
  return row
}

const linesOf = (settlementId: string) =>
  withActor(actor, (tx) =>
    tx
      .select({ kind: partnerSettlementLines.kind, amount: partnerSettlementLines.amount })
      .from(partnerSettlementLines)
      .where(eq(partnerSettlementLines.settlementId, settlementId)),
  )

describe.skipIf(!enabled)('netting off with an agent', () => {
  beforeAll(async () => {
    harness.session = sessionWith(ALL)

    await withActor(systemActor, async (tx) => {
      const [calendar] = await tx
        .select({ id: workingCalendars.id })
        .from(workingCalendars)
        .where(eq(workingCalendars.key, 'kuwait'))
        .limit(1)
      const [role] = await tx
        .select({ id: roles.id })
        .from(roles)
        .where(eq(roles.key, 'finance'))
        .limit(1)
      if (!calendar || !role) throw new Error('Run `pnpm db:seed` before this suite')

      await tx
        .insert(principals)
        .values({
          id: PRINCIPAL,
          type: 'internal',
          email: 'settlements-test@qabandi.test',
          nameEn: 'Settlements Clerk',
        })
        .onConflictDoNothing()

      await tx
        .insert(branches)
        .values({
          id: BRANCH,
          code: 'AEX',
          legalNameEn: 'Settlement Test Branch',
          legalNameAr: 'فرع التسوية',
          country: 'KW',
          baseCurrency: 'KWD',
          invoiceSeries: 'AEX',
          calendarId: calendar.id,
        })
        .onConflictDoNothing()

      await tx
        .insert(principalBranchRoles)
        .values({ principalId: PRINCIPAL, branchId: BRANCH, roleId: role.id })
        .onConflictDoNothing()

      await tx
        .insert(customers)
        .values({
          id: CUSTOMER,
          code: 'CUST-SETTLEMENT',
          legalNameEn: 'Agent, as a customer',
          primaryBranchId: BRANCH,
        })
        .onConflictDoNothing()

      await tx
        .insert(partners)
        .values([
          {
            id: PARTNER,
            code: 'AGT-SETTLE',
            type: 'agent',
            legalNameEn: 'Netting Agent',
            currency: 'KWD',
          },
          {
            id: UNLINKED,
            code: 'AGT-NOACCT',
            type: 'agent',
            legalNameEn: 'Agent With No Account',
            currency: 'KWD',
          },
        ])
        .onConflictDoNothing()

      // The link that makes netting possible, set here rather than assumed:
      // `onConflictDoNothing` leaves an existing row untouched on a rerun.
      await tx
        .update(partners)
        .set({ settlementCustomerId: CUSTOMER, settlementCurrency: 'KWD' })
        .where(eq(partners.id, PARTNER))
      await tx.update(partners).set({ settlementCustomerId: null }).where(eq(partners.id, UNLINKED))
    })
  })

  afterAll(() => {
    harness.session = null
  })

  describe('drafting a statement', () => {
    it('nets what each side owes the other', async () => {
      const who = await agent()
      await bill(who, '300.000')
      await ourInvoice(who, '500.000')

      const state = await draft(who)

      expect(state.message).toBeUndefined()
      const settlement = await latestSettlement(who)
      expect(Number(settlement?.payableTotal)).toBeCloseTo(300, 3)
      expect(Number(settlement?.receivableTotal)).toBeCloseTo(500, 3)
      // 300 nets off; 200 is still owed to us.
      expect(Number(settlement?.offsetAmount)).toBeCloseTo(300, 3)
      expect(Number(settlement?.residualAmount)).toBeCloseTo(200, 3)
      expect(settlement?.residualDirection).toBe('they_owe_us')
    })

    it('numbers the statement', async () => {
      const who = await agent()
      await bill(who, '100.000')
      await draft(who)

      expect((await latestSettlement(who))?.reference).toMatch(/^SET-\d{4}-\d{5}$/)
    })

    /** The documents behind the figures — one line per invoice on each side. */
    it('records what went into it', async () => {
      const who = await agent()
      await bill(who, '120.000')
      await ourInvoice(who, '80.000')

      await draft(who)
      const settlement = await latestSettlement(who)
      const lines = await linesOf(settlement!.id)

      expect(lines.filter((l) => l.kind === 'bill')).toHaveLength(1)
      expect(lines.filter((l) => l.kind === 'invoice')).toHaveLength(1)
    })

    /** Part-paid documents net at what is left, not at what they were raised for. */
    it('takes the open balance, not the face value', async () => {
      const who = await agent()
      await bill(who, '400.000', { status: 'part_paid', amountPaid: '150.000' })

      await draft(who)

      expect(Number((await latestSettlement(who))?.payableTotal)).toBeCloseTo(250, 3)
    })

    it('leaves out a bill nobody has approved yet', async () => {
      const who = await agent()
      await bill(who, '999.000', { status: 'received' })
      await bill(who, '50.000')

      await draft(who)

      expect(Number((await latestSettlement(who))?.payableTotal)).toBeCloseTo(50, 3)
    })

    it('leaves out anything outside the period', async () => {
      const who = await agent()
      await bill(who, '777.000', { invoiceDate: '2033-01-15' })
      await bill(who, '60.000')

      await draft(who)

      expect(Number((await latestSettlement(who))?.payableTotal)).toBeCloseTo(60, 3)
    })

    it('leaves out anything in another currency', async () => {
      const who = await agent()
      await bill(who, '888.000', { currency: 'USD' })
      await bill(who, '70.000')

      await draft(who)

      expect(Number((await latestSettlement(who))?.payableTotal)).toBeCloseTo(70, 3)
    })

    /**
     * The claim that keeps a month from being netted twice, on the receivable
     * side: an invoice already on a settlement line is not offered again.
     */
    it('leaves out an invoice an earlier statement already claimed', async () => {
      const who = await agent()
      await ourInvoice(who, '90.000')
      await draft(who)
      expect(Number((await latestSettlement(who))?.receivableTotal)).toBeCloseTo(90, 3)

      await ourInvoice(who, '40.000')
      await draft(who)

      expect(Number((await latestSettlement(who))?.receivableTotal)).toBeCloseTo(40, 3)
    })

    it('says so when there is nothing open to net', async () => {
      const state = await draft(await agent(), { periodFrom: '2032-01-01', periodTo: '2032-01-31' })
      expect(state.message).toBe('payablesValidation.nothingOpenInPeriod')
    })

    /**
     * Netting requires knowing which customer record the agent invoices us as.
     * Without it there is no receivable side at all, and the message says
     * where to set it rather than reporting an empty statement.
     */
    it('says where to link the account when the agent has none', async () => {
      const state = await draftSettlement(
        {},
        form({ branchId: BRANCH, partnerId: UNLINKED, fxRate: '1', ...PERIOD }),
      )
      expect(state.message).toBe('payablesValidation.noCurrentAccount')
    })

    it('refuses a period that ends before it starts', async () => {
      const state = await draft(await agent(), { periodFrom: '2033-06-30', periodTo: '2033-06-01' })
      expect(state.errors?.periodTo).toBe('payablesValidation.periodEndsBeforeStart')
    })

    it('reports field errors rather than throwing on a bad form', async () => {
      expect((await draftSettlement({}, form({}))).errors).toBeDefined()
    })

    it('says the partner is no longer visible', async () => {
      const state = await draftSettlement(
        {},
        form({
          branchId: BRANCH,
          partnerId: '00000000-0000-7000-8000-00000000aefe',
          fxRate: '1',
          ...PERIOD,
        }),
      )
      expect(state.message).toBe('payablesValidation.partnerGone')
    })

    it('refuses a caller who may not run a settlement', async () => {
      const who = await agent()
      harness.session = sessionWith(['partner.write'])
      try {
        await expect(draft(who)).rejects.toThrow('settlement.run')
      } finally {
        harness.session = sessionWith(ALL)
      }
    })
  })

  describe('agreeing, settling and voiding', () => {
    async function drafted(): Promise<{ id: string; billId: string; who: Agent }> {
      const who = await agent()
      const billId = await bill(who, '200.000')
      await ourInvoice(who, '120.000')
      await draft(who)
      return { id: (await latestSettlement(who))!.id, billId, who }
    }

    const settledStatusOf = async (billId: string) => {
      const [row] = await withActor(actor, (tx) =>
        tx
          .select({ settlementId: supplierInvoices.settlementId })
          .from(supplierInvoices)
          .where(eq(supplierInvoices.id, billId)),
      )
      return row?.settlementId
    }

    /**
     * The claim, in the same transaction as the agreement. Without it the next
     * statement lists the same bills and they are netted twice — which no
     * balance check catches, because both statements are consistent.
     */
    it('claims the bills when the statement is agreed', async () => {
      const { id, billId, who } = await drafted()
      expect(await settledStatusOf(billId)).toBeNull()

      const state = await setSettlementStatus({}, form({ settlementId: id, action: 'agree' }))

      expect(state.message).toBeUndefined()
      expect((await latestSettlement(who))?.status).toBe('agreed')
      expect(await settledStatusOf(billId)).toBe(id)
    })

    it('stamps who agreed it and when', async () => {
      const { id, who } = await drafted()
      await setSettlementStatus({}, form({ settlementId: id, action: 'agree' }))

      const settlement = await latestSettlement(who)
      expect(settlement?.agreedAt).toBeInstanceOf(Date)
      expect(settlement?.agreedById).toBe(PRINCIPAL)
    })

    it('refuses to agree the same statement twice', async () => {
      const { id } = await drafted()
      await setSettlementStatus({}, form({ settlementId: id, action: 'agree' }))

      const again = await setSettlementStatus({}, form({ settlementId: id, action: 'agree' }))

      expect(again.message).toBe('payablesValidation.settlementAlreadyAgreed')
    })

    /** The residual is money that has to actually move before this is true. */
    it('records the residual as settled once it has moved', async () => {
      const { id, who } = await drafted()
      await setSettlementStatus({}, form({ settlementId: id, action: 'agree' }))

      await setSettlementStatus({}, form({ settlementId: id, action: 'settle' }))

      const settlement = await latestSettlement(who)
      expect(settlement?.status).toBe('settled')
      expect(settlement?.settledAt).toBeInstanceOf(Date)
    })

    it('refuses to settle a statement the agent has not agreed', async () => {
      const { id, who } = await drafted()

      const state = await setSettlementStatus({}, form({ settlementId: id, action: 'settle' }))

      expect(state.message).toBe('payablesValidation.agreeBeforeSettling')
      expect((await latestSettlement(who))?.status).toBe('draft')
    })

    /** Voiding is the one route back, and it puts the bills back on the board. */
    it('releases the bills it claimed', async () => {
      const { id, billId, who } = await drafted()
      await setSettlementStatus({}, form({ settlementId: id, action: 'agree' }))

      await setSettlementStatus(
        {},
        form({ settlementId: id, action: 'void', reason: 'Agent disputes two lines' }),
      )

      const settlement = await latestSettlement(who)
      expect(settlement?.status).toBe('void')
      expect(settlement?.voidReason).toContain('disputes')
      // Cleared, so the next statement sees them again.
      expect(settlement?.agreedAt).toBeNull()
      expect(await settledStatusOf(billId)).toBeNull()
    })

    it('insists a void says why', async () => {
      const { id, who } = await drafted()
      const state = await setSettlementStatus({}, form({ settlementId: id, action: 'void' }))

      expect(state.message).toBe('payablesValidation.sayWhy')
      expect((await latestSettlement(who))?.status).toBe('draft')
    })

    /** The money has moved; there is nothing left to take back. */
    it('refuses to void a statement that has been settled', async () => {
      const { id, who } = await drafted()
      await setSettlementStatus({}, form({ settlementId: id, action: 'agree' }))
      await setSettlementStatus({}, form({ settlementId: id, action: 'settle' }))

      const state = await setSettlementStatus(
        {},
        form({ settlementId: id, action: 'void', reason: 'Changed our minds' }),
      )

      expect(state.message).toBe('payablesValidation.settlementSettled')
      expect((await latestSettlement(who))?.status).toBe('settled')
    })

    it('says so when given nothing to do', async () => {
      expect((await setSettlementStatus({}, form({}))).message).toBe(
        'payablesValidation.nothingToDo',
      )
    })

    it('refuses an action it does not have', async () => {
      const { id } = await drafted()
      const state = await setSettlementStatus({}, form({ settlementId: id, action: 'shred' }))
      expect(state.message).toBe('payablesValidation.nothingToDo')
    })

    it('says the statement is no longer visible', async () => {
      const state = await setSettlementStatus(
        {},
        form({ settlementId: '00000000-0000-7000-8000-00000000aeff', action: 'agree' }),
      )
      expect(state.message).toBe('payablesValidation.settlementGone')
    })

    /**
     * A button posts a bare `FormData`, so agree and settle are exposed
     * without the `useActionState` signature. Both are `POST`s and neither is
     * a link: a `GET` that claims a month's invoices could be fired by a link
     * preview in somebody's chat client.
     */
    it('advances through the plain form action a button posts', async () => {
      const { id, who } = await drafted()

      await advanceSettlement(form({ settlementId: id, action: 'agree' }))

      expect((await latestSettlement(who))?.status).toBe('agreed')
    })
  })

  describe('the partner settings behind it', () => {
    it('links the partner to the customer record they invoice us as', async () => {
      const state = await linkPartnerAccount(
        {},
        form({
          partnerId: UNLINKED,
          settlementCustomerId: CUSTOMER,
          settlementCurrency: 'KWD',
        }),
      )

      expect(state.errors).toBeUndefined()
      const [row] = await withActor(actor, (tx) =>
        tx
          .select({
            customerId: partners.settlementCustomerId,
            currency: partners.settlementCurrency,
          })
          .from(partners)
          .where(eq(partners.id, UNLINKED)),
      )
      expect(row?.customerId).toBe(CUSTOMER)
      expect(row?.currency).toBe('KWD')

      // Put it back: the drafting tests rely on this partner having none.
      await linkPartnerAccount({}, form({ partnerId: UNLINKED }))
    })

    it('unlinks when nothing was chosen', async () => {
      await linkPartnerAccount({}, form({ partnerId: UNLINKED, settlementCustomerId: CUSTOMER }))
      await linkPartnerAccount({}, form({ partnerId: UNLINKED }))

      const [row] = await withActor(actor, (tx) =>
        tx
          .select({ customerId: partners.settlementCustomerId })
          .from(partners)
          .where(eq(partners.id, UNLINKED)),
      )
      expect(row?.customerId).toBeNull()
    })

    it('says so when given no partner', async () => {
      expect((await linkPartnerAccount({}, form({}))).message).toBe(
        'payablesValidation.nothingToDo',
      )
    })

    it('records the variance tolerance on the partner', async () => {
      const state = await setPartnerTolerance(
        {},
        form({
          partnerId: PARTNER,
          varianceTolerancePercent: '2.5',
          varianceToleranceAbsolute: '5.000',
        }),
      )

      expect(state.errors).toBeUndefined()
      const [row] = await withActor(actor, (tx) =>
        tx
          .select({
            percent: partners.varianceTolerancePercent,
            absolute: partners.varianceToleranceAbsolute,
          })
          .from(partners)
          .where(eq(partners.id, PARTNER)),
      )
      expect(Number(row?.percent)).toBeCloseTo(2.5, 3)
      expect(Number(row?.absolute)).toBeCloseTo(5, 3)
    })

    /** A negative tolerance is not a tolerance; nor is a sentence. */
    it('refuses a tolerance that is not a number', async () => {
      const state = await setPartnerTolerance(
        {},
        form({ partnerId: PARTNER, varianceTolerancePercent: 'a bit' }),
      )
      expect(state.errors?.varianceTolerancePercent).toBeDefined()
    })

    it('refuses a negative tolerance', async () => {
      const state = await setPartnerTolerance(
        {},
        form({ partnerId: PARTNER, varianceToleranceAbsolute: '-5' }),
      )
      expect(state.errors?.varianceTolerancePercent).toBeDefined()
    })

    it('says so when given no partner', async () => {
      expect((await setPartnerTolerance({}, form({}))).message).toBe(
        'payablesValidation.nothingToDo',
      )
    })

    it('refuses a caller who may not write partners', async () => {
      harness.session = sessionWith(['settlement.run'])
      try {
        await expect(setPartnerTolerance({}, form({ partnerId: PARTNER }))).rejects.toThrow(
          'partner.write',
        )
      } finally {
        harness.session = sessionWith(ALL)
      }
    })
  })
})
