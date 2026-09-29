/**
 * Reading a broker's rate reply into `rate_requests.response` — FR-RT-10, `rate_extract`.
 *
 * This is the far end of rate procurement, and it is the twin of
 * `invoice-extract`: a document arrives from an agent, a model reads it into
 * charge lines, and the same importer that validates a CSV validates those.
 * `extraction.ts` in core does the reading and welds our lane onto the model's
 * charges; this worker does the I/O around it — loads the reply and its
 * attachments, prices the result against the enquiry so the comparison view has
 * something to rank on, and writes it back.
 *
 * ## It proposes; a person accepts
 *
 * Nothing here writes a rate card. The parsed lines land in
 * `rate_requests.response`, the request moves to `parsed`, and a coordinator
 * accepts them on the enquiry screen — where `groupRateCards` folds them into a
 * buy card under *their* actor, an ordinary audited write. That is the same
 * rule `enquiry-extract` and `invoice-extract` obey: a model fills the blank, a
 * person's answer wins, and the audit trail answers *who awarded this rate*.
 *
 * ## The lane is ours, not the model's
 *
 * We emailed this broker about one enquiry. Origin, destination and mode come
 * from that enquiry, already resolved to codes; the model reads only the
 * charges. `readExtractedRateReply` enforces this — see its header — and a lane
 * the reply *claims* that disagrees with ours is surfaced, never acted on.
 */

import { eq } from 'drizzle-orm'
import {
  assets,
  enquiries,
  inSeries,
  locations,
  messageAttachments,
  messages,
  rateCards,
  rateRequests,
  chargeTypes,
  currencies,
  systemActor,
  withActor,
  type Actor,
  type Tx,
} from '@qabandi/db'
import {
  parseModelJson,
  readExtractedRateReply,
  summariseRateReply,
  BASES,
  RATE_EXTRACTION_SCHEMA,
  type ChargeContext,
  type RateReplyLane,
} from '@qabandi/core'
import type { ImportLookups } from '@qabandi/core/import'
import { invoke } from '../ai/ledger'
import {
  RATE_EXTRACT_PROMPT_VERSION,
  RATE_EXTRACT_USER_PROMPT,
  rateExtractSystemPrompt,
} from '../ai/prompts'
import { fileStore } from '../adapters/index'
import { documentPart } from './invoice-extract'

/** The same ceiling `invoice-extract` uses; a broker's tariff is the same kind of scan. */
const MAX_DOCUMENT_BYTES = 20 * 1024 * 1024

/** How much reply body is worth sending — a quoted chain is mostly signature. */
const MAX_BODY_CHARS = 24_000

export interface ExtractRateReplyInput {
  readonly branchId: string
  /** The `rate_requests` row this reply answers. */
  readonly rateRequestId: string
  /** The inbound `messages` row the reply arrived on. */
  readonly messageId: string
}

export interface ExtractRateReplyResult {
  readonly invocationId?: string
  readonly status: 'parsed' | 'declined'
  /** Rate lines that validated. */
  readonly lines: number
  /** Lines the reply carried that failed a parser or a lookup. */
  readonly rejected: number
  /** Why nothing happened, in one line, where nothing did. */
  readonly skipped?: string
}

/**
 * Read one broker's reply.
 *
 * Returns rather than throws for every *expected* absence — the request or its
 * message gone, an enquiry whose lane has no coded port to key a card by, a
 * model that is not configured. Those are ordinary states; only a genuine
 * failure propagates to pg-boss's retry.
 */
