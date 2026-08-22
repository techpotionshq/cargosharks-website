/**
 * The provider half of `InboundMailSource` — FR-EQ-02, §9 "Email — inbound".
 *
 * `/webhooks/email` has verified a signature, recorded a receipt and queued a
 * job since Release One, and until now nothing consumed the queue. That is the
 * worst shape a gap can take: the route answers `202 accepted`, the provider
 * stops retrying because it was told the message was taken, the row lands in
 * `inbound_webhook_events` looking exactly like a processed one, and the
 * enquiry never appears. A deployment fed by a provider webhook was dropping
 * its front door on the floor and reporting success while it did.
 *
 * This is the missing half, and it is deliberately small: parse the receipt
 * into an `InboundMessage` and hand it to `ingestMessage`. Everything about
 * *what becomes an enquiry* — attribution, threading, the SLA clock, the
 * attachments, the AI enrichment enqueued after the commit — already exists
 * and is already tested against a real database. Writing any of it twice is
 * how the two paths start disagreeing about whose mail belongs to whom.
 *
 * ## The receipt is claimed by the route, not here
 *
 * `enqueueOnce` inserts the row and enqueues in one transaction, so a crash
 * between the two cannot leave a recorded-but-unqueued event. That insert is
 * the idempotency claim, so this worker passes it to `ingestMessage` rather
 * than letting a second one be taken — see the `claimed` parameter there.
 *
 * ## Two payload shapes, and a refusal for everything else
 *
 * A "provider receipt" is not a standard. Postmark, Resend, SES and Mailgun
 * each post their own JSON, and guessing at a shape we have never seen is how
 * a customer's mail gets filed under the wrong sender. So exactly two shapes
 * are read — Postmark's, because it is the most widely deployed inbound-parse
 * webhook, and a documented neutral one for everybody else — and anything
 * unrecognised throws with the keys it actually saw. A refusal leaves the
 * receipt unprocessed with the reason recorded, which is a row somebody can
 * find; a lenient parse produces an enquiry attributed to nobody, which is a
 * row nobody questions.
 *
 * The neutral shape, for a provider not listed above (post this to
 * `/webhooks/email` from a small adapter of your own):
 *
 *     {
 *       "messageId":  "<CAF…@mail.gmail.com>",   // RFC 5322 Message-ID
 *       "mailbox":    "freight@example.com",     // which of ours received it
 *       "from":       "shipper@customer.com",
 *       "fromName":   "Faisal Al-Rashid",        // optional
 *       "to":         ["freight@example.com"],
 *       "cc":         [],                        // optional
 *       "subject":    "RFQ 2x40HC Shanghai to Shuwaikh",
 *       "text":       "…",                       // plain text, never HTML
 *       "receivedAt": "2026-08-22T09:14:00Z",    // optional, defaults to now
 *       "inReplyTo":  null,                      // optional
 *       "references": [],                        // optional
 *       "attachments": [                         // optional
 *         { "filename": "packing-list.pdf",
 *           "contentType": "application/pdf",
 *           "contentBase64": "JVBER…" }
 *       ]
 *     }
 */

import { eq } from 'drizzle-orm'
import { inboundWebhookEvents, systemActor, withActor } from '@qabandi/db'
import type { InboundAttachment, InboundMessage } from '../ports/index'
import { ingestMessage, resolveBranches, type EnqueueExtraction } from './inbound-mail'

export interface InboundEmailWebhookInput {
  /** `inbound_webhook_events.id`, as queued by `/webhooks/email`. */
  readonly eventId: string
}

export interface InboundEmailWebhookResult {
  readonly outcome: 'created' | 'threaded' | 'duplicate' | 'ignored' | 'skipped'
  readonly enquiryId?: string | null
  /** Why nothing happened, where nothing did. */
  readonly reason?: string
}

/**
 * Turn one recorded provider receipt into an enquiry or a threaded message.
 *
 * Throws on anything retrying could fix — an unreadable payload is *not* one
 * of those and is reported instead, because the same bytes will be just as
 * unreadable five attempts later and pg-boss's backoff would only delay the
 * moment somebody looks at it.
 */
