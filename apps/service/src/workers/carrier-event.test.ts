/**
 * Carrier events onto jobs — attribution, and the rule about not overruling a
 * person.
 *
 * Two halves meet here and both fail quietly. Attribution decides *which
 * shipment* an event is about; `writeCarrierMilestone` decides what happens
 * next, and is shared with the poll feed so the two cannot grow different
 * answers.
 *
 * **A match that finds more than one job is treated as no match.** This is the
 * decision worth defending and the one most likely to be "simplified" later. A
 * container number is reused every few weeks and a house bill can repeat across
 * carriers and years, so "the first job that matched" is a coin flip. An
 * unattributed event costs an operator the manual entry they were already
 * doing; a misattributed one writes a false history onto a real shipment, and
 * nobody finds it until a demurrage dispute turns on when the box was actually
 * discharged.
 *
 * **The feed fills gaps and corrects its own dates; it does not overrule a
 * human.** An operator who marked a milestone complete did so with information
 * the carrier may not have — a phone call from the terminal. A feed that
 * silently moved that date hours later would make the board argue with the
 * person reading it, and the `returning` clause is how the worker learns the
 * guard fired rather than logging "written" for an event that changed nothing.
 *
 * **The write is an upsert.** Providers redeliver, the poll re-reads the same
 * event every hour, and carriers correct their own timestamps later — so
 * idempotency comes from `job_milestones_unique` rather than from remembering
 * to check first, which is what makes an hourly poll safe to run at all.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { and, eq } from 'drizzle-orm'
import type { Actor } from '@qabandi/db'

const APP_URL = process.env.TEST_DATABASE_URL
const enabled = Boolean(APP_URL)
if (APP_URL) process.env.DATABASE_URL = APP_URL

const {
  branches,
  customers,
  inboundWebhookEvents,
  jobMilestones,
  jobs,
  milestoneTemplates,
  principals,
  withActor,
  workingCalendars,
} = await import('@qabandi/db')

const { runCarrierEventIngest } = await import('./carrier-event')

const BRANCH = '00000000-0000-7000-8000-00000000ca01'
const CUSTOMER = '00000000-0000-7000-8000-00000000ca02'
const PRINCIPAL = '00000000-0000-7000-8000-00000000ca03'

const actor: Actor = { principalId: PRINCIPAL, type: 'internal', branchIds: [BRANCH] }
const systemActor = { ...actor, type: 'system' as const }

const RUN = Date.now().toString(36).toUpperCase().slice(-5)
let seq = 0

/** The provider's documented envelope: a notification, subject in `included`. */
const webhook = (event: string, container: Record<string, unknown>) => ({
  data: {
    id: `evt-${RUN}-${(seq += 1)}`,
    type: 'webhook_notification',
    attributes: { event, delivered_at: '2034-06-20T12:00:00Z' },
  },
  included: [{ type: 'container', id: 'c-1', attributes: container }],
})

/** A received webhook, as the endpoint records one before this worker runs. */
async function received(payload: Record<string, unknown>): Promise<string> {
  seq += 1
  return withActor(systemActor, async (tx) => {
    const [row] = await tx
      .insert(inboundWebhookEvents)
      .values({
        provider: 'terminal49',
        externalId: `${RUN}-${seq}`,
        payload,
      })
      .returning({ id: inboundWebhookEvents.id })
    return row!.id
  })
}

async function job(over: Record<string, unknown> = {}): Promise<{ id: string; reference: string }> {
  seq += 1
  const reference = `CAR-${RUN}-${seq}`
  return withActor(systemActor, async (tx) => {
    const [row] = await tx
      .insert(jobs)
      .values({
        reference,
        branchId: BRANCH,
        customerId: CUSTOMER,
        mode: 'sea_fcl',
        tradeDirection: 'import',
        status: 'in_transit',
        ...over,
      })
      .returning({ id: jobs.id })
    return { id: row!.id, reference }
  })
}

const milestonesOf = (jobId: string) =>
  withActor(actor, (tx) =>
    tx.select().from(jobMilestones).where(eq(jobMilestones.jobId, jobId)),
  )

const milestoneOn = async (jobId: string, code: string) => {
  const [row] = await withActor(actor, (tx) =>
    tx
      .select()
      .from(jobMilestones)
      .where(and(eq(jobMilestones.jobId, jobId), eq(jobMilestones.code, code))),
  )
  return row
}

