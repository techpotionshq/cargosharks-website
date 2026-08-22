import 'server-only'

/**
 * The wording of every notification the product sends — FR-NT-01, FR-NT-03.
 *
 * `notification_templates` was seeded with thirteen events in two languages
 * and reachable from nowhere: the requirement says an administrator changes
 * the wording without a developer, and the only way to do it was a database
 * client. `db/notification-templates.ts` even says so in its own docstring —
 * *"nothing here is compiled into the application, and that is the whole
 * design: configuration is rows, not classes"* — while the rows sat behind no
 * screen at all.
 *
 * ## Defaults and overrides are one list
 *
 * A row with no branch is the fallback; a row with a branch wins over it
 * (§7.4). The screen shows both, because the question an administrator has is
 * never "what is the default" — it is "what will Kuwait actually send", and
 * that is answered by seeing the pair.
 */

import { asc, eq, sql } from 'drizzle-orm'
import { NOTIFICATION_EVENTS, UNIVERSAL_MERGE_FIELDS, type NotificationSwitch } from '@qabandi/core'
import {
  branches,
  notificationChannelSettings,
  notificationTemplates,
  withActor,
  type Actor,
} from '@qabandi/db'

/**
 * The send switches, as the settings screen needs them — FR-NT-03.
 *
 * Returned as the whole table rather than as a resolved answer per event,
 * because the screen renders the *switches* and `channelDecision` in `core`
 * renders the answer. Duplicating that precedence here would give the product
 * two implementations of "is this on", and the one on the screen would be the
 * one nobody tested against a dispatcher.
 */
export async function listChannelSettings(actor: Actor): Promise<NotificationSwitch[]> {
  return withActor(actor, (tx) =>
    tx
      .select({
        eventKey: notificationChannelSettings.eventKey,
        channel: notificationChannelSettings.channel,
        isEnabled: notificationChannelSettings.isEnabled,
      })
      .from(notificationChannelSettings),
  )
}

export interface TemplateRow {
  readonly id: string
  readonly eventKey: string
  readonly channel: string
  readonly locale: 'en' | 'ar'
  readonly branchId: string | null
  readonly branchCode: string | null
  readonly subject: string | null
  readonly body: string
  readonly isActive: boolean
}

export interface TemplateEvent {
  readonly key: string
  readonly audience: string
  readonly summary: string
  /** Every field the template may use — the event's own plus the universal. */
  readonly mergeFields: readonly string[]
  readonly templates: readonly TemplateRow[]
}

/**
 * Every event the product can raise, with whatever templates exist for it.
 *
 * Driven from `NOTIFICATION_EVENTS` in core rather than from the table, so an
 * event with no template at all appears — as an empty row that needs filling,
 * which is exactly the state that used to send `failed: no adapter` to nobody.
 */
export async function listTemplates(actor: Actor): Promise<TemplateEvent[]> {
  const rows = await withActor(actor, (tx) =>
    tx
      .select({
        id: notificationTemplates.id,
        eventKey: notificationTemplates.eventKey,
        channel: notificationTemplates.channel,
        locale: notificationTemplates.locale,
        branchId: notificationTemplates.branchId,
        branchCode: branches.code,
        subject: notificationTemplates.subject,
        body: notificationTemplates.body,
        isActive: notificationTemplates.isActive,
      })
      .from(notificationTemplates)
      .leftJoin(branches, eq(branches.id, notificationTemplates.branchId))
      // Defaults first within an event, then each branch's override under it.
      .orderBy(
        asc(notificationTemplates.eventKey),
        sql`${notificationTemplates.branchId} nulls first`,
        asc(notificationTemplates.locale),
      ),
  )

  return NOTIFICATION_EVENTS.map((event) => ({
    key: event.key,
    audience: event.audience,
    summary: event.summary,
    mergeFields: [...UNIVERSAL_MERGE_FIELDS, ...event.fields],
    templates: rows.filter((row) => row.eventKey === event.key) as TemplateRow[],
  }))
}

export interface DeliveryRow {
  readonly id: string
  readonly eventKey: string
  readonly channel: string
  readonly recipient: string | null
  readonly status: string
  readonly attempts: number
  readonly lastError: string | null
  readonly suppressedReason: string | null
  readonly deferredUntil: Date | null
  readonly sentAt: Date | null
  readonly createdAt: Date
}

/**
 * What actually left the building, and what did not — FR-NT-06.
 *
 * `notification_deliveries` carries `attempts`, `last_error`, `failed_at` and
 * `deferred_until`, all written by the dispatcher and read by nobody. The
 * requirement is a delivery log; a log nothing renders is a table.
 *
 * The failures are the point. A notification that never arrived is an incident
 * to investigate rather than a row to garbage-collect — which is why the queue
 * keeps failed jobs for a month — and until this existed the only way to see
 * one was a database client.
 */
export async function listDeliveries(actor: Actor, limit = 100): Promise<DeliveryRow[]> {
  const rows = await withActor(actor, (tx) =>
    tx.execute(sql`
      select d.id, o.event_key as "eventKey", d.channel::text as channel,
             d.to_address as recipient, d.status::text as status, d.attempts,
             d.last_error as "lastError", d.suppressed_reason as "suppressedReason",
             d.deferred_until as "deferredUntil", d.sent_at as "sentAt",
             d.created_at as "createdAt"
        from notification_deliveries d
        join notification_outbox o on o.id = d.outbox_id
       -- Failures first whatever their age: a send that failed last week is
       -- more interesting than one that succeeded this morning.
       order by (d.status in ('failed', 'queued')) desc, d.created_at desc
       limit ${limit}
    `),
  )

  return rows.rows as unknown as DeliveryRow[]
}