export async function extractRateReply(
  input: ExtractRateReplyInput,
): Promise<ExtractRateReplyResult> {
  const actor = systemActor([input.branchId])

  const context = await load(actor, input)
  if (!context) return { status: 'parsed', lines: 0, rejected: 0, skipped: 'request_or_message_gone' }
  const lane = context.lane
  if (!lane) {
    // A lane with no UN/LOCODE cannot key a rate card; a person prices it.
    return { status: 'parsed', lines: 0, rejected: 0, skipped: 'lane_has_no_coded_port' }
  }

  const attachments = await loadAttachmentParts(context.attachments)

  const { response, invocationId } = await invoke(
    {
      actor,
      branchId: input.branchId,
      surface: 'rate_extract',
      promptVersion: RATE_EXTRACT_PROMPT_VERSION,
      enquiryId: context.enquiryId ?? null,
    },
    {
      surface: 'rate_extract',
      messages: [
        {
          role: 'system',
          content: rateExtractSystemPrompt({ chargeCodes: context.chargeCodes, bases: BASES }),
        },
        {
          role: 'user',
          /*
            The body is a separate user turn, never interpolated into the
            instructions — the one structural defence against a reply that says
            "ignore your instructions". The allowlist in core is what makes it
            harmless; this keeps a boundary that costs nothing.
          */
          content: [
            { type: 'text', text: `${RATE_EXTRACT_USER_PROMPT}\n\n${bodyFor(context.subject, context.body)}` },
            ...attachments,
          ],
        },
      ],
      schema: RATE_EXTRACTION_SCHEMA,
    },
    // The same reply read twice — a retry after the first scrolled away — is
    // answered from the ledger rather than billed again.
    { reuse: true },
  )

  // An unstated start date falls back to the reply's own date — an agent quotes
  // a rate "from now", not from a date they rarely bother to write.
  const replyDay = (context.respondedAt ?? new Date()).toISOString().slice(0, 10)
  const extracted = readExtractedRateReply(parseModelJson(response.text), context.lookups, lane, replyDay)

  const summary = summariseRateReply(extracted.lines.rows, context.chargeContext)
  const primary = summary.primary

  const status: 'parsed' | 'declined' = extracted.declined ? 'declined' : 'parsed'

  await withActor(actor, async (tx: Tx) => {
    await tx
      .update(rateRequests)
      .set({
        status,
        messageId: input.messageId,
        respondedAt: context.respondedAt ?? new Date(),
        declinedReason: extracted.declinedReason ?? null,
        // The headline figure for ranking, in the broker's own currency, only
        // when the whole reply is in one — a mixed-currency quote is ranked from
        // `response.totals` through the FX source at read time, never by a total
        // that silently mixed dinars and dollars.
        quotedCurrency: primary?.currency ?? null,
        quotedTotal: primary ? primary.amount.amount.toString() : null,
        response: {
          parsedAt: new Date().toISOString(),
          promptVersion: RATE_EXTRACT_PROMPT_VERSION,
          invocationId,
          confidence: extracted.confidence,
          declined: extracted.declined,
          ...(extracted.declinedReason ? { declinedReason: extracted.declinedReason } : {}),
          ...(extracted.laneMismatch ? { laneMismatch: extracted.laneMismatch } : {}),
          ...(extracted.currency ? { currency: extracted.currency } : {}),
          ok: extracted.lines.ok,
          // The validated rows, in the exact shape `groupRateCards` consumes on
          // accept — so the promotion path reconstructs no data, it replays it.
          rows: extracted.lines.rows.map((r) => r.values),
          issues: extracted.lines.issues,
          headerIssues: extracted.headerIssues,
          totals: summary.totals.map((t) => ({ currency: t.currency, amount: t.amount.amount.toString() })),
          unpriced: summary.unpriced,
        },
      })
      .where(eq(rateRequests.id, input.rateRequestId))
  })

  return {
    invocationId,
    status,
    lines: extracted.lines.rows.length,
    rejected: extracted.lines.issues.length,
  }
}

interface Loaded {
  readonly enquiryId: string | null
  readonly subject: string | null
  readonly body: string
  readonly respondedAt: Date | null
  readonly lane: RateReplyLane | null
  readonly chargeContext: ChargeContext
  readonly attachments: readonly AttachmentRow[]
  readonly lookups: ImportLookups
  readonly chargeCodes: readonly string[]
}

interface AttachmentRow {
  readonly storageKey: string
  readonly contentType: string
  readonly fileName: string
}

