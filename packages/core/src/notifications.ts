/**
 * The notification catalogue — FR-NT-01, FR-NT-03, FR-NT-04.
 *
 * Nine events are *required*; two more already existed. Until this file, they
 * agreed with nothing: a raiser wrote `event_key` as a string literal, a
 * template row would have carried another string literal, and the only place
 * the two met was the dispatcher's template lookup — at send time, in
 * production, where a mismatch is recorded as `failed: no template` against a
 * recipient who is simply never told.
 *
 * That is the same class of fault as the invented milestone codes: the code
 * looked wired up, logged cleanly, and delivered nothing. The fix is the same
 * one — a single declared vocabulary that both ends are checked against.
 *
 * ## Why this is in `core` and not in `db`
 *
 * Three populations need it and they do not share a package. `apps/web` raises
 * most of these from server actions, `apps/service` raises the scheduled ones
 * and consumes all of them in the dispatcher, and `packages/db` seeds the
 * template rows. `core` is the only thing all three already depend on, and
 * this is what `core` is for: rules with no I/O under them.
 *
 * ## Audience is part of the event, not of the send
 *
 * `audience` decides *who a thing is about*, which is not a channel question
 * and not a template question. An SLA breach is an internal alarm; an invoice
 * becoming overdue is a letter to a customer. Sending the first to a customer
 * contact is an embarrassment and sending the second only to staff is a
 * business failure, so the answer is declared once, here, rather than being
 * re-derived at each of eleven raise sites.
 *
 * This closes a real hole. The dispatcher resolved recipients as *"active
 * principals, narrowed by customer where the event names one"* — and where it
 * named none, the narrowing silently disappeared and the audience became every
 * active principal in the database, portal contacts of unrelated customers
 * included. `enquiry.sla_breached` carries no customer.
 */

/** Who an event is for. Recipient resolution reads this and nothing else. */
export type NotificationAudience = 'customer' | 'internal'

export interface NotificationEvent {
  /** `noun.verb`, past tense. Matches `notification_outbox.event_key`. */
  readonly key: string
  readonly audience: NotificationAudience
  /** The SRS clause this exists to satisfy. */
  readonly requirement: string
  /** What it is, for the template editor an administrator uses (FR-NT-03). */
  readonly summary: string
  /**
   * The merge fields a raiser must put in `payload`.
   *
   * Declared rather than discovered, because `renderTemplate` substitutes an
   * unknown field with an empty string — a template reading "Quotation
   * expires on " is worse than one that fails, and only a declared list can
   * catch it before a customer reads it.
   */
  readonly fields: readonly string[]
}

/**
 * Fields every template may use, supplied by the dispatcher rather than by the
 * raiser.
 *
 * Both are things only the *send* knows. `recipientName` is the contact being
 * written to, and a notification that opens "Dear Customer" reads as bulk mail
 * from a company the customer has a named account manager at. `senderName` is
 * the branch's own legal name in the recipient's language — this product sells
 * multi-entity (§5.3), so a Dubai shipment must not sign off as the Kuwait
 * company, and hard-coding either into twenty-two template rows would make the
 * second entity a copy-editing job.
 *
 * Declaring them here is what stops `unknownMergeFields` rejecting a template
 * that uses them.
 */
export const UNIVERSAL_MERGE_FIELDS: readonly string[] = ['recipientName', 'senderName']

function event(e: NotificationEvent): NotificationEvent {
  return e
}

export const NOTIFICATION_EVENTS: readonly NotificationEvent[] = [
  // --- enquiry -------------------------------------------------------------
  event({
    key: 'enquiry.created',
    audience: 'internal',
    requirement: 'FR-EQ-01',
    summary: 'A new enquiry has arrived and needs an owner.',
    fields: ['reference'],
  }),
  event({
    key: 'enquiry.sla_breached',
    audience: 'internal',
    requirement: 'FR-EQ-13',
    summary: 'First response is past its SLA.',
    fields: ['reference'],
  }),

  // --- quote ---------------------------------------------------------------
  event({
    key: 'quote.sent',
    audience: 'customer',
    requirement: 'FR-NT-01',
    summary: 'A quotation has been sent to the customer.',
    fields: ['reference', 'total', 'currency', 'validUntil'],
  }),
  event({
    key: 'quote.expiring',
    audience: 'customer',
    requirement: 'FR-NT-01',
    summary: 'A sent quotation reaches the end of its validity soon.',
    fields: ['reference', 'validUntil', 'daysRemaining'],
  }),

  // --- job -----------------------------------------------------------------
  event({
    key: 'job.created',
    audience: 'customer',
    requirement: 'FR-NT-01',
    summary: 'A shipment has been booked.',
    fields: ['reference', 'mode'],
  }),
  event({
    key: 'job.milestone_reached',
    audience: 'customer',
    requirement: 'FR-NT-01',
    summary: 'A shipment milestone has been completed.',
    fields: ['reference', 'milestone', 'milestoneAr', 'reachedAt'],
  }),
  event({
    key: 'job.eta_changed',
    audience: 'customer',
    requirement: 'FR-NT-01',
    summary: 'The estimated arrival of a shipment has moved.',
    fields: ['reference', 'previousEta', 'eta'],
  }),

  /*
    Free time, warned before it costs rather than billed after it has.

    Internal, and that is the whole decision. The nightly accrual beside it
    tells the customer nothing and bills us correctly; this one is aimed at the
    person who can still move the container. Sending it to the customer would
    read as an invoice threat for a cost that has not been incurred, on a
    deadline most of them cannot act on anyway — the haulier is ours.
  */
  event({
    key: 'free_time.expiring',
    audience: 'internal',
    requirement: 'FR-JB-08',
    summary: 'A container is about to start accruing demurrage, detention or storage.',
    fields: [
      'reference',
      'kind',
      'containerNo',
      'daysRemaining',
      'expiresOn',
      'perDiem',
      'currency',
    ],
  }),

  /*
    Coverage about to be lost, told to the desk that can renew it.

    Internal for a reason that is not obvious: a rate card names a partner, and
    a partner has portal principals. Sending "your tariff with us expires in
    eleven days" to the agent is a negotiating position handed over by a cron
    job — and the buy rate on the card is our cost, which is not theirs to see.
  */
  event({
    key: 'rate_card.expiring',
    audience: 'internal',
    requirement: 'FR-RT-11',
    summary: 'Rate cards reach the end of their validity within the month.',
    fields: ['asOf', 'count', 'horizonDays', 'soonest', 'lanes', 'lanesAr'],
  }),

  // --- exception -----------------------------------------------------------
  event({
    key: 'exception.opened',
    audience: 'internal',
    requirement: 'FR-NT-01',
    summary: 'An exception has been raised against a shipment.',
    fields: ['reference', 'severity', 'description'],
  }),

  // --- document ------------------------------------------------------------
  event({
    key: 'document.released',
    audience: 'customer',
    requirement: 'FR-NT-01',
    summary: 'A document has been released to the customer.',
    fields: ['reference', 'documentType', 'documentTypeAr'],
  }),

  // --- invoice -------------------------------------------------------------
  event({
    key: 'invoice.issued',
    audience: 'customer',
    requirement: 'FR-NT-01',
    summary: 'An invoice has been issued.',
    fields: ['seriesNo', 'total', 'currency', 'dueOn'],
  }),
  event({
    key: 'invoice.overdue',
    audience: 'customer',
    requirement: 'FR-NT-01',
    summary: 'An issued invoice has passed its due date unpaid.',
    fields: ['seriesNo', 'total', 'currency', 'dueOn', 'daysOverdue'],
  }),
]

