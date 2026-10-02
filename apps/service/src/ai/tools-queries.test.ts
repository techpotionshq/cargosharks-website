/**
 * The two finance read tools, against a database.
 *
 * `tools.test.ts` covers the pure half — turning a model's JSON into a filter.
 * These are the other half its header names as belonging to a database-backed
 * suite: the queries. A bad SQL fragment here does not throw; it answers a
 * question about money with a confident wrong number, so the queries are worth
 * exercising against real rows and a real RLS scope.
 *
 * The definitions are the board's, deliberately: `list_unbilled` must exclude
 * an accrual (`features/ledger/unbilled.ts`) and `list_quotes_expiring` must
 * exclude a lapsed or draft quote (the `quote.expiring` reminder worker). Each
 * negative control below is one of those exclusions.
 *
 * Isolated fixtures — random ids, run-scoped codes — so the suite never
 * collides with another's on the shared development database.
 */

import { randomUUID } from 'node:crypto'
import { beforeAll, describe, expect, it } from 'vitest'
import { eq, sql } from 'drizzle-orm'
import type { Actor } from '@qabandi/db'

const APP_URL = process.env.TEST_DATABASE_URL
const enabled = Boolean(APP_URL)
if (APP_URL) process.env.DATABASE_URL = APP_URL

const {
  branches,
  chargeLines,
  customerBranchTerms,
  customers,
  enquiries,
  freeTimeClocks,
  invoices,
  jobs,
  locations,
  principals,
  quotes,
  withActor,
  workingCalendars,
} = await import('@qabandi/db')

const { runTool } = await import('./tools')

const RUN = Date.now().toString(36).toUpperCase().slice(-5)
const BRANCH = randomUUID()
const PRINCIPAL = randomUUID()
const CUSTOMER = randomUUID()
const JOB = randomUUID()
const CODE = `TLQ-${RUN}`
const JOB_REF = `TLQ-JOB-${RUN}`
const LANE_A_REF = `TLQ-LCL-A-${RUN}`
const LANE_B_REF = `TLQ-LCL-B-${RUN}`
const ARRIVING_REF = `TLQ-AIR-SOON-${RUN}`
const ARRIVED_REF = `TLQ-AIR-IN-${RUN}`
const LATER_REF = `TLQ-AIR-LATER-${RUN}`

const actor: Actor = { principalId: PRINCIPAL, type: 'internal', branchIds: [BRANCH] }
const systemActor = { ...actor, type: 'system' as const }

/** A date `offset` days from today, as the `date` columns store it. */
const day = (offset: number): string => {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() + offset)
  return d.toISOString().slice(0, 10)
}

let chargeTypeId = ''
let seq = 0

/** A sent (or otherwise) quotation on an enquiry of its own — see the worker's note. */
async function quote(status: 'draft' | 'sent', validUntil: string | null): Promise<string> {
  seq += 1
  const reference = `${CODE}-Q${seq}`
  await withActor(systemActor, async (tx) => {
    const [enquiry] = await tx
      .insert(enquiries)
      .values({
        reference: `${CODE}-E${seq}`,
        branchId: BRANCH,
        customerId: CUSTOMER,
        channel: 'email',
        mode: 'sea_fcl',
        tradeDirection: 'import',
      })
      .returning({ id: enquiries.id })

    await tx.insert(quotes).values({
      reference,
      enquiryId: enquiry!.id,
      branchId: BRANCH,
      status,
      currency: 'KWD',
      totalSell: '600.000',
      totalCost: '400.000',
      validUntil,
    })
  })
  return reference
}