/** The seeded sequence for one mode, direction and code. */
const templateSeq = async (mode: string, direction: string, code: string) => {
  const [row] = await withActor(actor, (tx) =>
    tx
      .select({ seq: milestoneTemplates.seq })
      .from(milestoneTemplates)
      .where(
        and(
          eq(milestoneTemplates.mode, mode as 'sea_fcl'),
          eq(milestoneTemplates.direction, direction as 'import'),
          eq(milestoneTemplates.code, code),
        ),
      ),
  )
  return row?.seq
}

describe.skipIf(!enabled)('carrier events onto jobs', () => {
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
          email: 'carrier-worker@qabandi.test',
          nameEn: 'Carrier Fixture',
        })
        .onConflictDoNothing()

      await tx
        .insert(branches)
        .values({
          id: BRANCH,
          code: 'CAR',
          legalNameEn: 'Carrier Events Branch',
          legalNameAr: 'فرع الناقل',
          country: 'KW',
          baseCurrency: 'KWD',
          invoiceSeries: 'CAR',
          calendarId: calendar.id,
        })
        .onConflictDoNothing()

      await tx
        .insert(customers)
        .values({
          id: CUSTOMER,
          code: 'CUST-CARRIER',
          legalNameEn: 'Carrier Fixture Customer',
          primaryBranchId: BRANCH,
        })
        .onConflictDoNothing()
    })
  })

  afterAll(async () => {
    // Closed, so a later poll or sweep does not pick these shipments up.
    if (!enabled) return
    await withActor(systemActor, (tx) =>
      tx.update(jobs).set({ closedAt: new Date() }).where(eq(jobs.branchId, BRANCH)),
    )
  })

  describe('attribution', () => {
    /** Our own reference first, because we chose it and the carrier echoes it. */
    it('attributes on our own job reference', async () => {
      const target = await job()
      const id = await received(
        webhook('container.transport.vessel_discharged', {
          number: 'MSCU1000001',
          ref_numbers: [target.reference],
          timestamp: '2034-06-14T11:00:00Z',
        }),
      )

      const result = await runCarrierEventIngest(id)

      expect(result.status).toBe('written')
      expect(result.jobReference).toBe(target.reference)
      expect(await milestoneOn(target.id, 'discharged')).toBeDefined()
    })

    it('falls back to the bill of lading when no reference came back', async () => {
      const bill = `MEDU${RUN}1`
      const target = await job({ masterBillNumber: bill })
      const id = await received(
        webhook('container.transport.vessel_discharged', {
          number: 'MSCU1000002',
          bill_of_lading_number: bill,
          timestamp: '2034-06-14T11:00:00Z',
        }),
      )

      const result = await runCarrierEventIngest(id)

      expect(result.status).toBe('written')
      expect(result.jobReference).toBe(target.reference)
    })

    it('matches a house bill as well as a master one', async () => {
      const bill = `HSE${RUN}1`
      const target = await job({ houseBillNumber: bill })
      const id = await received(
        webhook('container.transport.vessel_discharged', {
          number: 'MSCU1000003',
          bill_of_lading_number: bill,
          timestamp: '2034-06-14T11:00:00Z',
        }),
      )

      expect((await runCarrierEventIngest(id)).jobReference).toBe(target.reference)
    })

    /**
     * The decision this file exists to defend. `limit(2)` rather than
     * `limit(1)` is what makes an ambiguity visible instead of letting the
     * planner pick whichever row it returned first.
     */
    it('refuses a bill of lading that matches more than one open job', async () => {
      const bill = `DUP${RUN}1`
      await job({ masterBillNumber: bill })
      await job({ masterBillNumber: bill })

      const id = await received(
        webhook('container.transport.vessel_discharged', {
          number: 'MSCU1000004',
          bill_of_lading_number: bill,
          timestamp: '2034-06-14T11:00:00Z',
        }),
      )

      const result = await runCarrierEventIngest(id)

      expect(result.status).toBe('ambiguous')
      expect(result.reason).toContain('more than one open job')
    })

    /** A closed shipment is not a candidate — its bill may have been reissued. */
    it('ignores a closed job when matching a bill of lading', async () => {
      const bill = `CLD${RUN}1`
      const open = await job({ masterBillNumber: bill })
      const closed = await job({ masterBillNumber: bill })
      await withActor(systemActor, (tx) =>
        tx.update(jobs).set({ closedAt: new Date() }).where(eq(jobs.id, closed.id)),
      )

      const id = await received(
        webhook('container.transport.vessel_discharged', {
          number: 'MSCU1000005',
          bill_of_lading_number: bill,
          timestamp: '2034-06-14T11:00:00Z',
        }),
      )

      expect((await runCarrierEventIngest(id)).jobReference).toBe(open.reference)
    })

    /**
     * Costs an operator the manual entry they were already doing, which is the
     * cheaper of the two failures by a wide margin.
     */
    it('reports an event it cannot attribute, with what it tried', async () => {
      const id = await received(
        webhook('container.transport.vessel_discharged', {
          number: 'MSCU1000006',
          bill_of_lading_number: `NOJOB${RUN}`,
          timestamp: '2034-06-14T11:00:00Z',
        }),
      )

      const result = await runCarrierEventIngest(id)

      expect(result.status).toBe('unattributed')
      expect(result.reason).toContain(`NOJOB${RUN}`)
    })

    it('ignores a webhook event that is not there', async () => {
      const result = await runCarrierEventIngest('00000000-0000-7000-8000-00000000cafe')

      expect(result.status).toBe('ignored')
      expect(result.reason).toContain('no such webhook event')
    })

    /** Lifecycle events and estimate revisions carry no milestone. */
    it('ignores an event that carries no milestone', async () => {
      const id = await received(
        webhook('container.updated', { number: 'MSCU1000007', ref_numbers: ['whatever'] }),
      )

      expect((await runCarrierEventIngest(id)).status).toBe('ignored')
    })
  })

  describe('writing the milestone', () => {
    it('names it from the template, in both languages', async () => {
      const target = await job()
      const id = await received(
        webhook('container.transport.vessel_discharged', {
          number: 'MSCU2000001',
          ref_numbers: [target.reference],
          timestamp: '2034-06-14T11:00:00Z',
        }),
      )

      await runCarrierEventIngest(id)

      const written = await milestoneOn(target.id, 'discharged')
      // Both are `not null` because every board and document renders
      // bilingually, and a feed supplies a code and a date — never an Arabic
      // name.
      expect(written?.nameEn).toBeTruthy()
      expect(written?.nameAr).toBeTruthy()
    })

    /**
     * The sequence belongs to the job's *direction*, not merely its mode.
     *
     * `vessel_departed` is in both the import and the export set for `sea_fcl`
     * at different positions — thirty on the way in, seventy on the way out —
     * so a lookup on mode alone returns whichever row the planner happened to
     * produce. On an export shipment that renders the departure before the
     * gate-in that precedes it, on a board whose whole job is order.
     */
    it('takes the sequence for the job’s own trade direction', async () => {
      const target = await job({ tradeDirection: 'export' })
      const id = await received(
        webhook('container.transport.vessel_departed', {
          number: 'MSCU2000002',
          ref_numbers: [target.reference],
          timestamp: '2034-06-10T06:00:00Z',
        }),
      )

      await runCarrierEventIngest(id)

      const written = await milestoneOn(target.id, 'vessel_departed')
      expect(written?.seq).toBe(await templateSeq('sea_fcl', 'export', 'vessel_departed'))
    })

    it('takes the import sequence on an import shipment', async () => {
      const target = await job({ tradeDirection: 'import' })
      const id = await received(
        webhook('container.transport.vessel_departed', {
          number: 'MSCU2000003',
          ref_numbers: [target.reference],
          timestamp: '2034-06-10T06:00:00Z',
        }),
      )

      await runCarrierEventIngest(id)

      const written = await milestoneOn(target.id, 'vessel_departed')
      expect(written?.seq).toBe(await templateSeq('sea_fcl', 'import', 'vessel_departed'))
    })

    /** The note says which feed said so, and the guard below reads it back. */
    it('records the source and the place on the note', async () => {
      const target = await job()
      const id = await received(
        webhook('container.transport.vessel_discharged', {
          number: 'MSCU2000004',
          ref_numbers: [target.reference],
          timestamp: '2034-06-14T11:00:00Z',
          location_locode: 'KWSWK',
        }),
      )

      await runCarrierEventIngest(id)

      const written = await milestoneOn(target.id, 'discharged')
      expect(written?.notes).toContain('Carrier feed')
      expect(written?.notes).toContain('KWSWK')
    })

    /**
     * A code with no template for this mode is not written at all: the board,
     * the SLA clocks and the portal are all driven by the template, so a
     * milestone without one would appear out of order, belong to nobody, and
     * be visible to a customer by whichever default the column carries.
     */
    it('refuses a code the mode has no template for', async () => {
      const target = await job({ mode: 'air' })
      const id = await received(
        webhook('container.transport.vessel_discharged', {
          number: 'MSCU2000005',
          ref_numbers: [target.reference],
          timestamp: '2034-06-14T11:00:00Z',
        }),
      )

      const result = await runCarrierEventIngest(id)

      expect(result.status).toBe('ignored')
      expect(result.reason).toContain('air template')
      expect(await milestonesOf(target.id)).toEqual([])
    })
  })

  describe('redelivery and correction', () => {
    /** Providers redeliver; an hourly poll re-reads the same event all day. */
    it('updates rather than duplicating when the same event arrives twice', async () => {
      const target = await job()
      const payload = webhook('container.transport.vessel_discharged', {
        number: 'MSCU3000001',
        ref_numbers: [target.reference],
        timestamp: '2034-06-14T11:00:00Z',
      })

      await runCarrierEventIngest(await received(payload))
      await runCarrierEventIngest(await received(payload))

      const rows = (await milestonesOf(target.id)).filter((m) => m.code === 'discharged')
      expect(rows).toHaveLength(1)
    })

    /** Carriers correct their own timestamps hours later, and that must land. */
    it('accepts the carrier correcting a date it wrote itself', async () => {
      const target = await job()
      const first = await received(
        webhook('container.transport.vessel_discharged', {
          number: 'MSCU3000002',
          ref_numbers: [target.reference],
          timestamp: '2034-06-14T11:00:00Z',
        }),
      )
      await runCarrierEventIngest(first)

      const corrected = await received(
        webhook('container.transport.vessel_discharged', {
          number: 'MSCU3000002',
          ref_numbers: [target.reference],
          timestamp: '2034-06-14T16:30:00Z',
        }),
      )
      const result = await runCarrierEventIngest(corrected)

      expect(result.status).toBe('written')
      const written = await milestoneOn(target.id, 'discharged')
      expect(written?.actualAt?.toISOString()).toBe('2034-06-14T16:30:00.000Z')
    })

    /**
     * The rule the guard exists for. An operator marked this complete from a
     * phone call the carrier never made, and a feed that moved the date hours
     * later would make the board argue with the person reading it.
     */
    it('leaves a hand-entered completion exactly where the operator put it', async () => {
      const target = await job()
      const entered = new Date('2034-06-13T08:00:00Z')

      await withActor(systemActor, (tx) =>
        tx.insert(jobMilestones).values({
          jobId: target.id,
          code: 'discharged',
          nameEn: 'Discharged',
          nameAr: 'تم التفريغ',
          seq: 50,
          actualAt: entered,
          notes: 'Confirmed by phone with the terminal',
        }),
      )

      const id = await received(
        webhook('container.transport.vessel_discharged', {
          number: 'MSCU3000003',
          ref_numbers: [target.reference],
          timestamp: '2034-06-14T11:00:00Z',
        }),
      )
      const result = await runCarrierEventIngest(id)

      /*
        Reported as `preserved`, not as `written`.

        `on conflict do update … where` returns no row when the guard fails, and
        the worker reads that back — because the log is what somebody reads at
        2am when a customer asks why a discharge date moved, and reporting the
        wrong outcome is worse than reporting none.
      */
      expect(result.status).toBe('preserved')
      const written = await milestoneOn(target.id, 'discharged')
      expect(written?.actualAt?.toISOString()).toBe(entered.toISOString())
      expect(written?.notes).toBe('Confirmed by phone with the terminal')
    })

    /** A milestone a person created but left incomplete is a gap to fill. */
    it('fills a milestone a person created but never completed', async () => {
      const target = await job()

      await withActor(systemActor, (tx) =>
        tx.insert(jobMilestones).values({
          jobId: target.id,
          code: 'discharged',
          nameEn: 'Discharged',
          nameAr: 'تم التفريغ',
          seq: 50,
          actualAt: null,
          notes: 'Planned',
        }),
      )

      const id = await received(
        webhook('container.transport.vessel_discharged', {
          number: 'MSCU3000004',
          ref_numbers: [target.reference],
          timestamp: '2034-06-14T11:00:00Z',
        }),
      )
      const result = await runCarrierEventIngest(id)

      expect(result.status).toBe('written')
      expect((await milestoneOn(target.id, 'discharged'))?.actualAt).toBeInstanceOf(Date)
    })
  })
})