const BY_KEY = new Map(NOTIFICATION_EVENTS.map((e) => [e.key, e]))

/** Every declared key. The seed iterates this so no event goes untemplated. */
export function notificationEventKeys(): string[] {
  return NOTIFICATION_EVENTS.map((e) => e.key)
}

export function notificationEvent(key: string): NotificationEvent | undefined {
  return BY_KEY.get(key)
}

// --- whether an event sends on a channel at all -----------------------------

/**
 * One row of `notification_channel_settings`, as this module needs it.
 *
 * Structural rather than imported, because `core` depends on nothing — the
 * dispatcher and the settings screen both pass their own rows in.
 */
export interface NotificationSwitch {
  /** Null is the master switch for the channel; a key narrows it to an event. */
  readonly eventKey: string | null
  readonly channel: string
  readonly isEnabled: boolean
}

export type ChannelDecision =
  | { readonly enabled: true }
  /** Recorded verbatim in `notification_deliveries.suppressed_reason`. */
  | { readonly enabled: false; readonly reason: string }

const ON: ChannelDecision = { enabled: true }

/**
 * May this event send on this channel?
 *
 * Two switches, master first: turning the channel off silences everything on
 * it regardless of the per-event rows, so an administrator stopping mail
 * during a relay migration does not have to also find and clear thirteen
 * toggles — and does not have to remember to restore them afterwards.
 *
 * **Absence is on.** A deployment with no rows sends everything, which is what
 * every deployment did before this table existed. Only an explicit `false`
 * silences anything, so a failed read or an empty table can never quietly
 * become a communications blackout — the failure mode of a default-off switch
 * is silence, and silence is indistinguishable from working.
 *
 * The reason is returned rather than logged because it is written to the
 * delivery row: FR-NT-06's log has to say *why* something was held back, and
 * "off" and "the customer opted out" are answers to different questions from
 * the person reading it.
 */
export function channelDecision(
  switches: readonly NotificationSwitch[],
  eventKey: string,
  channel: string,
): ChannelDecision {
  const onChannel = switches.filter((s) => s.channel === channel)

  const master = onChannel.find((s) => s.eventKey === null)
  if (master && !master.isEnabled) return { enabled: false, reason: `${channel} is switched off` }

  const event = onChannel.find((s) => s.eventKey === eventKey)
  if (event && !event.isEnabled) {
    return { enabled: false, reason: `${eventKey} is switched off for ${channel}` }
  }

  return ON
}

/**
 * `{{field}}` substitution.
 *
 * Deliberately dumb, because templates are rows an administrator edits
 * (FR-NT-03) and anything cleverer is a language they did not agree to learn.
 * It is also why nothing here interprets HTML: the mail this produces is
 * `text/plain`, so a merge field carrying an apostrophe or an angle bracket is
 * a character rather than an injection.
 */
export function renderTemplate(template: string, payload: Record<string, unknown>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
    const value = payload[key]
    return value === undefined || value === null ? '' : String(value)
  })
}

/** Which `{{fields}}` a template body uses. */
export function mergeFields(template: string): string[] {
  return [...new Set([...template.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]!))]
}

/**
 * Fields a template asks for that the event does not declare.
 *
 * The check an administrator's template edit needs before it is saved, and the
 * check the seed's own test runs: a template referring to `{{amount}}` when the
 * event carries `{{total}}` renders an empty gap in a customer's inbox, and
 * nothing downstream of it is capable of noticing.
 */
export function unknownMergeFields(eventKey: string, template: string): string[] {
  const declared = BY_KEY.get(eventKey)?.fields
  if (!declared) return mergeFields(template)
  return mergeFields(template).filter(
    (f) => !declared.includes(f) && !UNIVERSAL_MERGE_FIELDS.includes(f),
  )
}