export async function runInboundEmailWebhook(
  input: InboundEmailWebhookInput,
  asOf = new Date(),
  enqueue?: EnqueueExtraction,
): Promise<InboundEmailWebhookResult> {
  const [event] = await withActor(systemActor(), async (tx) =>
    tx
      .select({
        id: inboundWebhookEvents.id,
        payload: inboundWebhookEvents.payload,
        processedAt: inboundWebhookEvents.processedAt,
      })
      .from(inboundWebhookEvents)
      .where(eq(inboundWebhookEvents.id, input.eventId))
      .limit(1),
  )

  if (!event) return { outcome: 'skipped', reason: 'receipt_not_found' }
  if (event.processedAt) return { outcome: 'duplicate', reason: 'already_processed' }

  let message: InboundMessage
  try {
    message = toInboundMessage(event.payload as Record<string, unknown>, asOf)
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    await note(event.id, reason, asOf)
    return { outcome: 'skipped', reason }
  }

  const branch = (await resolveBranches()).get(message.mailbox)
  if (!branch) {
    /*
      No active mailbox row matches the address the provider says received it.

      Recorded and skipped rather than thrown, and that differs from the poll
      on purpose. The poll reaches a mailbox *because* a row configured it, so
      a missing row there means one was deactivated mid-run and retrying is
      right. A webhook can be posted for any address at all, including one this
      deployment has never held, and retrying that five times a day forever is
      noise around a configuration decision somebody has to make.
    */
    const reason =
      `No active mailbox is configured for ${message.mailbox}, so there is no branch ` +
      'to file its mail under. Add it at Settings › Mailboxes.'
    await note(event.id, reason, asOf)
    return { outcome: 'skipped', reason }
  }

  const handled = await ingestMessage(message, branch, asOf, enqueue, { id: event.id })
  return { outcome: handled.outcome, enquiryId: handled.enquiryId }
}

/** Records why a receipt was not turned into anything, without failing the job. */
async function note(id: string, reason: string, asOf: Date): Promise<void> {
  await withActor(systemActor(), async (tx) => {
    await tx
      .update(inboundWebhookEvents)
      .set({ error: reason, updatedAt: asOf })
      .where(eq(inboundWebhookEvents.id, id))
  })
}

/**
 * A provider's JSON, read into the shape both halves of the port speak.
 *
 * Exported for its own tests: this is the only function in the file with
 * branches worth pinning, and pinning them needs no database.
 */
export function toInboundMessage(
  payload: Record<string, unknown>,
  asOf: Date,
): InboundMessage {
  if (looksPostmark(payload)) return fromPostmark(payload, asOf)
  if (looksNeutral(payload)) return fromNeutral(payload, asOf)

  throw new Error(
    'The receipt is not a shape this deployment can read. Expected Postmark’s ' +
      'inbound JSON or the neutral shape documented in ' +
      '`workers/inbound-email-webhook.ts`. Keys seen: ' +
      Object.keys(payload).slice(0, 20).join(', '),
  )
}

const looksPostmark = (p: Record<string, unknown>): boolean =>
  typeof p.From === 'string' && (typeof p.TextBody === 'string' || typeof p.HtmlBody === 'string')

const looksNeutral = (p: Record<string, unknown>): boolean =>
  typeof p.from === 'string' && typeof p.mailbox === 'string'

function fromPostmark(p: Record<string, unknown>, asOf: Date): InboundMessage {
  const toFull = asRecords(p.ToFull)
  const ccFull = asRecords(p.CcFull)

  /*
    `OriginalRecipient` first, because that is the address the mail was
    *delivered* to. `To` is what the sender typed, and the two differ exactly
    when it matters — a forwarding address, an alias, or a mail that reached us
    on Bcc — and matching a branch on the sender's typing rather than on the
    envelope is how mail lands in the wrong office.
  */
  const mailbox =
    str(p.OriginalRecipient) ||
    str(toFull[0]?.Email) ||
    firstAddress(str(p.To)) ||
    ''

  if (mailbox === '') {
    throw new Error('The Postmark receipt names no recipient, so no branch can own it.')
  }

  return {
    externalId: requireMessageId(str(p.MessageID)),
    mailbox,
    from: firstAddress(str(p.From)),
    fromName: str(p.FromName) || undefined,
    to: toFull.map((r) => str(r.Email)).filter(Boolean),
    cc: ccFull.map((r) => str(r.Email)).filter(Boolean),
    subject: str(p.Subject),
    /*
      Plain text only. `InboundMessage` says HTML is flattened by the adapter
      and never stored as HTML, and Postmark hands us both — so the text part
      is taken when present and the HTML is stripped rather than trusted.
    */
    body: str(p.TextBody) || flatten(str(p.HtmlBody)),
    receivedAt: date(str(p.Date), asOf),
    inReplyTo: headerOf(p.Headers, 'In-Reply-To') || undefined,
    references: splitReferences(headerOf(p.Headers, 'References')),
    automatic: automaticByHeaders(p.Headers),
    attachments: asRecords(p.Attachments).map(
      (a): InboundAttachment => ({
        filename: str(a.Name) || 'attachment',
        contentType: str(a.ContentType) || 'application/octet-stream',
        content: Buffer.from(str(a.Content), 'base64'),
      }),
    ),
  }
}