describe.skipIf(!enabled)('the finance read tools', () => {
  beforeAll(async () => {
    await withActor(systemActor, async (tx) => {
      const [calendar] = await tx
        .select({ id: workingCalendars.id })
        .from(workingCalendars)
        .where(eq(workingCalendars.key, 'kuwait'))
        .limit(1)
      if (!calendar) throw new Error('Run `pnpm db:seed` before this suite')

      const types = await tx.execute(sql`select id from charge_types limit 1`)
      chargeTypeId = (types.rows[0] as { id: string }).id

      await tx.insert(principals).values({
        id: PRINCIPAL,
        type: 'internal',
        email: `tools-${RUN}@qabandi.test`,
        nameEn: 'Tools Fixture',
      })

      await tx.insert(branches).values({
        id: BRANCH,
        code: CODE,
        legalNameEn: 'Tools Branch',
        legalNameAr: 'فرع الأدوات',
        country: 'KW',
        baseCurrency: 'KWD',
        invoiceSeries: CODE,
        calendarId: calendar.id,
      })

      await tx
        .insert(customers)
        .values({ id: CUSTOMER, code: `${CODE}-C`, legalNameEn: 'Tools Customer' })

      await tx.insert(jobs).values({
        id: JOB,
        reference: JOB_REF,
        branchId: BRANCH,
        customerId: CUSTOMER,
        mode: 'sea_fcl',
        tradeDirection: 'import',
      })

      // One unbilled revenue line (should count), one revenue accrual (should
      // not — an estimate has no business on a customer invoice).
      await tx.insert(chargeLines).values([
        {
          id: randomUUID(),
          jobId: JOB,
          branchId: BRANCH,
          direction: 'revenue',
          chargeTypeId,
          basis: 'flat',
          rate: '150.000000',
          amount: '150.000000',
          currency: 'KWD',
          amountBase: '150.000000',
          baseCurrency: 'KWD',
          isAccrual: false,
        },
        {
          id: randomUUID(),
          jobId: JOB,
          branchId: BRANCH,
          direction: 'revenue',
          chargeTypeId,
          basis: 'flat',
          rate: '999.000000',
          amount: '999.000000',
          currency: 'KWD',
          amountBase: '999.000000',
          baseCurrency: 'KWD',
          isAccrual: true,
        },
        // A billed cost, so the margin has both sides to reduce.
        {
          id: randomUUID(),
          jobId: JOB,
          branchId: BRANCH,
          direction: 'cost',
          chargeTypeId,
          basis: 'flat',
          rate: '400.000000',
          amount: '400.000000',
          currency: 'KWD',
          amountBase: '400.000000',
          baseCurrency: 'KWD',
          isAccrual: false,
        },
      ])

      // Credit terms and one issued, unpaid invoice — a 10,000 limit against
      // 3,000 outstanding (plus the part-paid one below), comfortably within it.
      await tx.insert(customerBranchTerms).values({
        customerId: CUSTOMER,
        branchId: BRANCH,
        creditLimit: '10000.000',
        creditCurrency: 'KWD',
        isOnHold: false,
      })

      await tx.insert(invoices).values({
        branchId: BRANCH,
        customerId: CUSTOMER,
        seriesNo: `${CODE}-INV1`,
        status: 'issued',
        currency: 'KWD',
        subtotal: '3000.000',
        taxAmount: '0.000',
        total: '3000.000',
        amountPaid: '0.000',
        taxTreatment: 'out_of_scope',
        issuedAt: new Date('2026-08-01T12:00:00Z'),
        dueOn: '2026-08-31',
      })

      // A part-paid invoice not yet due — off the overdue list, but a person
      // can still ask what is left on it (ai-15).
      await tx.insert(invoices).values({
        branchId: BRANCH,
        customerId: CUSTOMER,
        seriesNo: `${CODE}-INV2`,
        status: 'part_paid',
        currency: 'KWD',
        subtotal: '500.000',
        taxAmount: '0.000',
        total: '500.000',
        amountPaid: '120.250',
        amountCredited: '30.000',
        taxTreatment: 'out_of_scope',
        issuedAt: new Date(),
        dueOn: day(20),
      })

      // An air import arriving in three days, one already arrived, and one
      // due in three weeks — the arrival window has to pick the first only.
      const soon = new Date(Date.now() + 3 * 86_400_000)
      await tx.insert(jobs).values([
        {
          id: randomUUID(),
          reference: ARRIVING_REF,
          branchId: BRANCH,
          customerId: CUSTOMER,
          mode: 'air' as const,
          tradeDirection: 'import' as const,
          status: 'in_transit' as const,
          eta: soon,
        },
        {
          id: randomUUID(),
          reference: ARRIVED_REF,
          branchId: BRANCH,
          customerId: CUSTOMER,
          mode: 'air' as const,
          tradeDirection: 'import' as const,
          status: 'arrived' as const,
          eta: soon,
          ata: new Date(),
        },
        {
          id: randomUUID(),
          reference: LATER_REF,
          branchId: BRANCH,
          customerId: CUSTOMER,
          mode: 'air' as const,
          tradeDirection: 'export' as const,
          status: 'booked' as const,
          eta: new Date(Date.now() + 21 * 86_400_000),
        },
      ])

      // Two loose LCL shipments on one lane, undated so they share a window —
      // exactly the pair `clusterShipments` should group into one container.
      const locs = await tx.select({ id: locations.id }).from(locations).limit(2)
      if (locs.length < 2) throw new Error('Run `pnpm db:seed` — need two locations')
      const [origin, destination] = locs

      await tx.insert(jobs).values(
        [LANE_A_REF, LANE_B_REF].map((reference) => ({
          id: randomUUID(),
          reference,
          branchId: BRANCH,
          customerId: CUSTOMER,
          mode: 'sea_lcl' as const,
          tradeDirection: 'import' as const,
          status: 'booked' as const,
          originId: origin!.id,
          destinationId: destination!.id,
          volumeCbm: '10.000',
        })),
      )
    })
  })

  describe('list_unbilled', () => {
    it('reports revenue earned but not invoiced, excluding accruals', async () => {
      const { rows, total } = (await runTool(actor, 'list_unbilled', {})) as {
        total: number
        rows: { shipment: string; lines: number; amountBase: string }[]
      }
      expect(total).toBeGreaterThanOrEqual(rows.length)

      const mine = rows.find((row) => row.shipment === JOB_REF)
      expect(mine).toBeDefined()
      // Only the non-accrual revenue line — the 999 accrual is left out.
      expect(mine!.lines).toBe(1)
      expect(Number(mine!.amountBase)).toBeCloseTo(150, 3)
    })
  })

  /*
    O20. This filtered on `ends_on` — the day the box came back — which nothing
    set, so the assistant answered "what free time is running out" with nothing,
    and would have listed only clocks already stopped.
  */
  describe('list_free_time', () => {
    it('lists a running clock whose free time ends soon, and not a stopped one', async () => {
      await withActor(systemActor, (tx) =>
        tx.insert(freeTimeClocks).values([
          {
            jobId: JOB,
            kind: 'demurrage',
            freeDays: 5,
            startsOn: day(-2),
            perDiem: '20.000',
            currency: 'KWD',
          },
          {
            jobId: JOB,
            kind: 'storage',
            freeDays: 5,
            startsOn: day(-2),
            endsOn: day(-1),
            perDiem: '20.000',
            currency: 'KWD',
          },
        ]),
      )

      const { rows } = (await runTool(actor, 'list_free_time', { withinDays: 7 })) as {
        rows: { shipment: string; kind: string; freeUntil: string }[]
      }
      const mine = rows.filter((row) => row.shipment === JOB_REF)
      expect(mine.map((row) => row.kind)).toEqual(['demurrage'])
      // Day one is the start: five free days from two days ago end in two.
      expect(mine[0]!.freeUntil).toBe(day(2))
    })
  })

  describe('list_consolidation_candidates', () => {
    it('groups loose shipments that share a lane into one container', async () => {
      const clusters = (await runTool(actor, 'list_consolidation_candidates', {})) as {
        shipments: number
        totalCbm: number
        references: string[]
      }[]

      const mine = clusters.find((c) => c.references.includes(LANE_A_REF))
      expect(mine).toBeDefined()
      expect(mine!.references).toContain(LANE_B_REF)
      expect(mine!.shipments).toBe(2)
      expect(mine!.totalCbm).toBeCloseTo(20, 3)
    })
  })

  describe('get_customer_credit', () => {
    it('reports the standing per branch, with limit, outstanding and headroom', async () => {
      const result = (await runTool(actor, 'get_customer_credit', { customer: `${CODE}-C` })) as {
        found: boolean
        customer: string
        branches: {
          branch: string
          currency: string
          outstanding: string
          limit: string | null
          headroom: string | null
          outcome: string
          blocked: boolean
          onHold: boolean
        }[]
      }

      expect(result.found).toBe(true)
      // Only the one branch the actor can see — RLS scopes the terms rows.
      expect(result.branches).toHaveLength(1)
      const branch = result.branches[0]!
      expect(branch.currency).toBe('KWD')
      // The overdue 3,000 plus the 349.750 still owed on the part-paid one.
      expect(Number(branch.outstanding)).toBeCloseTo(3349.75, 3)
      expect(Number(branch.limit)).toBeCloseTo(10000, 3)
      expect(Number(branch.headroom)).toBeCloseTo(6650.25, 3)
      expect(branch.outcome).toBe('within_limit')
      expect(branch.blocked).toBe(false)
      expect(branch.onHold).toBe(false)
    })

    it('reports a customer it cannot find as not found', async () => {
      const result = (await runTool(actor, 'get_customer_credit', {
        customer: 'NO-SUCH-CUSTOMER-XYZ',
      })) as { found: boolean }
      expect(result.found).toBe(false)
    })
  })

  describe('get_margin', () => {
    it('reduces the job ledger to revenue, cost and gross in base currency', async () => {
      const result = (await runTool(actor, 'get_margin', { reference: JOB_REF })) as {
        found: boolean
        currency: string
        revenue: string
        cost: string
        gross: string
        billedCost: string
        accruedCost: string
      }

      expect(result.found).toBe(true)
      expect(result.currency).toBe('KWD')
      // Two revenue lines (150 + 999) against one 400 cost.
      expect(Number(result.revenue)).toBeCloseTo(1149, 3)
      expect(Number(result.cost)).toBeCloseTo(400, 3)
      expect(Number(result.gross)).toBeCloseTo(749, 3)
      // The cost is a bill, not an estimate.
      expect(Number(result.billedCost)).toBeCloseTo(400, 3)
      expect(Number(result.accruedCost)).toBeCloseTo(0, 3)
    })

    it('does not distinguish a missing job from one in another branch', async () => {
      const result = (await runTool(actor, 'get_margin', { reference: 'NO-SUCH-JOB' })) as {
        found: boolean
      }
      expect(result.found).toBe(false)
    })
  })

  describe('list_quotes_expiring', () => {
    it('lists a sent quote inside the window and excludes lapsed, distant and draft', async () => {
      const soon = await quote('sent', day(3))
      const distant = await quote('sent', day(60))
      const lapsed = await quote('sent', day(-5))
      const draft = await quote('draft', day(3))

      const { rows } = (await runTool(actor, 'list_quotes_expiring', {})) as {
        rows: { reference: string }[]
      }
      const refs = new Set(rows.map((row) => row.reference))

      expect(refs.has(soon)).toBe(true)
      expect(refs.has(distant)).toBe(false)
      expect(refs.has(lapsed)).toBe(false)
      expect(refs.has(draft)).toBe(false)
    })

    it('widens to the horizon it is given', async () => {
      const distant = await quote('sent', day(45))

      const { rows } = (await runTool(actor, 'list_quotes_expiring', { withinDays: 50 })) as {
        rows: { reference: string }[]
      }
      expect(new Set(rows.map((row) => row.reference)).has(distant)).toBe(true)
    })
  })

  /*
    ai-1: "sea" compared exactly against a column holding sea_fcl and sea_lcl
    matched nothing. The family must find both.
  */
  describe('list_jobs', () => {
    type Listed = { total: number; shown: number; rows: { reference: string; mode: string }[] }

    it('finds full-container and groupage shipments when asked for sea', async () => {
      const listed = (await runTool(actor, 'list_jobs', { mode: 'sea', limit: 50 })) as Listed
      const refs = new Set(listed.rows.map((row) => row.reference))
      expect(refs.has(JOB_REF)).toBe(true) // sea_fcl
      expect(refs.has(LANE_A_REF)).toBe(true) // sea_lcl
      expect(listed.rows.every((row) => row.mode.startsWith('sea_'))).toBe(true)
      // Only this branch's shipments are visible: the fixture's three sea jobs.
      expect(listed.total).toBe(3)
    })

    it('lists what is arriving in the window, soonest first, and not what has arrived', async () => {
      const listed = (await runTool(actor, 'list_jobs', { arrivingWithinDays: 7 })) as Listed
      expect(listed.rows.map((row) => row.reference)).toEqual([ARRIVING_REF])
      expect(listed.total).toBe(1)
    })

    it('narrows by direction', async () => {
      const listed = (await runTool(actor, 'list_jobs', { direction: 'export' })) as Listed
      expect(listed.rows.map((row) => row.reference)).toEqual([LATER_REF])
    })

    it('reports every match in total even when fewer are shown', async () => {
      const listed = (await runTool(actor, 'list_jobs', { limit: 2 })) as Listed
      expect(listed.shown).toBe(2)
      expect(listed.total).toBe(6)
    })
  })

  describe('list_overdue_invoices', () => {
    it('carries the balance per row and the outstanding sum per currency', async () => {
      const listed = (await runTool(actor, 'list_overdue_invoices', {
        customer: `${CODE}-C`,
      })) as {
        total: number
        rows: { number: string; balance: string }[]
        outstandingByCurrency: { currency: string; invoices: number; outstanding: string }[]
      }
      expect(listed.rows.map((row) => row.number)).toEqual([`${CODE}-INV1`])
      expect(listed.total).toBe(1)
      expect(Number(listed.rows[0]!.balance)).toBeCloseTo(3000, 3)
      expect(listed.outstandingByCurrency).toEqual([
        { currency: 'KWD', invoices: 1, outstanding: expect.any(String) },
      ])
    })
  })

  // ai-15: a named invoice's balance, whether or not it is overdue.
  describe('get_invoice', () => {
    it('reports the balance as total less paid less credited', async () => {
      const result = (await runTool(actor, 'get_invoice', { number: `${CODE}-INV2` })) as {
        found: boolean
        invoice: { balance: string; status: string; daysOverdue: number | null }
      }
      expect(result.found).toBe(true)
      expect(result.invoice.status).toBe('part_paid')
      // 500.000 - 120.250 - 30.000, in numeric — never a float.
      expect(result.invoice.balance).toBe('349.750000')
      expect(result.invoice.daysOverdue).toBeNull()
    })

    it('finds one invoice by a distinctive fragment, and asks when several match', async () => {
      const one = (await runTool(actor, 'get_invoice', { number: `${RUN}-INV2` })) as {
        found: boolean
      }
      expect(one.found).toBe(true)

      const several = (await runTool(actor, 'get_invoice', { number: `${CODE}-INV` })) as {
        found: boolean
        ambiguous: boolean
        candidates: string[]
      }
      expect(several.found).toBe(false)
      expect(several.ambiguous).toBe(true)
      expect(several.candidates).toHaveLength(2)
    })

    it('does not distinguish a missing invoice from one it may not see', async () => {
      const result = (await runTool(actor, 'get_invoice', { number: 'NO-SUCH-INV-XYZ' })) as {
        found: boolean
      }
      expect(result.found).toBe(false)
    })
  })
})