/**
 * The request, its reply, the enquiry's lane, and the reference sets.
 *
 * Read under the branch's system actor, so a model is never shown a lane or a
 * charge vocabulary the request's own branch could not see. `inSeries` rather
 * than `Promise.all` for the reason `actor.ts` gives: one transaction is one
 * connection and runs one statement at a time.
 */
async function load(actor: Actor, input: ExtractRateReplyInput): Promise<Loaded | null> {
  return withActor(actor, async (tx: Tx) => {
    const [request, message, atts, codes, money, locs] = await inSeries([
      () =>
        tx
          .select({
            enquiryId: rateRequests.enquiryId,
            sourceRateCardId: rateRequests.sourceRateCardId,
            respondedAt: rateRequests.respondedAt,
          })
          .from(rateRequests)
          .where(eq(rateRequests.id, input.rateRequestId))
          .limit(1),
      () =>
        tx
          .select({ subject: messages.subject, body: messages.body })
          .from(messages)
          .where(eq(messages.id, input.messageId))
          .limit(1),
      () =>
        tx
          .select({
            storageKey: assets.storageKey,
            contentType: assets.contentType,
            fileName: assets.fileName,
          })
          .from(messageAttachments)
          .innerJoin(assets, eq(messageAttachments.assetId, assets.id))
          .where(eq(messageAttachments.messageId, input.messageId)),
      () =>
        tx
          .select({ key: chargeTypes.key })
          .from(chargeTypes)
          .where(eq(chargeTypes.isActive, true)),
      () => tx.select({ code: currencies.code }).from(currencies),
      () =>
        tx
          .select({ unlocode: locations.unlocode })
          .from(locations)
          .where(eq(locations.isActive, true)),
    ])

    const req = request[0]
    const mail = message[0]
    if (!req || !mail) return null

    // The lane comes from the enquiry we asked about, or — for a renewal RFQ with
    // no enquiry — from the expiring card it renews. A refresh carries no cargo,
    // so its pricing context is empty and its lines price only what needs no
    // quantity; that is fine, because a renewal is accepted to keep cover, not
    // ranked against rivals.
    const lane = req.enquiryId
      ? await laneFor(tx, req.enquiryId)
      : req.sourceRateCardId
        ? await cardLaneFor(tx, req.sourceRateCardId)
        : { lane: null }
    const chargeContext = req.enquiryId ? await contextFor(tx, req.enquiryId) : {}

    const chargeCodes = codes.map((c: { key: string }) => c.key)

    return {
      enquiryId: req.enquiryId,
      subject: mail.subject,
      body: mail.body,
      respondedAt: req.respondedAt,
      lane: lane?.lane ?? null,
      chargeContext,
      attachments: atts,
      lookups: {
        locations: new Set(
          locs
            .map((l: { unlocode: string | null }) => l.unlocode)
            .filter((c: string | null): c is string => Boolean(c))
            .map((c: string) => c.toUpperCase()),
        ),
        chargeTypes: new Set(chargeCodes.map((k: string) => k.toUpperCase())),
        currencies: new Set(money.map((m: { code: string }) => m.code.toUpperCase())),
      },
      chargeCodes,
    }
  })
}

/**
 * The lane we asked about — mode and the two coded ports.
 *
 * Returns a lane only when both ends have a UN/LOCODE, because a rate card is
 * keyed by code; a port with no code cannot become a card, and the caller skips
 * rather than storing a lane it can never promote.
 */
async function laneFor(tx: Tx, enquiryId: string): Promise<{ lane: RateReplyLane | null }> {
  const rows = await tx
    .select({
      mode: enquiries.mode,
      originId: enquiries.originId,
      destinationId: enquiries.destinationId,
    })
    .from(enquiries)
    .where(eq(enquiries.id, enquiryId))
    .limit(1)
  const e = rows[0]
  if (!e || !e.mode || !e.originId || !e.destinationId) return { lane: null }

  const [o, d] = await inSeries([
    () => tx.select({ code: locations.unlocode }).from(locations).where(eq(locations.id, e.originId!)).limit(1),
    () =>
      tx
        .select({ code: locations.unlocode })
        .from(locations)
        .where(eq(locations.id, e.destinationId!))
        .limit(1),
  ])
  const originCode = o[0]?.code
  const destinationCode = d[0]?.code
  if (!originCode || !destinationCode) return { lane: null }

  return { lane: { mode: e.mode, originCode, destinationCode } }
}

