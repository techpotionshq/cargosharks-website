/**
 * The notification dispatcher — Architecture §7.4, FR-NT-01…07.
 *
 * Eleven events across three channels in two languages is not sixty-six
 * handlers. It is this one file plus template rows:
 *
 *   outbox row -> resolve recipients (audience + opt-outs)
 *              -> resolve template (event × channel × language × branch)
 *              -> delivery row
 *              -> adapter.send() -> delivery outcome
 *
 * ## Why that is two passes and not one
 *
 * The original ran the whole chain inside a single transaction and marked the
 * outbox row dispatched at the end of it. Three things were wrong with that,
 * and all three were invisible until something actually sent mail:
 *
 * 1. **Quiet hours lost the message.** A recipient inside quiet hours had a
 *    delivery recorded as `queued`, and then the outbox row was marked
 *    dispatched anyway — so nothing ever looked at it again. FR-NT-07 says
 *    events during quiet hours are *deferred*; this deferred them into a
 *    table nobody read.
 *
 * 2. **There was no retry.** FR-NT-06 requires that a failed send be retried
 *    rather than silently lost, and `attempts`, `deferred_until`, `last_error`
 *    and `failed_at` had all been on `notification_deliveries` since Release
 *    One with nothing writing them. A relay that was down for ninety seconds
 *    lost every notification raised in that window, permanently.
 *
 * 3. **An SMTP conversation ran inside a database transaction.** The mail
 *    timeout is twenty seconds. Holding a Postgres transaction open across a
 *    third party's network path is how a slow relay becomes a database
 *    incident.
 *
 * So: **expand**, in a transaction, turns one event into delivery rows and is
 * the only thing that touches the outbox. **flush**, outside any transaction,
 * sends whatever is due. The delivery row is the unit of work, which is what
 * its columns were always shaped for.
 *
 * ## Claiming, and why at-least-once is the right answer
 *
 * `flush` claims a batch by pushing `deferred_until` into the future inside a
 * short transaction, then sends outside it. If the process dies mid-send, the
 * lease expires and the row is picked up again — so a crash at the worst
 * possible moment can send one message twice. That is the correct trade for
 * email: a duplicate arrival notice is a minor annoyance, and a missing one is
 * a customer who did not collect their container before free time expired.
 */

import { and, asc, eq, inArray, isNull, lte, or, sql } from 'drizzle-orm'
import {
  branches,
  customerContacts,
  notificationDeliveries,
  notificationOutbox,
  notificationTemplates,
  principalBranchRoles,
  principals,
  systemActor,
  withActor,
} from '@qabandi/db'
import { notificationEvent, renderTemplate } from '@qabandi/core'
import type { NotificationChannel } from '../ports/index'

/** Registered adapters. Adding a channel is one entry and a column value. */
const channels = new Map<string, NotificationChannel>()

export function registerChannel(channel: NotificationChannel): void {
  channels.set(channel.key, channel)
}

/** Test seam — the registry is process-global, so a test must be able to clear it. */
export function clearChannels(): void {
  channels.clear()
}

/** Quiet hours in the *branch's* local time — no outbound between these. */
const QUIET_FROM_HOUR = 21
const QUIET_TO_HOUR = 7

/** How long a claimed delivery stays claimed before another run may retry it. */
const LEASE_MS = 5 * 60_000

/** After this many tries a delivery is `failed` and stops costing anything. */
const MAX_ATTEMPTS = 5

const BASE_BACKOFF_MS = 5 * 60_000
const MAX_BACKOFF_MS = 6 * 60 * 60_000

export interface DispatchResult {
  readonly expanded: number
  readonly sent: number
  readonly failed: number
  readonly deferred: number
  readonly suppressed: number
}

export async function runNotificationDispatch(
  data: Record<string, unknown>,
  asOf = new Date(),
): Promise<DispatchResult> {
  const outboxId = typeof data.outboxId === 'string' ? data.outboxId : null
  const { expanded, suppressed } = await expand(outboxId, asOf)
  const { sent, failed, deferred } = await flush(asOf)
  return { expanded, sent, failed, deferred, suppressed }
}

// --- pass one: event -> delivery rows ---------------------------------------

