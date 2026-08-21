/**
 * The notification dispatcher — the worker that fails silently by design.
 *
 * Nobody is looking at a screen when this runs, and none of its failure modes
 * throw: a notification that is never sent looks exactly like one nobody
 * needed. The file's own history is the argument for testing it — the channel
 * registry was empty at one point, so every queued notification resolved no
 * adapter and did nothing; `attempts`, `deferred_until` and `last_error` sat on
 * the table since Release One with nothing writing them, so a relay down for
 * ninety seconds lost every notification raised in that window, permanently;
 * and a recipient inside quiet hours had a delivery recorded as `queued` and
 * the outbox row marked dispatched anyway, deferring the message into a table
 * nobody read.
 *
 * All three are the same shape: a number that stays at zero, which is
 * indistinguishable from a quiet week.
 *
 * The properties below are therefore mostly about *rows reaching a terminal
 * state*, and three of them are worth naming:
 *
 * **An internal event goes to the staff of that branch and no further.** The
 * filter for this once vanished inside an `and()`, so an SLA breach in Kuwait
 * resolved its audience to every active principal in the database — Dubai
 * staff, every agent contact, every portal user of every unrelated customer.
 * A branch is a legal entity here (§5.3), not a folder.
 *
 * **Quiet hours are a customer courtesy, not a rule about staff.** Silencing
 * an internal alarm between nine at night and seven in the morning suppresses
 * it precisely during the hours nobody is watching the board.
 *
 * **A failed send is retried and eventually given up on.** Transient and
 * permanent failures are indistinguishable by the time an adapter has reduced
 * the outcome to `accepted: false`, so everything backs off and stops after
 * five attempts — a handful of pointless connections against a dead address,
 * against every notification raised during a relay restart.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import type { Actor } from '@qabandi/db'
import type { NotificationChannel } from '../ports/index'

const APP_URL = process.env.TEST_DATABASE_URL
const enabled = Boolean(APP_URL)
if (APP_URL) process.env.DATABASE_URL = APP_URL

const {
  branches,
  customerContacts,
  customers,
  notificationChannelSettings,
  notificationDeliveries,
  notificationOutbox,
  principalBranchRoles,
  principals,
  roles,
  withActor,
  workingCalendars,
} = await import('@qabandi/db')

const {
  runNotificationDispatch,
  registerChannel,
  clearChannels,
  inQuietHours,
  nextQuietHoursEnd,
  raise,
} = await import('./notification-dispatch')

/* A branch, its staff, a customer with contacts — and a second branch whose
   staff must never appear, which is the whole point of one of these tests. */
const BRANCH = '00000000-0000-7000-8000-00000000bd01'
const OTHER_BRANCH = '00000000-0000-7000-8000-00000000bd02'
const CUSTOMER = '00000000-0000-7000-8000-00000000bd03'
const STAFF = '00000000-0000-7000-8000-00000000bd04'
const OTHER_STAFF = '00000000-0000-7000-8000-00000000bd05'

const actor: Actor = { principalId: STAFF, type: 'internal', branchIds: [BRANCH, OTHER_BRANCH] }
const systemActor = { ...actor, type: 'system' as const }

const RUN = Date.now().toString(36).toUpperCase().slice(-5)
let seq = 0

/*
  Fixed addresses, not per-run ones.

  The principals and contacts carry fixed ids and are inserted with
  `onConflictDoNothing`, so the first run's address is the one that survives —
  a suffix that changes per run goes stale on the second run and every
  assertion against it fails.
*/
const STAFF_EMAIL = 'dispatch-staff@qabandi.test'
const OTHER_STAFF_EMAIL = 'dispatch-other@qabandi.test'
const CONTACT_EMAIL = 'dispatch-ops@customer.test'
const OPTED_OUT_EMAIL = 'dispatch-nothanks@customer.test'

/** Midday in Kuwait — outside quiet hours, so nothing defers by accident. */
const DAYTIME = new Date('2033-05-10T09:00:00Z')
/** Half past eleven at night in Kuwait. */
const NIGHT = new Date('2033-05-10T20:30:00Z')

/**
 * The outbox row this test just raised, found by its payload.
 *
 * `raise` returns nothing — it is written to be called inside somebody else's
 * business transaction — so the row is recovered by the reference stamped into
 * its payload, which is unique per call.
 */
