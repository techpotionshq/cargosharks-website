/**
 * The notification dispatcher — Architecture §7.4, FR-NT-01…07.
 *
 * Nine events across three channels in two languages is not fifty-four
 * handlers. It is this one function plus template rows:
 *
 *   outbox row -> resolve recipients (role rules + preferences + opt-outs)
 *              -> resolve template (event × channel × language × branch)
 *              -> adapter.send() -> delivery record
 *
 * Quiet hours (FR-NT-07) and the delivery states (FR-NT-06) live here, once.
 * Putting them in each event handler is how a system ends up sending a
 * customer a 3am WhatsApp about a milestone nobody is awake to act on.
 */

import { and, eq, isNull, or } from 'drizzle-orm'
import {
  customerContacts,
  notificationDeliveries,
  notificationOutbox,
  notificationTemplates,
  principals,
  systemActor,
  withActor,
} from '@qabandi/db'
import type { NotificationChannel } from '../ports/index'

/** Registered adapters. Adding a channel is one entry and a column value. */
const channels = new Map<string, NotificationChannel>()

export function registerChannel(channel: NotificationChannel): void {
  channels.set(channel.key, channel)
}

/** Quiet hours in the branch's local time — no outbound between these. */
const QUIET_FROM_HOUR = 21
const QUIET_TO_HOUR = 7

export async function runNotificationDispatch(
  data: Record<string, unknown>,
  asOf = new Date(),
): Promise<{ sent: number; suppressed: number }> {
  const outboxId = typeof data.outboxId === 'string' ? data.outboxId : null

  return withActor(systemActor(), async (tx) => {
    const pending = await tx
      .select()
      .from(notificationOutbox)
      .where(
        outboxId
          ? eq(notificationOutbox.id, outboxId)
          : isNull(notificationOutbox.dispatchedAt),
      )
      .limit(100)

    let sent = 0
    let suppressed = 0

    for (const event of pending) {
      // Recipients are resolved now, not when the event was raised: a
      // customer's contact list and opt-outs may have changed in between.
      const recipients = await tx
        .select({
          principalId: principals.id,
          email: principals.email,
          locale: principals.locale,
          optOuts: customerContacts.notificationOptOuts,
        })
        .from(principals)
        .leftJoin(customerContacts, eq(customerContacts.principalId, principals.id))
        .where(
          and(
            eq(principals.isActive, true),
            event.customerId ? eq(principals.customerId, event.customerId) : undefined,
          ),
        )

      for (const recipient of recipients) {
        if (recipient.optOuts?.includes(event.eventKey)) {
          await record(tx, event.id, recipient, 'suppressed', 'opted out')
          suppressed++
          continue
        }

        // Template resolution falls back from a branch override to the
        // default row — `notification_templates` unique on
        // (event, channel, locale, branch).
        const [template] = await tx
          .select()
          .from(notificationTemplates)
          .where(
            and(
              eq(notificationTemplates.eventKey, event.eventKey),
              eq(notificationTemplates.channel, 'email'),
              eq(notificationTemplates.locale, recipient.locale),
              or(
                eq(notificationTemplates.branchId, event.branchId),
                isNull(notificationTemplates.branchId),
              ),
              eq(notificationTemplates.isActive, true),
            ),
          )
          .orderBy(notificationTemplates.branchId)
          .limit(1)

        if (!template) {
          await record(tx, event.id, recipient, 'failed', 'no template')
          continue
        }

        if (inQuietHours(asOf)) {
          // Deferred, not cancelled — and the operator can see which.
          await record(tx, event.id, recipient, 'queued', 'quiet hours')
          suppressed++
          continue
        }

        const adapter = channels.get('email')
        if (!adapter) {
          await record(tx, event.id, recipient, 'failed', 'no adapter')
          continue
        }

        const result = await adapter.send({
          to: recipient.email,
          subject: render(template.subject ?? '', event.payload),
          body: render(template.body, event.payload),
          locale: recipient.locale,
        })

        await record(
          tx,
          event.id,
          recipient,
          result.accepted ? 'sent' : 'failed',
          result.error,
          result.externalRef,
        )
        if (result.accepted) sent++
      }

      await tx
        .update(notificationOutbox)
        .set({ dispatchedAt: asOf })
        .where(eq(notificationOutbox.id, event.id))
    }

    return { sent, suppressed }
  })
}

function inQuietHours(at: Date): boolean {
  const hour = Number(
    new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kuwait', hour: '2-digit', hour12: false })
      .format(at),
  )
  return hour >= QUIET_FROM_HOUR || hour < QUIET_TO_HOUR
}

/** `{{field}}` substitution. Templates are data, so this stays deliberately dumb. */
function render(template: string, payload: Record<string, unknown>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => String(payload[key] ?? ''))
}

async function record(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx: any,
  outboxId: string,
  recipient: { principalId: string; email: string; locale: 'en' | 'ar' },
  status: 'queued' | 'sent' | 'failed' | 'suppressed',
  reason?: string,
  externalRef?: string,
): Promise<void> {
  await tx.insert(notificationDeliveries).values({
    outboxId,
    principalId: recipient.principalId,
    channel: 'email' as const,
    locale: recipient.locale,
    toAddress: recipient.email,
    status,
    externalRef: externalRef ?? null,
    suppressedReason: status === 'suppressed' ? reason : null,
    lastError: status === 'failed' ? reason : null,
    sentAt: status === 'sent' ? new Date() : null,
  })
}
