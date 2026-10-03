/**
 * The topbar bell — what the notification dispatcher left for the person
 * signed in.
 *
 * An in-app notification is not sent anywhere: `notification-dispatch` writes a
 * `notification_deliveries` row with `channel = 'in_app'` addressed to a
 * principal, the in-app adapter marks it `sent` the instant it exists, and this
 * is the only thing that ever reads it. So the "inbox" is a filtered view of
 * that one table — this principal's own rows, most recent first.
 *
 * ## The wording is rendered here, not stored
 *
 * The delivery row keeps the `template_id` it was dispatched with and the event
 * keeps its `payload`; the sentence is built from the two at read time with
 * `renderTemplate`, exactly as the mail path builds it at send time. Nothing is
 * frozen, which is the deliberate trade the feature was scoped on: an
 * administrator who rewords a template changes the wording of the alerts
 * already in the bell too, and for an operational nudge — "this enquiry has no
 * owner" — that is fine. A customer-facing record would want the opposite, but
 * `in_app` is a staff channel and carries none.
 *
 * No branch filter appears below. Every read runs inside `withActor` and RLS
 * scopes `notification_deliveries` to the caller's branch through its outbox;
 * the `principalId` clause narrows that to *this* person, and the two together
 * are why one operator never sees another's bell.
 */

import 'server-only'
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm'
import {
  notificationDeliveries,
  notificationOutbox,
  notificationTemplates,
  withActor,
  type Actor,
} from '@qabandi/db'
import { localisePayload, renderTemplate } from '@qabandi/core'
import type { NotificationView } from '@/lib/pilot/types'
import { usePilotFixtures } from '@/lib/pilot/source'
import { pilotNotifications } from '@/lib/pilot/fixtures'
import { target } from './target'

/** One alert as the bell shows it — subject collapsed, body when opened. */
export type InboxItem = NotificationView

export interface Inbox {
  readonly items: readonly InboxItem[]
  /** Every unread item, not only the ones shown — this is the badge. */
  readonly unread: number
}

/** Enough to fill the panel; the count above is the honest number. */
const LIMIT = 10

/**
 * `sent` and `delivered` are "arrived, unread"; `read` is arrived and opened.
 * `queued` is the one-tick gap before the adapter runs, and `failed` /
 * `suppressed` never happen for in-app — it cannot be refused — but excluding
 * them keeps the filter honest rather than relying on that.
 */
const ARRIVED = ['sent', 'delivered', 'read'] as const

/*
  `locale` steers the demo and nothing else.

  On a database each alert is already tied to a language — the recipient's, in
  `notification_deliveries.locale`, chosen when it was dispatched — so switching
  the UI language does not re-translate a notification any more than it
  re-translates a sent email. Fixtures have no such per-row locale, so the demo
  renders the bell in whatever language the shell is showing, which is what
  makes Moment 1's switch to Arabic carry the bell with it.
*/
export async function getInbox(actor: Actor, locale: 'en' | 'ar'): Promise<Inbox> {
  if (usePilotFixtures()) {
    const items = pilotNotifications(locale)
    return { items, unread: items.filter((item) => !item.read).length }
  }

  return withActor(actor, async (tx) => {
    const [rows, [counted]] = await Promise.all([
      tx
        .select({
          id: notificationDeliveries.id,
          readAt: notificationDeliveries.readAt,
          createdAt: notificationDeliveries.createdAt,
          locale: notificationDeliveries.locale,
          eventKey: notificationOutbox.eventKey,
          payload: notificationOutbox.payload,
          jobId: notificationOutbox.jobId,
          enquiryId: notificationOutbox.enquiryId,
          subject: notificationTemplates.subject,
          body: notificationTemplates.body,
        })
        .from(notificationDeliveries)
        .innerJoin(notificationOutbox, eq(notificationOutbox.id, notificationDeliveries.outboxId))
        .leftJoin(
          notificationTemplates,
          eq(notificationTemplates.id, notificationDeliveries.templateId),
        )
        .where(
          and(
            eq(notificationDeliveries.channel, 'in_app'),
            eq(notificationDeliveries.principalId, actor.principalId),
            inArray(notificationDeliveries.status, [...ARRIVED]),
          ),
        )
        .orderBy(desc(notificationDeliveries.createdAt))
        .limit(LIMIT),

      tx
        .select({ unread: sql<number>`count(*)::int` })
        .from(notificationDeliveries)
        .where(
          and(
            eq(notificationDeliveries.channel, 'in_app'),
            eq(notificationDeliveries.principalId, actor.principalId),
            inArray(notificationDeliveries.status, [...ARRIVED]),
            isNull(notificationDeliveries.readAt),
          ),
        ),
    ])

    const items = rows.map((row): InboxItem => {
      // Dates, money and codes as the mail path writes them, in the alert's language.
      const payload = localisePayload(row.payload ?? {}, row.locale)
      return {
        id: row.id,
        eventKey: row.eventKey,
        // A missing template cannot happen for a seeded internal event, but the
        // event key is a truthful last resort rather than an empty bubble.
        title: row.subject ? renderTemplate(row.subject, payload) : row.eventKey,
        body: row.body ? renderTemplate(row.body, payload) : '',
        href: target(row.jobId, row.enquiryId),
        createdAt: row.createdAt,
        read: row.readAt !== null,
      }
    })

    return { items, unread: counted?.unread ?? 0 }
  })
}

/*
  Marking read is the one write this slice makes, and it is idempotent.

  The `principalId` clause is not decoration on top of RLS: RLS scopes to the
  branch, and within one branch two operators share it, so without it an
  operator could clear a colleague's alert by its id. The `readAt is null`
  clause makes a second click a no-op rather than a second audit row — the
  bell revalidates the layout on every open, and a re-render must not keep
  re-stamping rows that are already read.

  `status` is advanced to `read` alongside `read_at` so the delivery log — the
  same FR-NT-06 log the mail path writes to — reads the same for both channels.
*/
export async function markRead(actor: Actor, deliveryId: string): Promise<void> {
  if (usePilotFixtures()) return

  const now = new Date()
  await withActor(actor, async (tx) => {
    await tx
      .update(notificationDeliveries)
      .set({ status: 'read', readAt: now, updatedAt: now })
      .where(
        and(
          eq(notificationDeliveries.id, deliveryId),
          eq(notificationDeliveries.principalId, actor.principalId),
          eq(notificationDeliveries.channel, 'in_app'),
          isNull(notificationDeliveries.readAt),
        ),
      )
  })
}

export async function markAllRead(actor: Actor): Promise<void> {
  if (usePilotFixtures()) return

  const now = new Date()
  await withActor(actor, async (tx) => {
    await tx
      .update(notificationDeliveries)
      .set({ status: 'read', readAt: now, updatedAt: now })
      .where(
        and(
          eq(notificationDeliveries.principalId, actor.principalId),
          eq(notificationDeliveries.channel, 'in_app'),
          isNull(notificationDeliveries.readAt),
        ),
      )
  })
}
