/**
 * Matching a supplier's bill against what we accrued — against a real database.
 *
 * This is the three-way match: the cost we expected on a job, the line the
 * supplier actually billed, and the assertion that the two are the same money.
 * The assertion is the part that carries risk. Matched too generously, a bill
 * is paid twice over two matches and the variance report says the job was
 * profitable; matched to the wrong branch, the variance lands in another
 * entity's P&L.
 *
 * Almost all of it is SQL — a correlated read of what is already matched, an
 * insert, and a retraction that is an `update` rather than a `delete`. None of
 * that is checkable against a mock, so this runs the real actions against real
 * PostgreSQL and skips entirely without one.
 *
 * The arithmetic itself lives in `@qabandi/core/matching` and is tested there
 * in milliseconds. What is tested here is everything around it: the position
 * the ceiling is judged against, the status gate, the branch trigger, the
 * uniqueness constraint, and the retraction.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { and, eq, sql } from 'drizzle-orm'

const APP_URL = process.env.TEST_DATABASE_URL
const enabled = Boolean(APP_URL)

// As in the ledger suite: point the lazy `db` proxy at the test database
// before any action opens a connection.
if (APP_URL) process.env.DATABASE_URL = APP_URL

const harness = vi.hoisted(() => ({ session: null as unknown }))

/*
  This suite runs the real action with the database mocked out, so the unset
  DATABASE_URL that would put the app in fixture mode is not a demo here.
*/
vi.mock('@/lib/pilot/read-only', () => ({
  demoReadOnly: async () => null,
  demoReadOnlyMessage: async () => null,
}))
vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}))

vi.mock('@/lib/session', () => ({
  requireSession: async () => harness.session,
}))

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
  chargeLines,
  chargeTypes,
  customers,
  jobs,
  partners,
  principalBranchRoles,
  principals,
  roles,
  supplierInvoiceLines,
  supplierInvoiceMatches,
  supplierInvoices,
  withActor,
  workingCalendars,
} = await import('@qabandi/db')

const { matchSupplierLine, readSupplierBill, unmatchSupplierLine } = await import('./form-actions')

const BRANCH = '00000000-0000-7000-8000-00000000e001'
const OTHER_BRANCH = '00000000-0000-7000-8000-00000000e002'
const CUSTOMER = '00000000-0000-7000-8000-00000000e003'
const PARTNER = '00000000-0000-7000-8000-00000000e004'
const PRINCIPAL = '00000000-0000-7000-8000-00000000e005'
const JOB = '00000000-0000-7000-8000-00000000e006'

const actor = {
  principalId: PRINCIPAL,
  type: 'internal' as const,
  branchIds: [BRANCH, OTHER_BRANCH],
}

const session = {
  actor,
  principal: {
    id: PRINCIPAL,
    nameEn: 'Payables Test',
    nameAr: null,
    email: 'p@t.test',
    locale: 'en',
  },
  permissions: new Set(['payable.record', 'payable.approve', 'payable.pay', 'settlement.run']),
  branchRoles: new Map([
    [BRANCH, 'finance'],
    [OTHER_BRANCH, 'finance'],
  ]),
  requiresTwoFactor: false,
}

const form = (fields: Record<string, string>): FormData => {
  const data = new FormData()
  for (const [key, value] of Object.entries(fields)) data.set(key, value)
  return data
}

let chargeTypeId: string

type BillStatus = 'received' | 'approved' | 'disputed'

/** A supplier bill in `received` — the state in which matching is allowed. */
async function bill(total: string, status: BillStatus = 'received'): Promise<string> {
  return withActor(actor, async (tx) => {
    const [row] = await tx
      .insert(supplierInvoices)
      .values({
        branchId: BRANCH,
        partnerId: PARTNER,
        reference: `BILL-${Math.floor(Number(total) * 1000)}-${Date.now()}`,
        status,
        currency: 'KWD',
        invoiceDate: '2026-08-18',
        subtotal: total,
        total,
      })
      .returning({ id: supplierInvoices.id })
    return row!.id
  })
}