async function raised(
  eventKey: string,
  over: { customerId?: string | null; branchId?: string } = {},
): Promise<string> {
  seq += 1
  const reference = `ND-${RUN}-${seq}`
  return withActor(systemActor, async (tx) => {
    await raise(tx, {
      branchId: over.branchId ?? BRANCH,
      eventKey,
      customerId: over.customerId ?? null,
      payload: { reference, total: '100.000', currency: 'KWD' },
    })
    const rows = await tx
      .select({ id: notificationOutbox.id, payload: notificationOutbox.payload })
      .from(notificationOutbox)
      .where(eq(notificationOutbox.eventKey, eventKey))
    const found = rows.find(
      (row: { payload: Record<string, unknown> }) => row.payload?.reference === reference,
    )
    return (found as { id: string }).id
  })
}

/**
 * Run the sending pass without expanding anything.
 *
 * `runNotificationDispatch` always does both passes, and calling it with no
 * `outboxId` expands *every* undispatched row in the deployment — which is
 * hundreds, raised by the web suites, and nothing to do with this file. A
 * customer event naming no customer expands to nothing, so it is a no-op first
 * pass and a real second one.
 */
const flushOnly = async (asOf: Date) => {
  const inert = await raised('invoice.issued', { customerId: null })
  return runNotificationDispatch({ outboxId: inert }, asOf)
}

const deliveriesFor = (outboxId: string) =>
  withActor(actor, (tx) =>
    tx.select().from(notificationDeliveries).where(eq(notificationDeliveries.outboxId, outboxId)),
  )

const outboxRow = async (outboxId: string) => {
  const [row] = await withActor(actor, (tx) =>
    tx.select().from(notificationOutbox).where(eq(notificationOutbox.id, outboxId)),
  )
  return row!
}

/** A channel that records what it was asked to send, and answers as told. */
function fakeChannel(behaviour: {
  accepted: boolean
  externalRef?: string
  error?: string
}): NotificationChannel & { sent: { to: string; subject?: string; body: string }[] } {
  const sent: { to: string; subject?: string; body: string }[] = []
  return {
    key: 'email',
    sent,
    async send(message) {
      sent.push({ to: message.to, subject: message.subject, body: message.body })
      return behaviour.accepted
        ? { accepted: true, externalRef: behaviour.externalRef ?? 'ref-1' }
        : { accepted: false, error: behaviour.error ?? 'relay refused' }
    },
  }
}