function fromNeutral(p: Record<string, unknown>, asOf: Date): InboundMessage {
  return {
    externalId: requireMessageId(str(p.messageId)),
    mailbox: str(p.mailbox),
    from: firstAddress(str(p.from)),
    fromName: str(p.fromName) || undefined,
    to: strings(p.to),
    cc: strings(p.cc),
    subject: str(p.subject),
    body: str(p.text),
    receivedAt: date(str(p.receivedAt), asOf),
    inReplyTo: str(p.inReplyTo) || undefined,
    references: strings(p.references),
    // The neutral shape may say so outright; a provider adapter that parsed
    // the headers itself has nowhere else to put the fact.
    automatic: p.automatic === true,
    attachments: asRecords(p.attachments).map(
      (a): InboundAttachment => ({
        filename: str(a.filename) || 'attachment',
        contentType: str(a.contentType) || 'application/octet-stream',
        content: Buffer.from(str(a.contentBase64), 'base64'),
      }),
    ),
  }
}

/**
 * The `Message-ID`, which is the idempotency key and therefore not optional.
 *
 * `InboundMessage` allows an adapter to synthesise one for malformed mail —
 * *"better a stable hash than a new enquiry every minute forever"* — but that
 * synthesis belongs where the raw parts are, and here they are already gone.
 * A provider that posts no message id is a provider whose redeliveries we
 * cannot deduplicate, and refusing says so once rather than quietly opening a
 * second enquiry every time it retries.
 */
function requireMessageId(value: string): string {
  if (value.trim() === '') {
    throw new Error(
      'The receipt carries no Message-ID. Without one a provider’s redelivery ' +
        'cannot be told apart from a second mail, so it is refused rather than ' +
        'risk a duplicate enquiry on every retry.',
    )
  }
  return value.trim()
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '')

const strings = (v: unknown): string[] =>
  Array.isArray(v) ? v.map(str).filter((s) => s !== '') : []

const asRecords = (v: unknown): Record<string, unknown>[] =>
  Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => typeof x === 'object' && x !== null) : []

/** `"Faisal <a@b.com>"` -> `"a@b.com"`. Providers are inconsistent about this. */
function firstAddress(value: string): string {
  const angled = /<([^>]+)>/.exec(value)
  if (angled) return angled[1]!.trim()
  return value.split(',')[0]!.trim()
}

/**
 * The headers that mark mail as machine-sent, read the way the IMAP adapter
 * reads them — so a bounce arriving through a provider is refused by the same
 * rule as one arriving through a poll.
 */
function automaticByHeaders(headers: unknown): boolean {
  const auto = headerOf(headers, 'Auto-Submitted').toLowerCase()
  if (auto !== '' && auto !== 'no') return true
  if (headerOf(headers, 'X-Auto-Response-Suppress') !== '') return true
  const precedence = headerOf(headers, 'Precedence').toLowerCase()
  if (precedence === 'bulk' || precedence === 'junk' || precedence === 'auto_reply') return true
  // A bounce is sent from the null reverse path so it can never itself bounce.
  if (/^<\s*>$/.test(headerOf(headers, 'Return-Path'))) return true
  return false
}

function headerOf(headers: unknown, name: string): string {
  const wanted = name.toLowerCase()
  for (const h of asRecords(headers)) {
    if (str(h.Name).toLowerCase() === wanted) return str(h.Value).trim()
  }
  return ''
}

/** `References:` is whitespace-separated angle-addresses. */
const splitReferences = (value: string): string[] =>
  value.split(/\s+/).map((s) => s.trim()).filter((s) => s !== '')

/**
 * An invalid date becomes the time we processed it, rather than an exception.
 *
 * `received_at` drives the SLA clock, and a provider with a malformed `Date`
 * header should cost us a clock starting a few seconds late — not an enquiry
 * refused over a header nobody reads.
 */
function date(value: string, fallback: Date): Date {
  if (value.trim() === '') return fallback
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? fallback : parsed
}

/**
 * HTML to something a person and a model can both read.
 *
 * Only reached when a provider sent no text part. Deliberately crude — this is
 * not a renderer, it is a last resort so that a mail with no `TextBody` still
 * produces an enquiry with words in it rather than an empty one.
 */
function flatten(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
