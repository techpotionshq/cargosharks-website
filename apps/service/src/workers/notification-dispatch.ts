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
  invoices,
  notificationChannelSettings,
  notificationDeliveries,
  notificationOutbox,
  notificationTemplates,
  principalBranchRoles,
  principals,
  quotes,
  systemActor,
  withActor,
} from '@qabandi/db'
import {
  channelDecision,
  localisePayload,
  noticeNoLongerApplies,
  noticeSubject,
  notificationEvent,
  renderTemplate,
} from '@qabandi/core'
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

/**
 * Quiet hours, where a branch has not been given its own.
 *
 * These were the whole of FR-NT-07 until the columns existed, which made "we
 * do not write to customers between nine at night and seven in the morning" a
 * fact about the deployment rather than about the office. It is an office
 * fact: everything else about the window was already per-branch, because the
 * comparison is made in `branches.time_zone`.
 *
 * Kept as the fallback rather than deleted — a branch row that predates the
 * migration takes these values as its column defaults, so the behaviour is
 * unchanged for everyone until somebody deliberately changes it.
 */
const QUIET_FROM_HOUR = 21
const QUIET_TO_HOUR = 7

/** The window one branch keeps. */
export interface QuietHours {
  readonly enabled: boolean
  readonly from: number
  readonly to: number
}

const DEFAULT_QUIET_HOURS: QuietHours = {
  enabled: true,
  from: QUIET_FROM_HOUR,
  to: QUIET_TO_HOUR,
}

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

/**
 * `data` is nullable because the scheduler sends nothing.
 *
 * pg-boss gives a cron-scheduled job a null payload, and this ran on a cron
 * from the day it was written: `data.outboxId` threw `TypeError` on every
 * tick, so the scheduled dispatcher never once completed — 616 failed jobs
 * and not a single delivery. Every test called it as `{ outboxId }`, which is
 * the one shape the scheduler never sends, so the suite stayed green over a
 * worker that had never worked.
 *
 * The optional chain is the fix; the signature is the documentation.
 */
