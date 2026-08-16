/**
 * Messaging, notifications and outbound webhooks — Architecture §7.4, §9.
 *
 * The flow is one line long and every requirement in FR-NT hangs off it:
 *
 *   domain event -> outbox row (same transaction) -> pg-boss -> dispatcher
 *     -> resolve recipients -> resolve template -> adapter.send() -> delivery
 *
 * The outbox row is written inside the business transaction, so a notification
 * never exists for a write that rolled back — a transactional outbox with no
 * extra component.
 */

import { boolean, index, integer, jsonb, text, unique } from 'drizzle-orm/pg-core'
import { pk, ref, timestamps, tsz } from './columns'
import { pgTable, systemTable } from './table'
import { channelEnum, deliveryStatusEnum, localeEnum, messageDirectionEnum } from './enums'
import { branches, principals } from './identity'
import { assets } from './files'
import { customers } from './commercial'
import { enquiries, jobs } from './jobs'

/**
 * The conversation thread against a job or enquiry — FR-NT-05.
 *
 * Inbound WhatsApp and email land here alongside outbound messages, so the
 * thread is the whole correspondence rather than the half the system sent.
 */
export const messages = pgTable(
  'messages',
  {
    id: pk(),
    branchId: ref('branch_id')
      .notNull()
      .references(() => branches.id),
    jobId: ref('job_id').references(() => jobs.id),
    enquiryId: ref('enquiry_id').references(() => enquiries.id),
    channel: channelEnum('channel').notNull(),
    direction: messageDirectionEnum('direction').notNull(),
    subject: text('subject'),
    body: text('body').notNull(),
    fromAddress: text('from_address'),
    toAddresses: jsonb('to_addresses').$type<string[]>().default([]),
    ccAddresses: jsonb('cc_addresses').$type<string[]>().default([]),
    authorId: ref('author_id').references(() => principals.id),
    /** The provider's own id, so a webhook can match a status to this row. */
    externalRef: text('external_ref'),
    customerVisible: boolean('customer_visible').notNull().default(true),
    sentAt: tsz('sent_at'),
    deliveredAt: tsz('delivered_at'),
    readAt: tsz('read_at'),
    ...timestamps,
  },
  (t) => [
    index('messages_job_idx').on(t.jobId, t.createdAt),
    index('messages_enquiry_idx').on(t.enquiryId, t.createdAt),
    index('messages_external_idx').on(t.externalRef),
  ],
)

export const messageAttachments = pgTable(
  'message_attachments',
  {
    id: pk(),
    messageId: ref('message_id')
      .notNull()
      .references(() => messages.id),
    assetId: ref('asset_id')
      .notNull()
      .references(() => assets.id),
    ...timestamps,
  },
  (t) => [index('message_attachments_message_idx').on(t.messageId)],
)

/**
 * The outbox. Written in the business transaction, drained by pg-boss.
 *
 * It holds the *event*, not the message: recipients, template and language are
 * resolved by the dispatcher at send time, because a customer's contact list
 * and opt-outs may have changed between the event and the send.
 */
export const notificationOutbox = pgTable(
  'notification_outbox',
  {
    id: pk(),
    branchId: ref('branch_id')
      .notNull()
      .references(() => branches.id),
    eventKey: text('event_key').notNull(),
    jobId: ref('job_id').references(() => jobs.id),
    enquiryId: ref('enquiry_id').references(() => enquiries.id),
    customerId: ref('customer_id').references(() => customers.id),
    /** Merge fields for the template — resolved names, references, dates. */
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
    /** Set once pg-boss has accepted it; unclaimed rows are the retry set. */
    enqueuedAt: tsz('enqueued_at'),
    dispatchedAt: tsz('dispatched_at'),
    ...timestamps,
  },
  (t) => [index('notification_outbox_pending_idx').on(t.dispatchedAt, t.createdAt)],
)

/**
 * One row per recipient per channel — FR-NT-06's delivery states.
 *
 * Queued, sent, delivered, read, failed, suppressed. `suppressed` is a first
 * class outcome, not an error: quiet hours (FR-NT-07) and opt-outs stop a send
 * deliberately, and an operator needs to see that it was stopped rather than
 * lost.
 */
export const notificationDeliveries = pgTable(
  'notification_deliveries',
  {
    id: pk(),
    outboxId: ref('outbox_id')
      .notNull()
      .references(() => notificationOutbox.id),
    principalId: ref('principal_id').references(() => principals.id),
    channel: channelEnum('channel').notNull(),
    locale: localeEnum('locale').notNull(),
    toAddress: text('to_address').notNull(),
    status: deliveryStatusEnum('status').notNull().default('queued'),
    templateId: ref('template_id'),
    externalRef: text('external_ref'),
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),
    /** Set where quiet hours deferred the send rather than cancelling it. */
    deferredUntil: tsz('deferred_until'),
    suppressedReason: text('suppressed_reason'),
    sentAt: tsz('sent_at'),
    deliveredAt: tsz('delivered_at'),
    readAt: tsz('read_at'),
    failedAt: tsz('failed_at'),
    ...timestamps,
  },
  (t) => [
    index('notification_deliveries_outbox_idx').on(t.outboxId),
    index('notification_deliveries_status_idx').on(t.status, t.deferredUntil),
    index('notification_deliveries_external_idx').on(t.externalRef),
  ],
)

/** Outbound webhook subscriptions — FR-AD-06. */
export const webhookEndpoints = pgTable(
  'webhook_endpoints',
  {
    id: pk(),
    customerId: ref('customer_id').references(() => customers.id),
    branchId: ref('branch_id').references(() => branches.id),
    url: text('url').notNull(),
    /** HMAC signing secret; the receiver verifies the signature header. */
    secret: text('secret').notNull(),
    events: jsonb('events').$type<string[]>().notNull().default([]),
    isActive: boolean('is_active').notNull().default(true),
    disabledAt: tsz('disabled_at'),
    disabledReason: text('disabled_reason'),
    ...timestamps,
  },
  (t) => [index('webhook_endpoints_customer_idx').on(t.customerId)],
)

/** Delivery log with retry state — FR-AD-06 requires backoff and a log. */
export const webhookDeliveries = pgTable(
  'webhook_deliveries',
  {
    id: pk(),
    endpointId: ref('endpoint_id')
      .notNull()
      .references(() => webhookEndpoints.id),
    eventKey: text('event_key').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    status: deliveryStatusEnum('status').notNull().default('queued'),
    attempts: integer('attempts').notNull().default(0),
    nextAttemptAt: tsz('next_attempt_at'),
    responseStatus: integer('response_status'),
    responseBody: text('response_body'),
    deliveredAt: tsz('delivered_at'),
    ...timestamps,
  },
  (t) => [index('webhook_deliveries_retry_idx').on(t.status, t.nextAttemptAt)],
)

/**
 * Inbound webhook receipts, kept for idempotency.
 *
 * WhatsApp and email providers redeliver; a unique key on the provider's id
 * is what stops one inbound email becoming three enquiries.
 */
export const inboundWebhookEvents = systemTable(
  'Provider receipts, deduplicated by external id. Not business data.',
)(
  'inbound_webhook_events',
  {
    id: pk(),
    provider: text('provider').notNull(),
    externalId: text('external_id').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    processedAt: tsz('processed_at'),
    error: text('error'),
    ...timestamps,
  },
  (t) => [unique('inbound_webhook_events_unique').on(t.provider, t.externalId)],
)

export type Message = typeof messages.$inferSelect
export type NotificationOutbox = typeof notificationOutbox.$inferSelect
export type NotificationDelivery = typeof notificationDeliveries.$inferSelect