/** A line on that bill, for `amount`. */
async function billLine(billId: string, amount: string, branchId = BRANCH): Promise<string> {
  return withActor(actor, async (tx) => {
    const [row] = await tx
      .insert(supplierInvoiceLines)
      .values({
        supplierInvoiceId: billId,
        branchId,
        description: 'Ocean freight',
        unitPrice: amount,
        amount,
      })
      .returning({ id: supplierInvoiceLines.id })
    return row!.id
  })
}

/** The cost we accrued on the job, which the bill is matched against. */
async function accrual(amount: string, branchId = BRANCH): Promise<string> {
  return withActor(actor, async (tx) => {
    const [row] = await tx
      .insert(chargeLines)
      .values({
        jobId: JOB,
        branchId,
        direction: 'cost',
        chargeTypeId,
        basis: 'flat',
        rate: amount,
        amount,
        currency: 'KWD',
        amountBase: amount,
        baseCurrency: 'KWD',
        isAccrual: true,
      })
      .returning({ id: chargeLines.id })
    return row!.id
  })
}

/** Live matches on a bill line — the reads all filter retracted ones out. */
async function liveMatches(lineId: string) {
  return withActor(actor, (tx) =>
    tx
      .select({ id: supplierInvoiceMatches.id, amount: supplierInvoiceMatches.amount })
      .from(supplierInvoiceMatches)
      .where(
        and(
          eq(supplierInvoiceMatches.supplierInvoiceLineId, lineId),
          sql`${supplierInvoiceMatches.retractedAt} is null`,
        ),
      ),
  )
}