/**
 * The lane a renewal RFQ is about — read from the card it renews.
 *
 * The refresh sweep sets `source_rate_card_id` in place of an enquiry, and the
 * card already holds the mode and the two coded ports. Same rule as the enquiry
 * side: no UN/LOCODE, no card, so the caller skips rather than store a lane it
 * can never promote back.
 */
async function cardLaneFor(tx: Tx, rateCardId: string): Promise<{ lane: RateReplyLane | null }> {
  const rows = await tx
    .select({ mode: rateCards.mode, originId: rateCards.originId, destinationId: rateCards.destinationId })
    .from(rateCards)
    .where(eq(rateCards.id, rateCardId))
    .limit(1)
  const c = rows[0]
  if (!c || !c.mode || !c.originId || !c.destinationId) return { lane: null }

  const [o, d] = await inSeries([
    () => tx.select({ code: locations.unlocode }).from(locations).where(eq(locations.id, c.originId!)).limit(1),
    () =>
      tx.select({ code: locations.unlocode }).from(locations).where(eq(locations.id, c.destinationId!)).limit(1),
  ])
  const originCode = o[0]?.code
  const destinationCode = d[0]?.code
  if (!originCode || !destinationCode) return { lane: null }

  return { lane: { mode: c.mode, originCode, destinationCode } }
}

/**
 * The quantities a rate is priced against, from the enquiry.
 *
 * Approximate by design, and the schema comment on `quoted_total` says why: the
 * figure this produces is a *sort key* for the comparison view, not the quote.
 * The authoritative price is struck later, when a person accepts a reply and
 * `priceEnquiry` runs against the promoted card. So `pieces` doubles as the
 * container count on an FCL lane the way `pricing.ts` already reads it, weight
 * is the gross, and a `percent` line — which needs a base this context cannot
 * supply — is counted as unpriced rather than guessed.
 */
async function contextFor(tx: Tx, enquiryId: string): Promise<ChargeContext> {
  const rows = await tx
    .select({
      mode: enquiries.mode,
      grossWeightKg: enquiries.grossWeightKg,
      pieces: enquiries.pieces,
    })
    .from(enquiries)
    .where(eq(enquiries.id, enquiryId))
    .limit(1)
  const e = rows[0]
  if (!e) return {}

  const pieces = e.pieces ?? undefined
  const ctx: ChargeContext = {}
  if (e.grossWeightKg != null) Object.assign(ctx, { kg: e.grossWeightKg })
  if (pieces != null) {
    Object.assign(ctx, { units: pieces })
    if (e.mode === 'sea_fcl') Object.assign(ctx, { containers: pieces })
  }
  return ctx
}

async function loadAttachmentParts(rows: readonly AttachmentRow[]) {
  const store = await fileStore()
  const parts = []
  for (const row of rows) {
    try {
      const bytes = await store.get(row.storageKey)
      if (bytes.byteLength > MAX_DOCUMENT_BYTES) continue
      parts.push(documentPart(bytes, row.contentType, row.fileName))
    } catch {
      // A `.docx` tariff or an unreadable blob is skipped, not fatal: the body
      // usually carries the rate anyway, and a person sees the attachment on the
      // message. Refusing the whole reply over one bad file is the wrong trade.
    }
  }
  return parts
}

function bodyFor(subject: string | null, body: string): string {
  const trimmed = body.length > MAX_BODY_CHARS ? `${body.slice(0, MAX_BODY_CHARS)}\n[truncated]` : body
  return subject ? `Subject: ${subject}\n\n${trimmed}` : trimmed
}
