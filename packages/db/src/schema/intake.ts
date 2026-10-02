/**
 * The intake agent — debounced conversation turns on inbound enquiries.
 *
 * Four tables, and the split is the design:
 *
 *   intake_settings      per branch: on/off, the debounce windows, patience.
 *   intake_requirements  per branch, per mode: what a complete enquiry states.
 *   intake_conversations one per inbound enquiry: where the agent is with it,
 *                        and when its next turn is due.
 *   intake_turns         one per turn: what it read, what it decided and why.
 *
 * The first two are configuration (FR-AD-03) with the `notification_templates`
 * shape — a row with `branch_id` null is the default the seed writes, and a
 * branch's own row wins over it — so an administrator tunes Kuwait without
 * touching Dubai and without a release. The last two are business state, and
 * the turn log is append-only by intent: "why did it ask that customer twice?"
 * is answered by reading it, not by reconstructing it from a service log.
 *
 * Why a conversation row rather than pg-boss's own singleton keys: a turn must
 * be pushed back by every new message, survive a restart, and be claimed by
 * exactly one of two service instances. A `turn_due_at` the ingest moves and a
 * `claimed_until` lease the worker takes with `for update skip locked` say all
 * of that in two columns somebody can read with psql; a queue's internal
 * dedupe says it nowhere.
 */

import { sql } from 'drizzle-orm'
import { boolean, check, index, integer, jsonb, text, unique, uuid } from 'drizzle-orm/pg-core'
import { pk, ref, timestamps, tsz } from './columns'
import { pgTable } from './table'
import { modeEnum } from './enums'
import { branches, principals } from './identity'
import { enquiries } from './jobs'
import { messages } from './comms'
import { aiInvocations } from './ai'

/**
 * The agent's settings, one row per branch over a default row.
 *
 * Columns rather than a JSON blob, because each is a number with bounds the
 * settings form validates and `clampIntakeSettings` re-checks, and an audit
 * trail of "quiet window 120 → 30" reads far better than a diff of two blobs.
 */
export const intakeSettings = pgTable(
  'intake_settings',
  {
    id: pk(),
    /** Null is the default every branch without its own row inherits. */
    branchId: ref('branch_id').references(() => branches.id),
    enabled: boolean('enabled').notNull().default(false),
    whatsappQuietSeconds: integer('whatsapp_quiet_seconds').notNull().default(120),
    whatsappMaxWaitSeconds: integer('whatsapp_max_wait_seconds').notNull().default(600),
    emailQuietSeconds: integer('email_quiet_seconds').notNull().default(60),
    emailMaxWaitSeconds: integer('email_max_wait_seconds').notNull().default(600),
    clarifyCooldownHours: integer('clarify_cooldown_hours').notNull().default(6),
    clarifyCap: integer('clarify_cap').notNull().default(2),
    humanTakeoverHours: integer('human_takeover_hours').notNull().default(12),
    ...timestamps,
  },
  (t) => [unique('intake_settings_branch_unique').on(t.branchId).nullsNotDistinct()],
)

/**
 * One thing a complete enquiry must state, for one mode or for all of them.
 *
 * `fields` is an any-of ("weight or volume"), validated against
 * `INTAKE_FIELDS` by the settings action rather than by a constraint, because
 * the list is code and the database cannot see it. Retired with `is_active`,
 * never deleted: "what did Kuwait require in March" is the question behind
 * every complaint that the bot asked for too much.
 */
export const intakeRequirements = pgTable(
  'intake_requirements',
  {
    id: pk(),
    branchId: ref('branch_id').references(() => branches.id),
    /** Null applies to every mode. */
    mode: modeEnum('mode'),
    /** Stable name for the requirement — `origin`, `weightOrVolume`. */
    key: text('key').notNull(),
    fields: jsonb('fields').$type<string[]>().notNull(),
    position: integer('position').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
    ...timestamps,
  },
  (t) => [
    index('intake_requirements_branch_idx').on(t.branchId, t.isActive),
    check('intake_requirements_fields_nonempty', sql`jsonb_array_length(${t.fields}) > 0`),
  ],
)

/**
 * Where the agent is with one inbound enquiry.
 *
 * Opened when a WhatsApp message or an email *creates* an enquiry on a branch
 * whose agent is on — never for an enquiry a coordinator typed, which is a
 * conversation a person is already having.
 *
 * ## The debounce, in three columns
 *
 * `pending_since` is when the first message not yet read by a turn arrived;
 * `turn_due_at` is when the turn may run — a quiet window after the latest
 * message, capped at a maximum wait after `pending_since` (`turnDueAt` in
 * core). Each inbound message moves both, in the same transaction that files
 * it. `claimed_until` is the lease a worker takes to run the turn: a crashed
 * worker's lease expires and the next sweep takes the turn over, and a second
 * instance finds the row locked or leased and moves on.
 */
