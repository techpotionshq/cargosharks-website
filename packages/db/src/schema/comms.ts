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
 * The mailboxes this deployment reads — FR-EQ-02, FR-AD-03.
 *
 * A row rather than an environment variable, and that is the house rule rather
 * than a preference: *"configuration is rows, not code"*, and FR-AD-03 wants
 * everything an administrator changes to take effect without a release. Adding
 * the Doha office should be a screen, not a deployment — and the deployment is
 * the reason the office waits three weeks.
 *
 * ## The password is sealed, not stored
 *
 * `password_sealed` holds AES-256-GCM ciphertext, keyed by
 * `MAILBOX_ENCRYPTION_KEY` from the environment. The key never enters the
 * database, so a dump, a restore drill or a replica carries no usable mailbox
 * credential — which matters more here than for most secrets, because an IMAP
 * password is frequently the staff member's whole account password.
 *
 * This is the one thing that cannot move into a row. Sealing with a key stored
 * beside the ciphertext is not encryption, it is encoding.
 *
 * ## Never deleted
 *
 * `is_active`, like everything else (§5.5). "Were we reading that mailbox in
 * March, and with whose credential" is a question asked after an incident, and
 * a deleted row cannot answer it.
 */
export const mailboxes = pgTable(
  'mailboxes',
  {
    id: pk(),
    /** The office whose enquiries arrive here. Scopes the rows RLS returns. */
    branchId: ref('branch_id')
      .notNull()
      .references(() => branches.id),
    host: text('host').notNull(),
    port: integer('port').notNull().default(993),
    /** Implicit TLS, which is what 993 is. STARTTLS on 143 is the other one. */
    secure: boolean('secure').notNull().default(true),
    username: text('username').notNull(),
    /** AES-256-GCM, `v1:<iv>:<tag>:<ciphertext>`. See `secrets.ts`. */
    passwordSealed: text('password_sealed').notNull(),
    folder: text('folder').notNull().default('INBOX'),
    /**
     * Where a handled message is moved. Null leaves it flagged in place.
     *
     * Setting it is the kinder shape for a mailbox a coordinator also reads
     * with their own eyes: they watch the queue drain rather than watch read
     * messages pile up beneath the ones that still need them.
     */
    archiveFolder: text('archive_folder'),
    /**
     * Messages taken per run from *this* mailbox. The rest wait a minute.
     *
     * `INBOUND_MAIL_BATCH` until now, which meant one number for every office.
     * The row it belongs on already existed: a shared Office 365 mailbox on a
     * throttled tenant and a self-hosted Dovecot want different answers, and
     * tuning one of them down used to tune all five.
     */
    pollBatch: integer('poll_batch').notNull().default(25),
    /**
     * Attachments larger than this are recorded by name with their bytes
     * dropped — an 80MB scan of a customs file should not lose the enquiry it
     * came attached to, and should not take the worker down either.
     */
    maxAttachmentMb: integer('max_attachment_mb').notNull().default(25),
    isActive: boolean('is_active').notNull().default(true),
    /*
      What the last run did, so the screen can say so.

      A mailbox that stopped working is otherwise invisible: the enquiry queue
      simply goes quiet, and quiet looks like a slow week. These three columns
      are what turn that into a red row an administrator can see.
    */
    lastPolledAt: tsz('last_polled_at'),
    lastMessageAt: tsz('last_message_at'),
    lastError: text('last_error'),
    ...timestamps,
  },
  (t) => [
    index('mailboxes_branch_idx').on(t.branchId, t.isActive),
    /*
      One row per address per host.

      Two rows for the same mailbox would poll it twice, and the second poll
      would find nothing because the first had already flagged everything —
      an intermittent-looking bug with a configuration cause.
    */
    unique('mailboxes_address_unique').on(t.host, t.username),
  ],
)

/**
 * The WhatsApp business numbers this deployment answers on — FR-EQ-02, FR-AD-03.
 *
 * The mirror of `mailboxes`, one table down. An inbound email names the branch
 * by the address it was delivered to; an inbound WhatsApp message names it by
 * the business number that received it — Kapso puts that on every
 * `whatsapp.message.received` as `phone_number_id`. This is the row that turns
 * that id into the office whose enquiry queue the message belongs in.
 *
 * ## Why a table and not a column on `mailboxes` or the integration row
 *
 * A branch is a legal entity (FR-ID-01) and each may answer on its own number,
 * exactly as each keeps its own mailbox — so this is per-branch configuration an
 * administrator edits without a release, which is a row, not code (FR-AD-03).
 * It is separate from the `whatsapp` integration row because that row holds the
 * one Kapso API key the *account* sends with; this holds the many numbers the
 * account *receives* on, and the two scale differently.
 *
 * ## No sealed secret here
 *
 * Unlike `mailboxes`, there is no credential on the row: Kapso holds the number
 * and the WhatsApp session, and the one secret that opens the account — the
 * Kapso API key — is the `whatsapp` integration secret, sealed there once rather
 * than per number. So no `password_sealed`, and no format constraint to match.
 *
 * ## Never deleted
 *
 * `is_active`, like `mailboxes` (§5.5): "were we answering on that number in
 * March, and for which office" is a post-incident question a deleted row cannot
 * answer.
 */
export const whatsappNumbers = pgTable(
  'whatsapp_numbers',
  {
    id: pk(),
    /** The office whose enquiries arrive on this number. Scopes the rows RLS returns. */
    branchId: ref('branch_id')
      .notNull()
      .references(() => branches.id),
    /**
     * The Meta/Kapso phone-number id — the opaque key, not the dialable number.
     *
     * This is what an inbound webhook carries as `phone_number_id`, and what an
     * outbound send addresses as the sending number. Unique across the table
     * (below), because branch resolution reads it and two rows for one number
     * would file the same message under two offices.
     */
    phoneNumberId: text('phone_number_id').notNull(),
    /** The E.164 number a person reads on the screen — Kapso's `display_phone_number`. */
    displayNumber: text('display_number'),
    /** A human label for the settings list — "DXB sales", "KWI ops". */
    label: text('label'),
    isActive: boolean('is_active').notNull().default(true),
    /** When a message last arrived here, so the screen can flag a number gone quiet. */
    lastMessageAt: tsz('last_message_at'),
    ...timestamps,
  },
  (t) => [
    index('whatsapp_numbers_branch_idx').on(t.branchId, t.isActive),
    /*
      One row per phone-number id.

      Branch resolution matches on this column, so a second row for the same
      number would make "which office owns this message" ambiguous — the same
      failure `mailboxes_address_unique` guards against for a re-polled mailbox.
    */
    unique('whatsapp_numbers_phone_number_id_unique').on(t.phoneNumberId),
  ],
)

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
    /**
     * Separate from `dispatched_at`, because two channels read this table.
     *
     * An event becomes email *and* outbound webhooks (FR-AD-06), and the two
     * run independently: mail can be deferred by quiet hours while a webhook
     * fires immediately, and a webhook subscriber can be down while mail
     * leaves normally. One column for both would make either channel's
     * progress mark the event finished for the other — so an event dispatched
     * as mail would never reach a subscriber, silently.
     *
     * Stamped even when nothing subscribes, so an event with no endpoints is
     * examined once rather than on every sweep for ever.
     */
    webhooksExpandedAt: tsz('webhooks_expanded_at'),
    ...timestamps,
  },
  (t) => [
    index('notification_outbox_pending_idx').on(t.dispatchedAt, t.createdAt),
    // The webhook expander's whole query: unexpanded, oldest first.
    index('notification_outbox_webhooks_idx').on(t.webhooksExpandedAt, t.createdAt),
  ],
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