interface Recipient {
  readonly principalId: string | null
  readonly email: string
  readonly name: string
  readonly locale: 'en' | 'ar'
  readonly optOuts: readonly string[]
}

async function expand(
  outboxId: string | null,
  asOf: Date,
): Promise<{ expanded: number; suppressed: number }> {
  return withActor(systemActor(), async (tx) => {
    const pending = await tx
      .select({
        id: notificationOutbox.id,
        branchId: notificationOutbox.branchId,
        eventKey: notificationOutbox.eventKey,
        customerId: notificationOutbox.customerId,
        payload: notificationOutbox.payload,
        timeZone: branches.timeZone,
      })
      .from(notificationOutbox)
      .innerJoin(branches, eq(branches.id, notificationOutbox.branchId))
      .where(
        outboxId ? eq(notificationOutbox.id, outboxId) : isNull(notificationOutbox.dispatchedAt),
      )
      .orderBy(asc(notificationOutbox.createdAt))
      .limit(100)

    let expanded = 0
    let suppressed = 0

    for (const event of pending) {
      const declared = notificationEvent(event.eventKey)

      /*
        An event key nothing declares.

        Marked dispatched rather than left pending, because a row that cannot
        ever be expanded and is never cleared is re-read on every run for the
        life of the deployment. It is logged at error level with the key, which
        is the actual fix: add it to `NOTIFICATION_EVENTS`.
      */
      if (!declared) {
        console.error(
          `notification: no such event "${event.eventKey}" — ` +
            'declare it in packages/core/src/notifications.ts',
        )
        await markDispatched(tx, event.id, asOf)
        continue
      }

      const recipients =
        declared.audience === 'customer'
          ? await customerRecipients(tx, event.customerId)
          : await internalRecipients(tx, event.branchId)

      /*
        Quiet hours are a customer courtesy, not a rule about staff.

        FR-NT-07 exists so a busy shipment does not wake a customer at 3am with
        six milestone notices. Applying the same silence to an internal SLA
        breach would suppress the alarm precisely during the hours nobody is
        watching the board — which inverts what the alarm is for.
      */
      const defer =
        declared.audience === 'customer' && inQuietHours(asOf, event.timeZone)
          ? nextQuietHoursEnd(asOf, event.timeZone)
          : null

      // Registered channels, so a deployment with no adapter records the fact
      // rather than dropping the event with no trace of it at all.
      const targets = channels.size > 0 ? [...channels.keys()] : ['email']

      for (const recipient of recipients) {
        if (recipient.optOuts.includes(event.eventKey)) {
          await tx.insert(notificationDeliveries).values({
            outboxId: event.id,
            principalId: recipient.principalId,
            channel: 'email' as const,
            locale: recipient.locale,
            toAddress: recipient.email,
            status: 'suppressed' as const,
            suppressedReason: 'opted out',
          })
          suppressed++
          continue
        }

        for (const channel of targets) {
          const template = await resolveTemplate(
            tx,
            event.eventKey,
            channel,
            recipient.locale,
            event.branchId,
          )

          if (!template) {
            await tx.insert(notificationDeliveries).values({
              outboxId: event.id,
              principalId: recipient.principalId,
              channel: channel as 'email',
              locale: recipient.locale,
              toAddress: recipient.email,
              status: 'failed' as const,
              lastError: `no ${recipient.locale} ${channel} template for ${event.eventKey}`,
              failedAt: asOf,
            })
            continue
          }

          await tx.insert(notificationDeliveries).values({
            outboxId: event.id,
            principalId: recipient.principalId,
            channel: channel as 'email',
            locale: recipient.locale,
            toAddress: recipient.email,
            templateId: template.id,
            status: 'queued' as const,
            deferredUntil: defer,
          })
          expanded++
        }
      }

      await markDispatched(tx, event.id, asOf)
    }

    return { expanded, suppressed }
  })
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function markDispatched(tx: any, id: string, asOf: Date): Promise<void> {
  await tx.update(notificationOutbox).set({ dispatchedAt: asOf }).where(eq(notificationOutbox.id, id))
}

/**
 * The customer's contacts, not the customer's portal users.
 *
 * These are different populations and the difference matters: a customer's
 * operations coordinator is who needs the arrival notice, and they are
 * routinely not a portal login. `customer_contacts` is also where FR-NT-04's
 * opt-outs live, which is the second reason this reads from there.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function customerRecipients(tx: any, customerId: string | null): Promise<Recipient[]> {
  if (!customerId) return []

  const rows = await tx
    .select({
      principalId: customerContacts.principalId,
      contactEmail: customerContacts.email,
      nameEn: customerContacts.nameEn,
      nameAr: customerContacts.nameAr,
      principalEmail: principals.email,
      locale: principals.locale,
      optOuts: customerContacts.notificationOptOuts,
    })
    .from(customerContacts)
    .leftJoin(principals, eq(principals.id, customerContacts.principalId))
    .where(and(eq(customerContacts.customerId, customerId), eq(customerContacts.isActive, true)))

  return rows
    .map((row: Record<string, unknown>) => {
      // A contact who has never been invited to the portal has no principal and
      // therefore no stated language preference. English is the fallback, and
      // an administrator changes it by inviting them.
      const locale = ((row.locale as 'en' | 'ar' | null) ?? 'en') as 'en' | 'ar'
      return {
        principalId: (row.principalId as string | null) ?? null,
        email: ((row.contactEmail as string | null) ?? (row.principalEmail as string | null)) ?? '',
        name:
          (locale === 'ar' ? (row.nameAr as string | null) : null) ?? (row.nameEn as string) ?? '',
        locale,
        optOuts: (row.optOuts as string[] | null) ?? [],
      }
    })
    .filter((r: Recipient) => r.email.length > 0)
}

/**
 * Internal staff *of the event's branch*.
 *
 * The branch narrowing is the point. Before this, an event that named no
 * customer resolved its audience to every active principal in the database —
 * the `undefined` filter simply vanished inside `and()` — so an SLA breach in
 * Kuwait would have emailed Dubai staff, every agent contact, and every portal
 * user of every unrelated customer. A branch is a legal entity here (§5.3),
 * not a folder.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function internalRecipients(tx: any, branchId: string): Promise<Recipient[]> {
  const rows = await tx
    .selectDistinct({
      principalId: principals.id,
      email: principals.email,
      nameEn: principals.nameEn,
      nameAr: principals.nameAr,
      locale: principals.locale,
    })
    .from(principals)
    .innerJoin(principalBranchRoles, eq(principalBranchRoles.principalId, principals.id))
    .where(
      and(
        eq(principals.type, 'internal'),
        eq(principals.isActive, true),
        eq(principalBranchRoles.branchId, branchId),
        eq(principalBranchRoles.isActive, true),
      ),
    )

  return rows.map((row: Record<string, unknown>) => {
    const locale = row.locale as 'en' | 'ar'
    return {
      principalId: row.principalId as string,
      email: row.email as string,
      name: (locale === 'ar' ? (row.nameAr as string | null) : null) ?? (row.nameEn as string),
      locale,
      // Staff do not opt out of operational alarms; FR-NT-04's opt-outs are a
      // customer preference and live on `customer_contacts`.
      optOuts: [],
    }
  })
}

/**
 * Branch override first, default second.
 *
 * Both candidates are read and the choice made here rather than in an
 * `order by`, because "NULLs sort last in an ascending order" is true and
 * completely unreadable as an expression of "a branch's own wording wins".
 */
async function resolveTemplate(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx: any,
  eventKey: string,
  channel: string,
  locale: 'en' | 'ar',
  branchId: string,
): Promise<{ id: string; subject: string | null; body: string } | undefined> {
  const rows = await tx
    .select({
      id: notificationTemplates.id,
      subject: notificationTemplates.subject,
      body: notificationTemplates.body,
      branchId: notificationTemplates.branchId,
    })
    .from(notificationTemplates)
    .where(
      and(
        eq(notificationTemplates.eventKey, eventKey),
        eq(notificationTemplates.channel, channel as 'email'),
        eq(notificationTemplates.locale, locale),
        eq(notificationTemplates.isActive, true),
        or(eq(notificationTemplates.branchId, branchId), isNull(notificationTemplates.branchId)),
      ),
    )

  return (
    rows.find((r: { branchId: string | null }) => r.branchId === branchId) ??
    rows.find((r: { branchId: string | null }) => r.branchId === null)
  )
}

// --- pass two: delivery rows -> sent -----------------------------------------

async function flush(asOf: Date): Promise<{ sent: number; failed: number; deferred: number }> {
  const claimed = await claim(asOf)

  let sent = 0
  let failed = 0
  let deferred = 0

  for (const delivery of claimed) {
    const adapter = channels.get(delivery.channel)

    if (!adapter) {
      await finish(delivery.id, {
        status: 'failed',
        lastError: `no adapter registered for channel "${delivery.channel}"`,
        failedAt: asOf,
      })
      failed++
      continue
    }

    const arabic = delivery.locale === 'ar'
    const merged = {
      ...delivery.payload,
      recipientName: (arabic ? delivery.recipientNameAr : null) ?? delivery.recipientNameEn ?? '',
      senderName: arabic ? delivery.senderNameAr : delivery.senderNameEn,
    }

    const result = await adapter.send({
      to: delivery.toAddress,
      subject: renderTemplate(delivery.subject ?? '', merged),
      body: renderTemplate(delivery.body, merged),
      locale: delivery.locale,
    })

    if (result.accepted) {
      await finish(delivery.id, {
        status: 'sent',
        sentAt: asOf,
        externalRef: result.externalRef ?? null,
        lastError: null,
        deferredUntil: null,
      })
      sent++
      continue
    }

    /*
      A transient failure and a permanent one look the same from here.

      SMTP does distinguish them — 4xx is "try later", 5xx is "never" — but
      that distinction is lost by the time an adapter has reduced the outcome
      to `accepted: false`, and guessing from the message text is worse than
      not guessing. So everything is retried on a widening backoff and gives
      up after five attempts, which costs a handful of pointless connections
      against a genuinely dead address and saves every notification raised
      during a relay restart.
    */
    if (delivery.attempts >= MAX_ATTEMPTS) {
      await finish(delivery.id, {
        status: 'failed',
        lastError: result.error ?? 'send failed',
        failedAt: asOf,
        deferredUntil: null,
      })
      failed++
    } else {
      await finish(delivery.id, {
        status: 'queued',
        lastError: result.error ?? 'send failed',
        deferredUntil: new Date(asOf.getTime() + backoff(delivery.attempts)),
      })
      deferred++
    }
  }

  return { sent, failed, deferred }
}

function backoff(attempts: number): number {
  return Math.min(BASE_BACKOFF_MS * 2 ** Math.max(0, attempts - 1), MAX_BACKOFF_MS)
}

interface ClaimedDelivery {
  readonly id: string
  readonly channel: string
  readonly toAddress: string
  readonly locale: 'en' | 'ar'
  readonly attempts: number
  readonly subject: string | null
  readonly body: string
  readonly payload: Record<string, unknown>
  readonly recipientNameEn: string | null
  readonly recipientNameAr: string | null
  readonly senderNameEn: string
  readonly senderNameAr: string
}

/**
 * Take a batch, and make it invisible to any other runner for the lease.
 *
 * `for update skip locked` picks the batch without two runners contending, and
 * pushing `deferred_until` forward is what holds the claim after the
 * transaction commits — the row is then simply not due, which is the same
 * mechanism that implements backoff, so there is only one rule to reason about.
 */
async function claim(asOf: Date): Promise<ClaimedDelivery[]> {
  return withActor(systemActor(), async (tx) => {
    const due = await tx
      .select({
        id: notificationDeliveries.id,
        attempts: notificationDeliveries.attempts,
      })
      .from(notificationDeliveries)
      .where(
        and(
          eq(notificationDeliveries.status, 'queued'),
          or(
            isNull(notificationDeliveries.deferredUntil),
            lte(notificationDeliveries.deferredUntil, asOf),
          ),
        ),
      )
      .orderBy(asc(notificationDeliveries.createdAt))
      .limit(50)
      .for('update', { skipLocked: true })

    if (due.length === 0) return []

    const ids = due.map((row: { id: string }) => row.id)

    await tx
      .update(notificationDeliveries)
      .set({
        attempts: sql`${notificationDeliveries.attempts} + 1`,
        deferredUntil: new Date(asOf.getTime() + LEASE_MS),
      })
      .where(inArray(notificationDeliveries.id, ids))

    /*
      The recipient's name is recovered rather than stored.

      `notification_deliveries` carries an address, not a name, and adding a
      column to denormalise one would mean a migration and a second copy of a
      fact that already exists. A customer contact is matched on the pair that
      identifies it — the event's customer and the address the delivery was
      addressed to — and a staff recipient on the principal the row already
      names. A contact that cannot be matched simply has no name, and the
      templates are written so that reads as a neutral greeting rather than as
      a gap.
    */
    return tx
      .select({
        id: notificationDeliveries.id,
        channel: notificationDeliveries.channel,
        toAddress: notificationDeliveries.toAddress,
        locale: notificationDeliveries.locale,
        attempts: notificationDeliveries.attempts,
        subject: notificationTemplates.subject,
        body: notificationTemplates.body,
        payload: notificationOutbox.payload,
        recipientNameEn: sql<string | null>`coalesce(${customerContacts.nameEn}, ${principals.nameEn})`,
        recipientNameAr: sql<string | null>`coalesce(${customerContacts.nameAr}, ${principals.nameAr})`,
        senderNameEn: branches.legalNameEn,
        senderNameAr: branches.legalNameAr,
      })
      .from(notificationDeliveries)
      .innerJoin(notificationOutbox, eq(notificationOutbox.id, notificationDeliveries.outboxId))
      .innerJoin(branches, eq(branches.id, notificationOutbox.branchId))
      .innerJoin(
        notificationTemplates,
        eq(notificationTemplates.id, notificationDeliveries.templateId),
      )
      .leftJoin(principals, eq(principals.id, notificationDeliveries.principalId))
      .leftJoin(
        customerContacts,
        and(
          eq(customerContacts.customerId, notificationOutbox.customerId),
          eq(customerContacts.email, notificationDeliveries.toAddress),
        ),
      )
      .where(inArray(notificationDeliveries.id, ids))
  })
}

/** One row, one short transaction — the send has already happened. */
async function finish(
  id: string,
  patch: Partial<typeof notificationDeliveries.$inferInsert>,
): Promise<void> {
  await withActor(systemActor(), async (tx) => {
    await tx
      .update(notificationDeliveries)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(notificationDeliveries.id, id))
  })
}