describe.skipIf(!enabled)('supplier invoice matching', () => {
  beforeAll(async () => {
    harness.session = session

    await withActor({ ...actor, type: 'system' }, async (tx) => {
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
      const [charge] = await tx.select({ id: chargeTypes.id }).from(chargeTypes).limit(1)
      if (!calendar || !role || !charge) {
        throw new Error('Run `pnpm db:seed` before the payables tests')
      }
      chargeTypeId = charge.id

      await tx
        .insert(principals)
        .values({
          id: PRINCIPAL,
          type: 'internal',
          email: 'payables-test@qabandi.test',
          nameEn: 'Payables Test',
        })
        .onConflictDoNothing()

      await tx
        .insert(customers)
        .values({ id: CUSTOMER, code: 'CUST-PAYABLES-TEST', legalNameEn: 'Payables Test Customer' })
        .onConflictDoNothing()

      await tx
        .insert(partners)
        .values({ id: PARTNER, code: 'AGT-PAYABLES', type: 'agent', legalNameEn: 'Test Agent' })
        .onConflictDoNothing()

      for (const [id, code, name] of [
        [BRANCH, 'PYA', 'Payables Test Branch'],
        [OTHER_BRANCH, 'PYB', 'Payables Other Branch'],
      ] as const) {
        await tx
          .insert(branches)
          .values({
            id,
            code,
            legalNameEn: name,
            legalNameAr: 'فرع',
            country: 'KW',
            baseCurrency: 'KWD',
            invoiceSeries: code,
            calendarId: calendar.id,
          })
          .onConflictDoNothing()

        await tx
          .insert(principalBranchRoles)
          .values({ principalId: PRINCIPAL, branchId: id, roleId: role.id })
          .onConflictDoNothing()
      }

      await tx
        .insert(jobs)
        .values({
          id: JOB,
          reference: 'PYA-JOB-PAYABLES-1',
          branchId: BRANCH,
          customerId: CUSTOMER,
          mode: 'sea_fcl',
          tradeDirection: 'import',
        })
        .onConflictDoNothing()
    })
  })

  afterAll(() => {
    harness.session = null
  })

  describe('the match ceiling', () => {
    it('matches a cost line against a billed line', async () => {
      const billId = await bill('100.000')
      const lineId = await billLine(billId, '100.000')
      const costId = await accrual('100.000')

      const state = await matchSupplierLine(
        {},
        form({
          supplierInvoiceId: billId,
          supplierInvoiceLineId: lineId,
          chargeLineId: costId,
          amount: '100.000',
        }),
      )

      expect(state.errors).toBeUndefined()
      expect(state.message).toBeUndefined()
      expect(await liveMatches(lineId)).toHaveLength(1)
    })

    it('allows a line to be matched in pieces against several accruals', async () => {
      const billId = await bill('100.000')
      const lineId = await billLine(billId, '100.000')

      for (const part of ['60.000', '40.000']) {
        const costId = await accrual(part)
        const state = await matchSupplierLine(
          {},
          form({
            supplierInvoiceId: billId,
            supplierInvoiceLineId: lineId,
            chargeLineId: costId,
            amount: part,
          }),
        )
        expect(state.errors).toBeUndefined()
      }

      expect(await liveMatches(lineId)).toHaveLength(2)
    })

    /**
     * The same decimal case that broke settlement. A line of 8.700 with 8.600
     * matched leaves exactly 0.100 — computed as floats that remainder is
     * 0.09999999999999964 and the last match is refused as over-billed.
     */
    it('accepts the last fils of a line matched in pieces', async () => {
      const billId = await bill('8.700')
      const lineId = await billLine(billId, '8.700')

      const first = await accrual('8.600')
      await matchSupplierLine(
        {},
        form({
          supplierInvoiceId: billId,
          supplierInvoiceLineId: lineId,
          chargeLineId: first,
          amount: '8.600',
        }),
      )

      const last = await accrual('0.100')
      const state = await matchSupplierLine(
        {},
        form({
          supplierInvoiceId: billId,
          supplierInvoiceLineId: lineId,
          chargeLineId: last,
          amount: '0.100',
        }),
      )

      expect(state.errors).toBeUndefined()
      expect(await liveMatches(lineId)).toHaveLength(2)
    })

    it('refuses more than the line was billed for', async () => {
      const billId = await bill('100.000')
      const lineId = await billLine(billId, '100.000')
      const costId = await accrual('150.000')

      const state = await matchSupplierLine(
        {},
        form({
          supplierInvoiceId: billId,
          supplierInvoiceLineId: lineId,
          chargeLineId: costId,
          amount: '150.000',
        }),
      )

      expect(state.errors?.amount).toBe('payablesValidation.overMatched')
      expect(await liveMatches(lineId)).toEqual([])
    })

    it('refuses the piece that would take a line past what was billed', async () => {
      const billId = await bill('100.000')
      const lineId = await billLine(billId, '100.000')

      const first = await accrual('90.000')
      await matchSupplierLine(
        {},
        form({
          supplierInvoiceId: billId,
          supplierInvoiceLineId: lineId,
          chargeLineId: first,
          amount: '90.000',
        }),
      )

      const second = await accrual('20.000')
      const state = await matchSupplierLine(
        {},
        form({
          supplierInvoiceId: billId,
          supplierInvoiceLineId: lineId,
          chargeLineId: second,
          amount: '20.000',
        }),
      )

      expect(state.errors?.amount).toBeDefined()
      expect(await liveMatches(lineId)).toHaveLength(1)
    })

    it('rejects a malformed amount before touching the database', async () => {
      const billId = await bill('100.000')
      const lineId = await billLine(billId, '100.000')
      const costId = await accrual('100.000')

      const state = await matchSupplierLine(
        {},
        form({
          supplierInvoiceId: billId,
          supplierInvoiceLineId: lineId,
          chargeLineId: costId,
          amount: 'about a hundred',
        }),
      )

      expect(state.errors?.amount).toBeDefined()
      expect(await liveMatches(lineId)).toEqual([])
    })

    it('asks for a cost line when none was chosen', async () => {
      const billId = await bill('100.000')
      const lineId = await billLine(billId, '100.000')

      const state = await matchSupplierLine(
        {},
        form({ supplierInvoiceId: billId, supplierInvoiceLineId: lineId, amount: '10.000' }),
      )

      expect(state.errors?.chargeLineId).toBeDefined()
    })
  })

  describe('what may not be matched', () => {
    /**
     * Matching an approved bill would move a variance somebody has already
     * signed off. The gate is on the bill's status, not on the line.
     */
    it('refuses to match against an approved bill', async () => {
      const billId = await bill('100.000', 'approved')
      const lineId = await billLine(billId, '100.000')
      const costId = await accrual('100.000')

      const state = await matchSupplierLine(
        {},
        form({
          supplierInvoiceId: billId,
          supplierInvoiceLineId: lineId,
          chargeLineId: costId,
          amount: '100.000',
        }),
      )

      expect(state.message).toBe('payablesValidation.billApprovedMatchLocked')
      expect(await liveMatches(lineId)).toEqual([])
    })

    /** The same cost line twice on one billed line is a double count. */
    it('refuses the same cost line twice on one billed line', async () => {
      const billId = await bill('100.000')
      const lineId = await billLine(billId, '100.000')
      const costId = await accrual('40.000')

      const once = form({
        supplierInvoiceId: billId,
        supplierInvoiceLineId: lineId,
        chargeLineId: costId,
        amount: '40.000',
      })
      await matchSupplierLine({}, once)

      const state = await matchSupplierLine(
        {},
        form({
          supplierInvoiceId: billId,
          supplierInvoiceLineId: lineId,
          chargeLineId: costId,
          amount: '40.000',
        }),
      )

      expect(state.errors?.chargeLineId).toBe('payablesValidation.costLineAlreadyMatched')
      expect(await liveMatches(lineId)).toHaveLength(1)
    })

    /**
     * A Dubai bill matched against a Kuwait accrual lands the variance in the
     * wrong entity's P&L. The database trigger from 0014 refuses it and the
     * action turns that into a sentence rather than a stack trace.
     */
    it('refuses a cost line from another branch', async () => {
      const billId = await bill('100.000')
      const lineId = await billLine(billId, '100.000')
      const foreignCost = await accrual('100.000', OTHER_BRANCH)

      const state = await matchSupplierLine(
        {},
        form({
          supplierInvoiceId: billId,
          supplierInvoiceLineId: lineId,
          chargeLineId: foreignCost,
          amount: '100.000',
        }),
      )

      expect(state.errors?.chargeLineId).toBe('payablesValidation.costLineOtherBranch')
      expect(await liveMatches(lineId)).toEqual([])
    })
  })

  describe('retraction — §5.5 holds here too', () => {
    /**
     * The row survives. "This bill was matched to that accrual and then
     * somebody unmatched it" is the history worth having when a variance is
     * argued about three months later, and a deleted row cannot say who
     * changed their mind.
     */
    it('retracts rather than deletes', async () => {
      const billId = await bill('100.000')
      const lineId = await billLine(billId, '100.000')
      const costId = await accrual('100.000')

      await matchSupplierLine(
        {},
        form({
          supplierInvoiceId: billId,
          supplierInvoiceLineId: lineId,
          chargeLineId: costId,
          amount: '100.000',
        }),
      )
      const [match] = await liveMatches(lineId)

      await unmatchSupplierLine(form({ matchId: match!.id, supplierInvoiceId: billId }))

      expect(await liveMatches(lineId)).toEqual([])

      const all = await withActor(actor, (tx) =>
        tx
          .select({
            id: supplierInvoiceMatches.id,
            retractedAt: supplierInvoiceMatches.retractedAt,
            retractedById: supplierInvoiceMatches.retractedById,
          })
          .from(supplierInvoiceMatches)
          .where(eq(supplierInvoiceMatches.id, match!.id)),
      )

      expect(all).toHaveLength(1)
      expect(all[0]!.retractedAt).not.toBeNull()
      expect(all[0]!.retractedById).toBe(PRINCIPAL)
    })

    /** A retracted match frees the amount it was holding. */
    it('releases the amount so the line can be matched again', async () => {
      const billId = await bill('100.000')
      const lineId = await billLine(billId, '100.000')

      const first = await accrual('100.000')
      await matchSupplierLine(
        {},
        form({
          supplierInvoiceId: billId,
          supplierInvoiceLineId: lineId,
          chargeLineId: first,
          amount: '100.000',
        }),
      )
      const [match] = await liveMatches(lineId)
      await unmatchSupplierLine(form({ matchId: match!.id, supplierInvoiceId: billId }))

      const second = await accrual('100.000')
      const state = await matchSupplierLine(
        {},
        form({
          supplierInvoiceId: billId,
          supplierInvoiceLineId: lineId,
          chargeLineId: second,
          amount: '100.000',
        }),
      )

      expect(state.errors).toBeUndefined()
      expect(await liveMatches(lineId)).toHaveLength(1)
    })

    /** Retracting twice must not double-count anything or lose the first hand. */
    it('is idempotent', async () => {
      const billId = await bill('100.000')
      const lineId = await billLine(billId, '100.000')
      const costId = await accrual('50.000')

      await matchSupplierLine(
        {},
        form({
          supplierInvoiceId: billId,
          supplierInvoiceLineId: lineId,
          chargeLineId: costId,
          amount: '50.000',
        }),
      )
      const [match] = await liveMatches(lineId)

      await unmatchSupplierLine(form({ matchId: match!.id, supplierInvoiceId: billId }))
      const [first] = await withActor(actor, (tx) =>
        tx
          .select({ at: supplierInvoiceMatches.retractedAt })
          .from(supplierInvoiceMatches)
          .where(eq(supplierInvoiceMatches.id, match!.id)),
      )

      await unmatchSupplierLine(form({ matchId: match!.id, supplierInvoiceId: billId }))
      const [second] = await withActor(actor, (tx) =>
        tx
          .select({ at: supplierInvoiceMatches.retractedAt })
          .from(supplierInvoiceMatches)
          .where(eq(supplierInvoiceMatches.id, match!.id)),
      )

      // The first retraction stands; the second changes nothing.
      expect(second!.at).toEqual(first!.at)
    })

    /** Same gate as matching: an approved bill's history does not move. */
    it('refuses to retract on an approved bill', async () => {
      const billId = await bill('100.000')
      const lineId = await billLine(billId, '100.000')
      const costId = await accrual('100.000')

      await matchSupplierLine(
        {},
        form({
          supplierInvoiceId: billId,
          supplierInvoiceLineId: lineId,
          chargeLineId: costId,
          amount: '100.000',
        }),
      )
      const [match] = await liveMatches(lineId)

      await withActor(actor, (tx) =>
        tx
          .update(supplierInvoices)
          .set({ status: 'approved', updatedAt: new Date() })
          .where(eq(supplierInvoices.id, billId)),
      )

      await unmatchSupplierLine(form({ matchId: match!.id, supplierInvoiceId: billId }))

      // Still live: the retraction was filtered out by the status condition.
      expect(await liveMatches(lineId)).toHaveLength(1)
    })

    it('does nothing without a match id', async () => {
      await expect(unmatchSupplierLine(form({ supplierInvoiceId: 'x' }))).resolves.toBeUndefined()
    })
  })
})