export const intakeConversations = pgTable(
  'intake_conversations',
  {
    id: pk(),
    branchId: ref('branch_id')
      .notNull()
      .references(() => branches.id),
    enquiryId: ref('enquiry_id')
      .notNull()
      .references(() => enquiries.id),
    /** `whatsapp` or `email` — the channel replies go back on. */
    channel: text('channel').notNull(),
    /** Who to answer: the sender's number or address, as it arrived. */
    customerAddress: text('customer_address').notNull(),
    /** What to answer from: the business `phone_number_id`, or the mailbox address. */
    businessAddress: text('business_address').notNull(),
    /** The customer's language, read from their own messages. Null until a turn has read one. */
    locale: text('locale'),
    /**
     * `collecting` (no turn has run yet, or nothing to ask), `awaiting_customer`
     * (asked, waiting), `complete` (confirmed, ready) or `handed_off` (a person
     * has it after the clarification cap).
     */
    state: text('state').notNull().default('collecting'),
    /** Off is an operator taking the conversation over. */
    agentEnabled: boolean('agent_enabled').notNull().default(true),
    agentToggledById: ref('agent_toggled_by_id').references(() => principals.id),
    agentToggledAt: tsz('agent_toggled_at'),
    pendingSince: tsz('pending_since'),
    turnDueAt: tsz('turn_due_at'),
    claimedUntil: tsz('claimed_until'),
    claimToken: uuid('claim_token'),
    turns: integer('turns').notNull().default(0),
    modelCalls: integer('model_calls').notNull().default(0),
    clarifications: integer('clarifications').notNull().default(0),
    lastClarifiedAt: tsz('last_clarified_at'),
    /**
     * The ready flag: complete, and downstream automation (rate fan-out, quote
     * auto-draft) may act. Set once and never cleared.
     */
    readyAt: tsz('ready_at'),
    handedOffAt: tsz('handed_off_at'),
    /** A staff member wrote to this customer — the human-takeover signal. */
    lastStaffActivityAt: tsz('last_staff_activity_at'),
    lastTurnAt: tsz('last_turn_at'),
    ...timestamps,
  },
  (t) => [
    unique('intake_conversations_enquiry_unique').on(t.enquiryId),
    index('intake_conversations_due_idx').on(t.turnDueAt),
    index('intake_conversations_customer_idx').on(t.branchId, t.customerAddress),
    check(
      'intake_conversations_state_check',
      sql`${t.state} in ('collecting', 'awaiting_customer', 'complete', 'handed_off')`,
    ),
    check('intake_conversations_channel_check', sql`${t.channel} in ('whatsapp', 'email')`),
  ],
)

/**
 * One turn: the messages it read, what it decided, and why.
 *
 * `message_ids` is also what makes a message *read*: a turn's new messages are
 * the customer's messages on the enquiry that no earlier turn names. Recorded
 * before the reply is sent, so a worker that dies mid-send leaves those
 * messages read and the next turn does not answer them twice — at most once is
 * the right failure for a message to a customer.
 */
export const intakeTurns = pgTable(
  'intake_turns',
  {
    id: pk(),
    branchId: ref('branch_id')
      .notNull()
      .references(() => branches.id),
    conversationId: ref('conversation_id')
      .notNull()
      .references(() => intakeConversations.id),
    enquiryId: ref('enquiry_id')
      .notNull()
      .references(() => enquiries.id),
    /** `confirm`, `clarify`, `handoff` or `none`. */
    action: text('action').notNull(),
    /** One of `INTAKE_REASONS` — the word an operator reads. */
    reason: text('reason').notNull(),
    /** The requirement keys still unmet after this turn. */
    missing: jsonb('missing').$type<string[]>().notNull().default([]),
    messageIds: jsonb('message_ids').$type<string[]>().notNull().default([]),
    locale: text('locale'),
    invocationId: ref('invocation_id').references(() => aiInvocations.id),
    /** The outbound message this turn sent, where it sent one. */
    replyMessageId: ref('reply_message_id').references(() => messages.id),
    /** Why a reply that was decided on did not go out — the provider's words. */
    sendError: text('send_error'),
    ...timestamps,
  },
  (t) => [index('intake_turns_conversation_idx').on(t.conversationId, t.createdAt)],
)