export async function runNotificationDispatch(
  data: Record<string, unknown> | null | undefined,
  asOf = new Date(),
): Promise<DispatchResult> {
  const outboxId = typeof data?.outboxId === 'string' ? data.outboxId : null
  const { expanded, suppressed } = await expand(outboxId, asOf)
  const { sent, failed, deferred, stale } = await flush(asOf)
  return { expanded, sent, failed, deferred, suppressed: suppressed + stale }
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
    /*
      The send switches, read once for the whole run rather than per delivery.

      A busy morning expands hundreds of rows against thirteen events and one
      channel, so this is one query instead of one per recipient per channel.
      Reading it *inside* the same transaction as the expansion matters: an
      administrator switching mail off while a batch is mid-flight gets a
      consistent answer for that batch rather than half of one.
    */
    const switches = await tx
      .select({
        eventKey: notificationChannelSettings.eventKey,
        channel: notificationChannelSettings.channel,
        isEnabled: notificationChannelSettings.isEnabled,
      })
      .from(notificationChannelSettings)

    const pending = await tx
      .select({
        id: notificationOutbox.id,
        branchId: notificationOutbox.branchId,
        eventKey: notificationOutbox.eventKey,
        customerId: notificationOutbox.customerId,
        payload: notificationOutbox.payload,
        timeZone: branches.timeZone,
        quietEnabled: branches.quietHoursEnabled,
        quietFrom: branches.quietHoursFromHour,
        quietTo: branches.quietHoursToHour,
      })
      .from(notificationOutbox)
      .innerJoin(branches, eq(branches.id, notificationOutbox.branchId))
      /*
        Undispatched only — an addressed run included — and locked as read.

        `skip locked` is the same claim `claim()` makes for deliveries: two
        dispatchers (two service instances, or a cron tick overlapping an
        addressed run) each expand a disjoint set of events, where both used
        to read the same pending rows and write every delivery twice. The lock
        is held to the end of this transaction, which is where `markDispatched`
        stamps the row, so the second runner never sees it pending again. An
        addressed run of an event already dispatched expands nothing rather
        than a second set of deliveries.
      */
      .where(
        outboxId
          ? and(eq(notificationOutbox.id, outboxId), isNull(notificationOutbox.dispatchedAt))
          : isNull(notificationOutbox.dispatchedAt),
      )
      .orderBy(asc(notificationOutbox.createdAt))
      .limit(100)
      .for('update', { of: notificationOutbox, skipLocked: true })

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
      const quiet: QuietHours = {
        enabled: event.quietEnabled,
        from: event.quietFrom,
        to: event.quietTo,
      }

      const defer =
        declared.audience === 'customer' && inQuietHours(asOf, event.timeZone, quiet)
          ? nextQuietHoursEnd(asOf, event.timeZone, quiet)
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
          /*
            In-app is a staff surface, and only staff.

            The bell lives in the operations shell; a customer contact has no
            inbox to read one, so an in-app delivery addressed to a customer
            would be delivered to nothing and sit `sent` for ever. It is not a
            suppression either — the customer is told, by mail — so it leaves no
            row: the channel simply does not apply to this audience. Skipped
            here rather than by omitting the seed, because "no in_app template"
            is a failure the log should never carry for a decision that was
            deliberate. `enquiry.sla_breached` and the other internal events
            fall through and do get one.
          */
          if (channel === 'in_app' && declared.audience === 'customer') continue

          /*
            Switched off — FR-NT-03.

            Recorded rather than skipped, and checked *before* the template is
            resolved. Both halves are deliberate.

            Recorded, because a notification that leaves no row is one nobody
            can answer a question about: "did the customer get told the invoice
            was overdue" has to have an answer six months later, and "off at
            the time" is a perfectly good one. It is the same `suppressed`
            state that quiet hours and opt-outs already write, so the delivery
            log stays one list with one vocabulary.

            Before the template, because a silenced event does not need one. A
            deployment that turns an event off and then deletes its wording
            would otherwise start recording `failed: no template` against a
            decision that was working exactly as intended, and a log full of
            failures is a log nobody reads.
          */
          const decision = channelDecision(switches, event.eventKey, channel)

          if (!decision.enabled) {
            await tx.insert(notificationDeliveries).values({
              outboxId: event.id,
              principalId: recipient.principalId,
              channel: channel as 'email',
              locale: recipient.locale,
              toAddress: recipient.email,
              status: 'suppressed' as const,
              suppressedReason: decision.reason,
            })
            suppressed++
            continue
          }

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
  await tx
    .update(notificationOutbox)
    .set({ dispatchedAt: asOf })
    .where(eq(notificationOutbox.id, id))
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

  /*
    One recipient per address. `customer_contacts` has no unique key on
    (customer, email), and a contacts CSV imported twice — the importer inserts
    blindly — doubled every customer email the dispatcher sent. The first row
    for an address answers for it, preferring one with a portal principal
    (it carries the stated language); opt-outs are the union, because a contact
    who opted out on either copy of themselves has opted out.
  */
  const byAddress = new Map<string, Recipient>()
  const recipients: Recipient[] = rows
    .map((row: Record<string, unknown>) => {
      // A contact who has never been invited to the portal has no principal and
      // therefore no stated language preference. English is the fallback, and
      // an administrator changes it by inviting them.
      const locale = ((row.locale as 'en' | 'ar' | null) ?? 'en') as 'en' | 'ar'
      return {
        principalId: (row.principalId as string | null) ?? null,
        email: (row.contactEmail as string | null) ?? (row.principalEmail as string | null) ?? '',
        name:
          (locale === 'ar' ? (row.nameAr as string | null) : null) ?? (row.nameEn as string) ?? '',
        locale,
        optOuts: (row.optOuts as string[] | null) ?? [],
      }
    })
    .filter((r: Recipient) => r.email.length > 0)

  for (const recipient of recipients) {
    const key = recipient.email.trim().toLowerCase()
    const seen = byAddress.get(key)
    if (!seen) {
      byAddress.set(key, recipient)
      continue
    }
    const keep = seen.principalId === null && recipient.principalId !== null ? recipient : seen
    byAddress.set(key, {
      ...keep,
      optOuts: [...new Set([...seen.optOuts, ...recipient.optOuts])],
    })
  }
  return [...byAddress.values()]
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

async function flush(
  asOf: Date,
): Promise<{ sent: number; failed: number; deferred: number; stale: number }> {
  const claimed = await claim(asOf)

  let sent = 0
  let failed = 0
  let deferred = 0
  let stale = 0

  for (const delivery of claimed) {
    /*
      Still true? Read at the moment of sending, not when the event was raised.

      A customer notice held by quiet hours (or by a relay that was down) went
      out hours later as it was worded then: a quotation "to proceed with"
      after the customer had accepted it, an issued invoice after it was paid.
      The record is re-read here and a notice it contradicts is closed as
      `suppressed` with the reason, the same row and vocabulary quiet hours and
      opt-outs write, so the log still answers "why was the customer not told".
    */
    const noLonger = await noLongerApplies(delivery)
    if (noLonger) {
      await finish(delivery.id, {
        status: 'suppressed',
        suppressedReason: noLonger,
        deferredUntil: null,
      })
      stale++
      continue
    }

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
      // Dates, money, the currency and the mode as a letter writes them (D4).
      ...localisePayload(delivery.payload, delivery.locale),
      recipientName: (arabic ? delivery.recipientNameAr : null) ?? delivery.recipientNameEn ?? '',
      senderName: arabic ? delivery.senderNameAr : delivery.senderNameEn,
    }

    const result = await adapter.send({
      to: delivery.toAddress,
      from: delivery.senderAddress ?? undefined,
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

  return { sent, failed, deferred, stale }
}

/**
 * Why a claimed delivery should not go out after all, or null.
 *
 * The record is found the way the customer would name it, by the reference in
 * the payload, on the event's branch. Two matches or none is "not found",
 * which sends (`noticeNoLongerApplies`).
 */
async function noLongerApplies(delivery: ClaimedDelivery): Promise<string | null> {
  const subject = noticeSubject(delivery.eventKey)
  if (!subject) return null
  const reference = delivery.payload[subject.field]
  if (typeof reference !== 'string' || reference === '') return null

  const rows: { status: string }[] = await withActor(systemActor(), async (tx) =>
    subject.record === 'quote'
      ? await tx
          .select({ status: quotes.status })
          .from(quotes)
          .where(and(eq(quotes.branchId, delivery.branchId), eq(quotes.reference, reference)))
          .limit(2)
      : await tx
          .select({ status: invoices.status })
          .from(invoices)
          .where(and(eq(invoices.branchId, delivery.branchId), eq(invoices.seriesNo, reference)))
          .limit(2),
  )
  const status = rows.length === 1 ? rows[0]!.status : null
  return noticeNoLongerApplies(delivery.eventKey, reference, status)
}

function backoff(attempts: number): number {
  return Math.min(BASE_BACKOFF_MS * 2 ** Math.max(0, attempts - 1), MAX_BACKOFF_MS)
}

interface ClaimedDelivery {
  readonly id: string
  readonly eventKey: string
  readonly branchId: string
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
  /** The branch's own `From:`, or null to use the channel's configured one. */
  readonly senderAddress: string | null
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
        eventKey: notificationOutbox.eventKey,
        branchId: notificationOutbox.branchId,
        channel: notificationDeliveries.channel,
        toAddress: notificationDeliveries.toAddress,
        locale: notificationDeliveries.locale,
        attempts: notificationDeliveries.attempts,
        subject: notificationTemplates.subject,
        body: notificationTemplates.body,
        payload: notificationOutbox.payload,
        /*
          One contact's name, by subquery rather than a join. A join on
          (customer, address) returned the delivery once per matching contact
          row — and the flush sends once per row returned, so a duplicated
          contact meant the same mail sent twice from one delivery.
        */
        recipientNameEn: sql<string | null>`coalesce(
          (select cc.name_en from ${customerContacts} cc
            where cc.customer_id = ${notificationOutbox.customerId}
              and lower(cc.email) = lower(${notificationDeliveries.toAddress})
            order by cc.is_active desc, cc.created_at
            limit 1),
          ${principals.nameEn})`,
        recipientNameAr: sql<string | null>`coalesce(
          (select cc.name_ar from ${customerContacts} cc
            where cc.customer_id = ${notificationOutbox.customerId}
              and lower(cc.email) = lower(${notificationDeliveries.toAddress})
            order by cc.is_active desc, cc.created_at
            limit 1),
          ${principals.nameAr})`,
        senderNameEn: branches.legalNameEn,
        senderNameAr: branches.legalNameAr,
        /*
          The branch's own sender address, where it has one.

          Null for a branch that has not been given one, and the channel's
          configured default answers instead — so this is additive for every
          deployment and for every branch inside one.
        */
        senderAddress: branches.mailFrom,
      })
      .from(notificationDeliveries)
      .innerJoin(notificationOutbox, eq(notificationOutbox.id, notificationDeliveries.outboxId))
      .innerJoin(branches, eq(branches.id, notificationOutbox.branchId))
      .innerJoin(
        notificationTemplates,
        eq(notificationTemplates.id, notificationDeliveries.templateId),
      )
      .leftJoin(principals, eq(principals.id, notificationDeliveries.principalId))
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

export function inQuietHours(
  at: Date,
  timeZone: string,
  quiet: QuietHours = DEFAULT_QUIET_HOURS,
): boolean {
  if (!quiet.enabled) return false

  const hour = localHour(at, timeZone)

  /*
    Two readings of the same pair, and both are legitimate.

    21 to 7 wraps midnight and is the shape every deployment uses; 1 to 6 does
    not wrap and is what a branch with a short maintenance window would set.
    Treating the second as though it wrapped would silence the whole working
    day. `from = to` is refused by the check constraint in `0029` because it
    has no reading that is not a coin toss between these two.
  */
  return quiet.from > quiet.to
    ? hour >= quiet.from || hour < quiet.to
    : hour >= quiet.from && hour < quiet.to
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
export function nextQuietHoursEnd(
  from: Date,
  timeZone: string,
  quiet: QuietHours = DEFAULT_QUIET_HOURS,
): Date {
  const at = new Date(from)
  at.setUTCMinutes(0, 0, 0)

  for (let step = 0; step < 24; step++) {
    at.setUTCHours(at.getUTCHours() + 1)
    if (localHour(at, timeZone) === quiet.to) return at
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