describe.skipIf(!enabled)('the notification dispatcher', () => {
  beforeAll(async () => {
    /*
      Terminate anything left queued by an earlier run.

      `flush` claims the fifty oldest due deliveries in the deployment, so rows
      abandoned by a crashed run sit at the front of that queue for ever and
      this file's own rows never get claimed. They are already garbage; the
      only thing that makes them harmful is being due.
    */
    await withActor(systemActor, (tx) =>
      tx
        .update(notificationDeliveries)
        .set({ status: 'failed', failedAt: new Date(), deferredUntil: null })
        .where(eq(notificationDeliveries.status, 'queued')),
    )

    await withActor(systemActor, async (tx) => {
      const [calendar] = await tx
        .select({ id: workingCalendars.id })
        .from(workingCalendars)
        .where(eq(workingCalendars.key, 'kuwait'))
        .limit(1)
      const [role] = await tx
        .select({ id: roles.id })
        .from(roles)
        .where(eq(roles.key, 'coordinator'))
        .limit(1)
      if (!calendar || !role) throw new Error('Run `pnpm db:seed` before this suite')

      await tx
        .insert(principals)
        .values([
          {
            id: STAFF,
            type: 'internal',
            email: STAFF_EMAIL,
            nameEn: 'Kuwait Coordinator',
            nameAr: 'منسق الكويت',
            locale: 'en',
          },
          {
            id: OTHER_STAFF,
            type: 'internal',
            email: OTHER_STAFF_EMAIL,
            nameEn: 'Dubai Coordinator',
            locale: 'en',
          },
        ])
        .onConflictDoNothing()

      /*
        Stated, not merely inserted.

        `onConflictDoNothing` leaves whatever the first run wrote, so a fixture
        whose address changed is never corrected — these rows are identified by
        id and the address is the thing under test.
      */
      await tx.update(principals).set({ email: STAFF_EMAIL }).where(eq(principals.id, STAFF))
      await tx
        .update(principals)
        .set({ email: OTHER_STAFF_EMAIL })
        .where(eq(principals.id, OTHER_STAFF))

      for (const [id, code, name, zone] of [
        [BRANCH, 'NDK', 'Dispatch Kuwait', 'Asia/Kuwait'],
        [OTHER_BRANCH, 'NDD', 'Dispatch Dubai', 'Asia/Dubai'],
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
            timeZone: zone,
          })
          .onConflictDoNothing()
      }

      await tx
        .insert(principalBranchRoles)
        .values([
          { principalId: STAFF, branchId: BRANCH, roleId: role.id },
          { principalId: OTHER_STAFF, branchId: OTHER_BRANCH, roleId: role.id },
        ])
        .onConflictDoNothing()

      await tx
        .insert(customers)
        .values({
          id: CUSTOMER,
          code: 'CUST-DISPATCH',
          legalNameEn: 'Dispatch Fixture Customer',
          primaryBranchId: BRANCH,
        })
        .onConflictDoNothing()

      await tx
        .insert(customerContacts)
        .values([
          {
            customerId: CUSTOMER,
            nameEn: 'Mariam Al-Sayegh',
            nameAr: 'مريم الصايغ',
            email: CONTACT_EMAIL,
            isPrimary: true,
          },
          {
            customerId: CUSTOMER,
            nameEn: 'Opted Out',
            email: OPTED_OUT_EMAIL,
            notificationOptOuts: ['invoice.issued'],
          },
        ])
        .onConflictDoNothing()
    })
  })

  afterEach(() => {
    clearChannels()
  })

  afterAll(async () => {
    clearChannels()
    if (!enabled) return
    /*
      Nothing this file queued may be left due.

      `flush` claims every due delivery in the deployment, not just this
      suite's — so a row left `queued` is picked up by the next run of any test
      that flushes, and counted there. Terminating them keeps the suites
      independent.
    */
    await withActor(systemActor, (tx) =>
      tx
        .update(notificationDeliveries)
        .set({ status: 'failed', failedAt: new Date(), deferredUntil: null })
        .where(eq(notificationDeliveries.status, 'queued')),
    )
  })

  describe('quiet hours', () => {
    it('is quiet late at night and awake in the afternoon', () => {
      expect(inQuietHours(NIGHT, 'Asia/Kuwait')).toBe(true)
      expect(inQuietHours(DAYTIME, 'Asia/Kuwait')).toBe(false)
    })

    it('is quiet in the small hours too, not only after nine', () => {
      // 02:00 in Kuwait.
      expect(inQuietHours(new Date('2033-05-10T23:00:00Z'), 'Asia/Kuwait')).toBe(true)
    })

    /** The same instant is a different hour in Dubai — the zone is the branch's. */
    it('reads the hour in the branch’s own zone', () => {
      const instant = new Date('2033-05-10T18:30:00Z')
      expect(inQuietHours(instant, 'Asia/Kuwait')).toBe(true)
      expect(inQuietHours(instant, 'Europe/London')).toBe(false)
    })

    /*
      The window is the branch's now, not the deployment's — FR-NT-07.

      It was two constants in this file, which made "we do not write to
      customers between nine at night and seven in the morning" a fact about
      the installation. It is an office fact: everything else about the window
      was already per-branch, because the comparison is made in the branch's
      own `time_zone` — the two numbers were the only part that was not.
    */
    it('keeps the window the branch was given', () => {
      // 18:30Z is 21:30 in Kuwait: inside the default window, outside a
      // branch that goes quiet at 23:00.
      const instant = new Date('2033-05-10T18:30:00Z')

      expect(inQuietHours(instant, 'Asia/Kuwait', { enabled: true, from: 23, to: 7 })).toBe(false)
      expect(inQuietHours(instant, 'Asia/Kuwait', { enabled: true, from: 21, to: 7 })).toBe(true)
    })

    /**
     * A window that does not wrap midnight is a real setting — a branch with a
     * short maintenance quiet period — and reading it as though it wrapped
     * would silence the entire working day instead.
     */
    it('reads a window inside one day as inside one day', () => {
      const oneAm = new Date('2033-05-10T22:00:00Z') // 01:00 in Kuwait
      const noon = new Date('2033-05-10T09:00:00Z') // 12:00 in Kuwait

      expect(inQuietHours(oneAm, 'Asia/Kuwait', { enabled: true, from: 1, to: 6 })).toBe(true)
      expect(inQuietHours(noon, 'Asia/Kuwait', { enabled: true, from: 1, to: 6 })).toBe(false)
    })

    /** Switched off means send at any hour, not send at no hour. */
    it('holds nothing when the branch has quiet hours turned off', () => {
      expect(inQuietHours(NIGHT, 'Asia/Kuwait', { enabled: false, from: 21, to: 7 })).toBe(false)
      expect(inQuietHours(DAYTIME, 'Asia/Kuwait', { enabled: false, from: 21, to: 7 })).toBe(false)
    })

    it('lifts the silence at the hour the branch chose', () => {
      const end = nextQuietHoursEnd(NIGHT, 'Asia/Kuwait', { enabled: true, from: 21, to: 5 })
      expect(
        new Intl.DateTimeFormat('en-GB', {
          timeZone: 'Asia/Kuwait',
          hour: '2-digit',
          hour12: false,
        }).format(end),
      ).toBe('05')
    })

    /**
     * Stepped forward an hour at a time rather than by constructing a local
     * midnight, because the alternative needs an offset — and an offset is the
     * thing that is wrong twice a year in Türkiye and Morocco, on the same
     * trade lanes.
     */
    it('lifts at seven in the morning, local', () => {
      const end = nextQuietHoursEnd(NIGHT, 'Asia/Kuwait')

      expect(end.getTime()).toBeGreaterThan(NIGHT.getTime())
      const local = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Kuwait',
        hour: '2-digit',
        hour12: false,
      }).format(end)
      expect(Number(local)).toBe(7)
    })

    it('lifts the same morning for a zone that keeps daylight saving', () => {
      const end = nextQuietHoursEnd(new Date('2033-07-10T21:00:00Z'), 'Europe/Istanbul')
      const local = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Europe/Istanbul',
        hour: '2-digit',
        hour12: false,
      }).format(end)
      expect(Number(local)).toBe(7)
    })
  })

  /**
   * The send switches — FR-NT-03.
   *
   * These write to `notification_channel_settings`, which is *global*: it has
   * no branch, no run prefix and nothing to scope it to this file. A test that
   * left the master switch off would silence every test beneath it, and — since
   * this suite runs against a real database — would silence the deployment that
   * database belongs to until somebody noticed. So each test restores exactly
   * the keys it touched, and restoring means writing `true` rather than
   * deleting: `app_user` holds no DELETE on any table (§5.5).
   */
  describe('whether an event sends at all', () => {
    const setSwitch = (eventKey: string | null, isEnabled: boolean) =>
      withActor(systemActor, (tx) =>
        tx
          .insert(notificationChannelSettings)
          .values({ eventKey, channel: 'email' as const, isEnabled })
          .onConflictDoUpdate({
            target: [notificationChannelSettings.eventKey, notificationChannelSettings.channel],
            set: { isEnabled },
          }),
      )

    const touched: (string | null)[] = []

    const off = async (eventKey: string | null) => {
      touched.push(eventKey)
      await setSwitch(eventKey, false)
    }

    afterEach(async () => {
      // Restored in a loop rather than by a blanket update, so a bug here
      // cannot switch on something the deployment had deliberately switched
      // off.
      while (touched.length > 0) await setSwitch(touched.pop()!, true)
    })

    /*
      An adapter is registered for the two "it still sends" tests, and that is
      not incidental. `runNotificationDispatch` expands *and* flushes, so a
      delivery left to itself with no adapter is immediately marked
      `failed: no adapter` — never `queued`. Asserting on a queued row would
      therefore fail for a reason that has nothing to do with the switch, and
      asserting merely that a row exists would pass even if the switch had
      wrongly suppressed it. Sending for real is the assertion that separates
      "the switch let it through" from every other outcome.
    */
    it('sends when nothing is switched off, because absence means on', async () => {
      const channel = fakeChannel({ accepted: true })
      registerChannel(channel)

      const id = await raised('enquiry.sla_breached')
      const result = await runNotificationDispatch({ outboxId: id }, DAYTIME)

      expect(result.expanded).toBeGreaterThan(0)
      expect(result.sent).toBeGreaterThan(0)
      const rows = await deliveriesFor(id)
      expect(rows.some((d) => d.status === 'sent')).toBe(true)
      expect(rows.some((d) => d.status === 'suppressed')).toBe(false)
    })

    it('records a switched-off event as suppressed rather than dropping it', async () => {
      await off('enquiry.sla_breached')
      const id = await raised('enquiry.sla_breached')

      const result = await runNotificationDispatch({ outboxId: id }, DAYTIME)

      const rows = await deliveriesFor(id)
      expect(result.suppressed).toBeGreaterThan(0)
      expect(rows.length).toBeGreaterThan(0)
      expect(rows.every((d) => d.status === 'suppressed')).toBe(true)
      // The reason has to name the event, because the person reading the
      // delivery log is deciding which screen to go and fix.
      expect(rows[0]?.suppressedReason).toContain('enquiry.sla_breached')
    })

    it('leaves other events alone when one is switched off', async () => {
      registerChannel(fakeChannel({ accepted: true }))
      await off('enquiry.sla_breached')

      const id = await raised('exception.opened')
      await runNotificationDispatch({ outboxId: id }, DAYTIME)

      const rows = await deliveriesFor(id)
      expect(rows.some((d) => d.status === 'sent')).toBe(true)
      expect(rows.some((d) => d.status === 'suppressed')).toBe(false)
    })

    it('lets the master switch silence an event whose own switch is on', async () => {
      // Explicitly on, so this proves precedence rather than absence.
      touched.push('exception.opened')
      await setSwitch('exception.opened', true)
      await off(null)

      const id = await raised('exception.opened')
      await runNotificationDispatch({ outboxId: id }, DAYTIME)

      const rows = await deliveriesFor(id)
      expect(rows.length).toBeGreaterThan(0)
      expect(rows.every((d) => d.status === 'suppressed')).toBe(true)
      // Names the channel, not the event — the master is what stopped it.
      expect(rows[0]?.suppressedReason).toContain('email')
      expect(rows[0]?.suppressedReason).not.toContain('exception.opened')
    })

    /** Marked dispatched, so a silenced event is not re-read for ever. */
    it('clears the outbox row even when nothing is sent', async () => {
      await off('exception.opened')
      const id = await raised('exception.opened')

      await runNotificationDispatch({ outboxId: id }, DAYTIME)

      expect((await outboxRow(id)).dispatchedAt).not.toBeNull()
    })
  })

  describe('expanding an event into deliveries', () => {
    /**
     * The branch narrowing, which once vanished inside an `and()` — an SLA
     * breach in Kuwait then resolved its audience to every active principal in
     * the database.
     */
    it('reaches the staff of the event’s branch and nobody else’s', async () => {
      const id = await raised('enquiry.sla_breached')

      const result = await runNotificationDispatch({ outboxId: id }, DAYTIME)

      expect(result.expanded).toBeGreaterThan(0)
      const addresses = (await deliveriesFor(id)).map((d) => d.toAddress)
      expect(addresses).toContain(STAFF_EMAIL)
      expect(addresses).not.toContain(OTHER_STAFF_EMAIL)
    })

    it('reaches the customer’s contacts for a customer event', async () => {
      const id = await raised('invoice.issued', { customerId: CUSTOMER })

      await runNotificationDispatch({ outboxId: id }, DAYTIME)

      const addresses = (await deliveriesFor(id)).map((d) => d.toAddress)
      expect(addresses).toContain(CONTACT_EMAIL)
      // Staff are not on a customer event.
      expect(addresses).not.toContain(STAFF_EMAIL)
    })

    /** FR-NT-04 — recorded as suppressed, so the opt-out is auditable. */
    it('records an opted-out contact as suppressed rather than skipping them', async () => {
      const id = await raised('invoice.issued', { customerId: CUSTOMER })

      const result = await runNotificationDispatch({ outboxId: id }, DAYTIME)

      const suppressed = (await deliveriesFor(id)).filter((d) => d.status === 'suppressed')
      expect(result.suppressed).toBeGreaterThan(0)
      expect(suppressed.map((d) => d.toAddress)).toContain(OPTED_OUT_EMAIL)
      expect(suppressed[0]?.suppressedReason).toBe('opted out')
    })

    it('writes nothing for a customer event that names no customer', async () => {
      const id = await raised('invoice.issued', { customerId: null })

      const result = await runNotificationDispatch({ outboxId: id }, DAYTIME)

      expect(result.expanded).toBe(0)
      expect(await deliveriesFor(id)).toEqual([])
      // Still cleared, so it is not re-read for the life of the deployment.
      expect((await outboxRow(id)).dispatchedAt).not.toBeNull()
    })

    /**
     * Marked dispatched rather than left pending: a row that can never be
     * expanded and is never cleared is re-read on every run, for ever.
     */
    it('clears an event key nothing declares, and says so', async () => {
      const complaint = vi.spyOn(console, 'error').mockImplementation(() => {})
      try {
        const id = await raised('job.abducted_by_pirates')

        const result = await runNotificationDispatch({ outboxId: id }, DAYTIME)

        expect(result.expanded).toBe(0)
        expect(await deliveriesFor(id)).toEqual([])
        expect((await outboxRow(id)).dispatchedAt).not.toBeNull()
        expect(complaint).toHaveBeenCalledWith(
          expect.stringContaining('job.abducted_by_pirates'),
        )
      } finally {
        complaint.mockRestore()
      }
    })

    it('marks the outbox row dispatched once it has expanded it', async () => {
      const id = await raised('enquiry.created')
      expect((await outboxRow(id)).dispatchedAt).toBeNull()

      await runNotificationDispatch({ outboxId: id }, DAYTIME)

      expect((await outboxRow(id)).dispatchedAt).not.toBeNull()
    })

    /**
     * Deferred, not dropped — FR-NT-07. The earlier shape recorded the
     * delivery `queued`, marked the outbox dispatched, and left nothing that
     * would ever look at it again.
     */
    it('defers a customer notice raised inside quiet hours', async () => {
      const id = await raised('invoice.issued', { customerId: CUSTOMER })

      await runNotificationDispatch({ outboxId: id }, NIGHT)

      const queued = (await deliveriesFor(id)).filter((d) => d.status === 'queued')
      expect(queued.length).toBeGreaterThan(0)
      expect(queued[0]?.deferredUntil).toBeInstanceOf(Date)
      expect(queued[0]!.deferredUntil!.getTime()).toBeGreaterThan(NIGHT.getTime())
    })

    /** Silencing the alarm during the hours nobody is watching inverts it. */
    it('never defers an internal alarm, whatever the hour', async () => {
      const channel = fakeChannel({ accepted: true })
      registerChannel(channel)

      const id = await raised('enquiry.sla_breached')
      await runNotificationDispatch({ outboxId: id }, NIGHT)

      const rows = await deliveriesFor(id)
      expect(rows.length).toBeGreaterThan(0)
      expect(rows.every((d) => d.status === 'sent')).toBe(true)
    })
  })

  describe('sending', () => {
    it('sends through the registered adapter and records the reference', async () => {
      const channel = fakeChannel({ accepted: true, externalRef: 'smtp-9931' })
      registerChannel(channel)

      const id = await raised('enquiry.created')
      await runNotificationDispatch({ outboxId: id }, DAYTIME)

      const [row] = await deliveriesFor(id)
      expect(row?.status).toBe('sent')
      expect(row?.sentAt).toBeInstanceOf(Date)
      expect(row?.externalRef).toBe('smtp-9931')
      expect(channel.sent[0]?.to).toBe(STAFF_EMAIL)
    })

    /** The payload's fields reach the template, or the message says `{{...}}`. */
    it('renders the event’s payload into the message', async () => {
      const channel = fakeChannel({ accepted: true })
      registerChannel(channel)

      const id = await raised('enquiry.created')
      await runNotificationDispatch({ outboxId: id }, DAYTIME)

      const body = channel.sent[0]?.body ?? ''
      expect(body).toContain(`ND-${RUN}-`)
      expect(body).not.toContain('{{')
    })

    /**
     * The registry was empty once and every notification quietly resolved
     * nothing. A `failed` row with the reason on it is the difference between
     * a bug somebody finds and a bug nobody can see.
     */
    it('records a failure naming the channel when no adapter is registered', async () => {
      const id = await raised('enquiry.created')

      await runNotificationDispatch({ outboxId: id }, DAYTIME)

      const [row] = await deliveriesFor(id)
      expect(row?.status).toBe('failed')
      expect(row?.lastError).toContain('no adapter registered')
      expect(row?.failedAt).toBeInstanceOf(Date)
    })

    /**
     * A channel with no wording behind it.
     *
     * Only email templates are seeded, so registering WhatsApp is the honest
     * way to reach this branch: adding a channel is one registry entry and a
     * column value, and the failure that follows is somebody having done the
     * first half and not the second. The row names which template is missing,
     * which is the whole difference between a fixable configuration gap and a
     * channel that silently sends nothing.
     */
    it('records which template was missing when a channel has none', async () => {
      registerChannel({
        key: 'whatsapp',
        send: async () => ({ accepted: true }),
      })

      const id = await raised('enquiry.created')
      await runNotificationDispatch({ outboxId: id }, DAYTIME)

      const [row] = await deliveriesFor(id)
      expect(row?.status).toBe('failed')
      expect(row?.lastError).toContain('whatsapp')
      expect(row?.lastError).toContain('enquiry.created')
      expect(row?.failedAt).toBeInstanceOf(Date)
    })
  })

  describe('retrying — FR-NT-06', () => {
    /**
     * A relay down for ninety seconds used to lose every notification raised
     * in that window, permanently. The row now stays queued, carries the
     * reason, and comes back later.
     */
    it('keeps a refused send queued, with the reason and a wait', async () => {
      registerChannel(fakeChannel({ accepted: false, error: 'relay refused: 421' }))

      const id = await raised('enquiry.created')
      await runNotificationDispatch({ outboxId: id }, DAYTIME)

      const [row] = await deliveriesFor(id)
      expect(row?.status).toBe('queued')
      expect(row?.lastError).toContain('421')
      expect(row?.attempts).toBe(1)
      expect(row!.deferredUntil!.getTime()).toBeGreaterThan(DAYTIME.getTime())
    })

    /** Widening, so a dead address costs a handful of connections and no more. */
    it('waits longer after each refusal', async () => {
      registerChannel(fakeChannel({ accepted: false }))

      const id = await raised('enquiry.created')
      await runNotificationDispatch({ outboxId: id }, DAYTIME)
      const first = (await deliveriesFor(id))[0]!

      // Due again, so the next run claims it rather than skipping it.
      const later = new Date(first.deferredUntil!.getTime() + 1000)
      await flushOnly(later)
      const second = (await deliveriesFor(id))[0]!

      expect(second.attempts).toBe(2)
      const firstWait = first.deferredUntil!.getTime() - DAYTIME.getTime()
      const secondWait = second.deferredUntil!.getTime() - later.getTime()
      expect(secondWait).toBeGreaterThan(firstWait)
    })

    /** A row that is not due yet is left alone — that is also the lease. */
    it('leaves a delivery alone until its wait is over', async () => {
      registerChannel(fakeChannel({ accepted: false }))

      const id = await raised('enquiry.created')
      await runNotificationDispatch({ outboxId: id }, DAYTIME)
      const before = (await deliveriesFor(id))[0]!

      await flushOnly(new Date(DAYTIME.getTime() + 1000))

      const after = (await deliveriesFor(id))[0]!
      expect(after.attempts).toBe(before.attempts)
    })

    it('gives up after five attempts and stops costing anything', async () => {
      registerChannel(fakeChannel({ accepted: false, error: 'no such mailbox' }))

      const id = await raised('enquiry.created')
      await runNotificationDispatch({ outboxId: id }, DAYTIME)

      // Wind it to the last attempt rather than waiting out four backoffs.
      await withActor(systemActor, (tx) =>
        tx
          .update(notificationDeliveries)
          .set({ attempts: 4, deferredUntil: null })
          .where(eq(notificationDeliveries.outboxId, id)),
      )
      await flushOnly(DAYTIME)

      const [row] = await deliveriesFor(id)
      expect(row?.status).toBe('failed')
      expect(row?.attempts).toBe(5)
      expect(row?.lastError).toContain('no such mailbox')
      expect(row?.deferredUntil).toBeNull()
    })

    /**
     * At-least-once, deliberately. A crash mid-send leaves the lease to expire
     * and the row is picked up again — a duplicate arrival notice is a minor
     * annoyance, a missing one is a customer who did not collect their
     * container before free time expired.
     */
    it('claims a batch by pushing it out of the way rather than locking it', async () => {
      registerChannel(fakeChannel({ accepted: false }))

      const id = await raised('enquiry.created')
      await runNotificationDispatch({ outboxId: id }, DAYTIME)

      const [row] = await deliveriesFor(id)
      // Still queued and still owned by nobody — only its due time moved.
      expect(row?.status).toBe('queued')
      expect(row?.deferredUntil).toBeInstanceOf(Date)
    })
  })
})