/**
 * Reading a bill with the model — the refusal half, which needs no database.
 *
 * The service does the reading; what this action owns is the sentence a
 * coordinator gets when nothing was written. That sentence is the service's
 * refusal *code* in the reader's language, never its English `refusal` — and
 * where the figures did not add up, it is still the figures, line by line.
 */
describe('reading a bill that was not written', () => {
  const fetchMock = vi.fn()

  /** The upload answers first, then the reading answers with `reading`. */
  const serviceAnswers = (reading: Record<string, unknown>) => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ assetId: 'asset-1' }) })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ supplierInvoiceId: null, ...reading }),
      })
  }

  const scanForm = () => {
    const data = form({ branchId: BRANCH, partnerId: PARTNER })
    data.set(
      'scan',
      new File([new Uint8Array([37, 80, 68, 70])], 'bill.pdf', { type: 'application/pdf' }),
    )
    return data
  }

  beforeAll(() => {
    harness.session = session
    vi.stubGlobal('fetch', fetchMock)
    vi.stubEnv('SERVICE_URL', 'http://service.test')
    vi.stubEnv('INTERNAL_API_SECRET', 'secret')
  })

  afterAll(() => {
    harness.session = null
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  it('puts each finding into its own clause, with both figures', async () => {
    fetchMock.mockReset()
    serviceAnswers({
      refusal:
        'The invoice does not reconcile: line 2: the document says 990, the figures give 900',
      refusalCode: 'not_reconciled',
      refusalValues: { count: '2' },
      findings: [
        { check: 'line_amount', line: 2, stated: '990', computed: '900', message: 'English' },
        { check: 'total', line: null, stated: '990', computed: '900', message: 'English' },
      ],
    })

    const state = await readSupplierBill({}, scanForm())

    expect(state.message).toBe(
      'payablesValidation.billNotReconciled:' +
        JSON.stringify({
          details:
            'payablesValidation.findingLine:{"line":"2","stated":"990","computed":"900"}' +
            'payablesValidation.findingJoiner' +
            'payablesValidation.findingTotal:{"stated":"990","computed":"900"}',
        }),
    )
  })

  it('words each part it could not read from its code, field and line', async () => {
    fetchMock.mockReset()
    serviceAnswers({
      refusal: 'Invoice number: required; line 2: Not a known charge type',
      refusalCode: 'unreadable_fields',
      refusalValues: { count: '4' },
      readingIssues: [
        { where: 'header', field: 'invoiceNumber', line: null, code: 'required', values: {} },
        { where: 'line', field: 'chargeType', line: 2, code: 'unknownReference', values: {} },
        { where: 'header', field: 'lines', line: null, code: 'noLines', values: {} },
        // A field this side has no name for is left out, never guessed at.
        { where: 'line', field: 'somethingNew', line: 3, code: 'required', values: {} },
      ],
    })

    const state = await readSupplierBill({}, scanForm())
    expect(state.message).toBe(
      'payablesValidation.billPartsUnreadableDetail:' +
        JSON.stringify({
          details:
            'payablesValidation.readingInField:' +
            JSON.stringify({
              field: 'payablesValidation.readingFieldInvoiceNumber',
              problem: 'payablesValidation.readingMissing',
            }) +
            'payablesValidation.findingJoiner' +
            'payablesValidation.readingOnLine:' +
            JSON.stringify({
              line: '2',
              field: 'payablesValidation.readingFieldChargeType',
              problem: 'payablesValidation.readingUnknownChargeType',
            }) +
            'payablesValidation.findingJoiner' +
            'payablesValidation.readingNoLines',
        }),
    )
  })

  it('counts the parts it could not read when none can be worded', async () => {
    fetchMock.mockReset()
    serviceAnswers({
      refusal: 'Invoice number: required',
      refusalCode: 'unreadable_fields',
      refusalValues: { count: '3' },
    })

    const state = await readSupplierBill({}, scanForm())
    expect(state.message).toBe('payablesValidation.billPartsUnreadable:{"count":3}')
  })

  it('says the model was unsure when there is nothing to correct', async () => {
    fetchMock.mockReset()
    serviceAnswers({ refusal: 'not confident enough', refusalCode: 'low_confidence' })

    const state = await readSupplierBill({}, scanForm())
    expect(state.message).toBe('payablesValidation.billLowConfidence')
  })

  it('names both sizes for a scan too large to send', async () => {
    fetchMock.mockReset()
    serviceAnswers({
      refusal: 'The scan is 31MB, above the 20MB limit for extraction.',
      refusalCode: 'scan_too_large',
      refusalValues: { sizeMb: '31', limitMb: '20' },
    })

    const state = await readSupplierBill({}, scanForm())
    expect(state.message).toBe('payablesValidation.scanTooLarge:{"sizeMb":"31","limitMb":"20"}')
  })

  /*
    F18. The extractor wrote every bill at the column default rate of 1; with
    no rate on file it now writes nothing and says which rate is missing.
  */
  it('names the missing exchange rate when the bill was not written for want of one', async () => {
    fetchMock.mockReset()
    serviceAnswers({
      refusal: 'No exchange rate from USD to KWD is on file, so the bill was not written.',
      refusalCode: 'no_exchange_rate',
      refusalValues: { currency: 'USD', base: 'KWD' },
    })

    const state = await readSupplierBill({}, scanForm())
    expect(state.message).toBe(
      'payablesValidation.billNoExchangeRate:{"currency":"USD","base":"KWD"}',
    )
  })

  /** An English sentence with no code this side knows is never shown. */
  it('falls back rather than showing the service’s English', async () => {
    fetchMock.mockReset()
    serviceAnswers({ refusal: 'Some English sentence', refusalCode: 'something_new' })

    const state = await readSupplierBill({}, scanForm())
    expect(state.message).toBe('payablesValidation.scanNotInvoice')
  })
})