// --- quiet hours -------------------------------------------------------------

function localHour(at: Date, timeZone: string): number {
  return Number(
    new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', hour12: false }).format(at),
  )
}

export function inQuietHours(at: Date, timeZone: string): boolean {
  const hour = localHour(at, timeZone)
  return hour >= QUIET_FROM_HOUR || hour < QUIET_TO_HOUR
}

/**
 * When the silence lifts.
 *
 * Computed by stepping forward an hour at a time rather than by constructing a
 * local midnight, which sounds crude and is deliberate: the alternative needs
 * an offset, and an offset is exactly the thing that is wrong twice a year in
 * the places this product is sold into next. Gulf time zones have no daylight
 * saving today; Türkiye and Morocco, on the same trade lanes, do.
 *
 * At most 24 iterations of an `Intl` format call, once per deferred event.
 */
export function nextQuietHoursEnd(from: Date, timeZone: string): Date {
  const at = new Date(from)
  at.setUTCMinutes(0, 0, 0)

  for (let step = 0; step < 24; step++) {
    at.setUTCHours(at.getUTCHours() + 1)
    if (localHour(at, timeZone) === QUIET_TO_HOUR) return at
  }

  // Unreachable with any real zone; a defined answer beats an infinite defer.
  return new Date(from.getTime() + 8 * 60 * 60_000)
}

/**
 * Raise an event from the service side.
 *
 * `apps/web` writes its outbox rows inline in the business transaction, which
 * is the point of a transactional outbox. The scheduled raisers here have no
 * business transaction to join, so they get a helper instead of repeating the
 * insert.
 */
export async function raise(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx: any,
  event: {
    branchId: string
    eventKey: string
    jobId?: string | null
    enquiryId?: string | null
    customerId?: string | null
    payload: Record<string, unknown>
  },
): Promise<void> {
  await tx.insert(notificationOutbox).values({
    branchId: event.branchId,
    eventKey: event.eventKey,
    jobId: event.jobId ?? null,
    enquiryId: event.enquiryId ?? null,
    customerId: event.customerId ?? null,
    payload: event.payload,
  })
}
