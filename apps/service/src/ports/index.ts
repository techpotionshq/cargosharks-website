/**
 * The nine ports — Architecture §10.
 *
 * These are the *only* interfaces in the system. The rule from §1 applies
 * without exception: no abstraction without a named second implementation.
 * Each has a real first implementation today and a second one the SRS itself
 * names — which is why there is no `Repository`, no `Mapper`, no
 * `IEnquiryService` anywhere in this codebase.
 *
 *   NotificationChannel  email · WhatsApp · in-app   -> further channels (FR-NT-02)
 *   FileStore            Supabase Storage            -> S3 (pilot -> R1)
 *   AuthProvider         Better Auth                 -> replaceable (§8)
 *   FxRateSource         daily feed + manual         -> provider change
 *   CarrierTracking      manual milestone entry      -> tracking provider (R2)
 *   CustomsFiling        manual reference capture    -> Kuwait Single Window (R2)
 *   EInvoiceTransmit     compliant data, no send     -> accredited provider (R2)
 *   InboundMailSource    IMAP poll of the mailboxes  -> provider webhook
 *   ModelProvider        OpenRouter                  -> a model hosted in region
 *
 * `ModelProvider` is the ninth and the newest; the argument for it being a port
 * at all is at its declaration below, and the reasoning it answers to is
 * `docs/Qabandi_AI_Surface.md`.
 *
 * The last three of the first seven are not speculative. R1 has a genuine
 * first implementation — manual capture — and SRS §8 states the intent that
 * R2's connection be "a plug, not a rebuild".
 *
 * `InboundMailSource` is the eighth, and it earns the rule rather than bending
 * it. The first implementation polls Al-Qabandi's own mailboxes over IMAP; the
 * second is the provider webhook SRS §9 already names as an integration
 * ("Email — inbound"), where a Resend, Postmark or SES receipt is parsed by
 * somebody else and posted to `/webhooks/email`. Both hand the same
 * `InboundMessage` to the same worker, which is the whole point: FR-EQ-02's
 * rules about what becomes an enquiry are hard, and they should not be written
 * twice.
 */

export interface OutboundMessage {
  readonly to: string
  readonly subject?: string
  readonly body: string
  readonly locale: 'en' | 'ar'
  /**
   * Who it comes from, where the sender is not the deployment's default.
   *
   * Optional, and the channel's own configured `from` is what answers when it
   * is absent. It exists because a branch is a legal entity (FR-ID-01): five
   * entities sending from one address is the same mistake as five numbering
   * from one invoice series, and the more visible one, because the customer
   * reads this and never reads the series.
   *
   * A channel with no notion of a sender address — WhatsApp sends from a
   * number the account owns — is free to ignore it.
   */
  readonly from?: string
  /** The approved template name, where the channel requires one. */
  readonly providerTemplateName?: string
  readonly attachments?: readonly { filename: string; content: Buffer; contentType: string }[]
}

export interface SendResult {
  readonly accepted: boolean
  /** The provider's id, matched back by the delivery-status webhook. */
  readonly externalRef?: string
  readonly error?: string
}

/**
 * Two methods. Adding a channel later is one adapter and a column value —
 * FR-NT-06's delivery states and FR-NT-07's quiet hours live in the
 * dispatcher, once, not in each adapter.
 */
export interface NotificationChannel {
  readonly key: 'email' | 'whatsapp' | 'in_app'
  send(message: OutboundMessage): Promise<SendResult>
}

export interface StoredFile {
  readonly storageKey: string
  readonly byteSize: number
  readonly checksum: string
}

/** Supabase Storage for the pilot, S3 for Release One, one interface (§3.1). */
export interface FileStore {
  /** Which driver answered, for the boot log — as on the other six ports. */
  readonly key: string
  put(key: string, body: Buffer, contentType: string): Promise<StoredFile>
  get(key: string): Promise<Buffer>
  /**
   * Time-limited URL, so document bytes never pass through the application.
   *
   * `downloadFilename` is a request, not a guarantee: it rides on the storage
   * provider's own `Content-Disposition` override, because the browser follows
   * the redirect and reads the headers of whatever answers it — anything this
   * application sets on the way past is discarded.
   */
  signedUrl(
    key: string,
    expiresInSeconds: number,
    options?: { readonly downloadFilename?: string },
  ): Promise<string>
  retire(key: string): Promise<void>
}

export interface FxQuote {
  readonly from: string
  readonly to: string
  readonly rate: string
  readonly effectiveOn: string
  readonly source: string
}

export interface FxRateSource {
  readonly key: string
  fetch(base: string, quotes: readonly string[]): Promise<FxQuote[]>
}

export interface CarrierMilestone {
  readonly code: string
  readonly occurredAt: Date
  readonly location?: string
}

/**
 * What to ask a carrier about.
 *
 * A bare string was the original shape and it is not enough to ask a carrier
 * with. DCSA takes three *different* query parameters —
 * `carrierBookingReference`, `transportDocumentReference`, `equipmentReference`
 * — so a caller that hands over `MRKU1234567` has told the adapter nothing
 * about whether that is a container or a bill, and guessing from the format is
 * a rule that breaks on the first carrier who numbers differently.
 *
 * `scac` is which carrier to ask. An aggregator resolves it for you and
 * charges for the privilege; going carrier-direct means the deployment holds
 * that fact, which is `partners.scac` on the job's carrier.
 */
export interface TrackingQuery {
  readonly reference: string
  readonly type: 'bill_of_lading' | 'booking_number' | 'container'
  /** The carrier's SCAC — `MAEU`, `HLCU`, `CMDU`. */
  readonly scac?: string
}

/** R1: milestones are entered by hand. R2 plugs a provider in behind this. */
export interface CarrierTracking {
  readonly key: string
  poll(query: TrackingQuery): Promise<CarrierMilestone[]>
}

export interface CustomsDeclaration {
  readonly declarationNo: string
  readonly filedAt: Date
  readonly dutyAmount?: string
}

/** R1: the broker files, the reference is captured. R2: the Single Window. */
export interface CustomsFiling {
  readonly key: string
  file(jobId: string, payload: Record<string, unknown>): Promise<CustomsDeclaration>
}

/**
 * R1 produces compliant invoice data and transmits nothing.
 *
 * The interface exists because the data shape is the hard part and it is being
 * got right now; connecting an accredited provider later is the plug.
 */
export interface EInvoiceTransmit {
  readonly key: string
  transmit(
    invoiceId: string,
    document: Record<string, unknown>,
  ): Promise<{ accepted: boolean; reference?: string }>
}

// --- inbound mail -----------------------------------------------------------

export interface InboundAttachment {
  readonly filename: string
  readonly contentType: string
  readonly content: Buffer
}

/**
 * One received email, normalised.
 *
 * Deliberately not the provider's shape and deliberately not raw MIME. An IMAP
 * poll and a webhook receipt disagree about almost everything — one hands over
 * a parsed object, the other a base64 blob or a URL to fetch — and the FR-EQ-02
 * rules about what becomes an enquiry are hard enough without also carrying
 * that difference through them.
 */
export interface InboundMessage {
  /**
   * RFC 5322 `Message-ID`, and the idempotency key.
   *
   * `inbound_webhook_events` is unique on `(provider, external_id)`, which is
   * what stops a redelivered — or re-polled — mail becoming a second enquiry.
   * A message with no `Message-ID` is malformed but not rare, so an adapter
   * synthesises one from the parts that identify the mail rather than skipping
   * it: better a stable hash than a new enquiry every minute forever.
   */
  readonly externalId: string
  /**
   * Which channel this arrived on. Absent means email — the original and the
   * default, so every existing caller and every stored receipt reads unchanged.
   *
   * It exists because `ingestMessage` is shared by the email intake and the
   * WhatsApp one (FR-EQ-02, both directions of §9). The two disagree in only a
   * few places — the `channel` stamped on the `messages` row and the enquiry,
   * and whether the sender is matched to a customer by email address or by phone
   * — and this is the discriminator those branches read. Everything else about
   * what becomes an enquiry is identical, which is the whole point of one path.
   */
  readonly channel?: 'email' | 'whatsapp'
  /**
   * Which configured inbox received it — this is what names the branch.
   *
   * An email address for the email channel (matched against `mailboxes`); a
   * WhatsApp business `phone_number_id` for the WhatsApp channel (matched
   * against `whatsapp_numbers`, by the worker, before this shape is built).
   */
  readonly mailbox: string
  readonly from: string
  readonly fromName?: string
  readonly to: readonly string[]
  readonly cc: readonly string[]
  readonly subject: string
  /** Plain text. HTML mail is flattened by the adapter, never stored as HTML. */
  readonly body: string
  readonly receivedAt: Date
  /** Threading headers — how a reply finds the job it belongs to (FR-NT-05). */
  readonly inReplyTo?: string
  readonly references: readonly string[]
  readonly attachments: readonly InboundAttachment[]
  /**
   * Whether a machine sent this, by its own admission.
   *
   * Set by the adapter from the headers that say so — `Auto-Submitted`
   * (RFC 3834), `X-Auto-Response-Suppress`, a bulk `Precedence`, the empty
   * reverse path a bounce carries, or a `multipart/report` body — because the
   * adapter is the only thing that still has the headers. The worker adds
   * the sender and subject heuristics on top; see `isAutomaticMail`.
   *
   * It exists because of an afternoon in which a branch mailbox received a
   * bounce, filed it as an enquiry, notified the "customer" — the mail
   * daemon — and received the bounce of that notification as the next
   * enquiry. One hundred and eighty-nine times, each with an SLA clock and a
   * model call, in twenty-four minutes.
   */
  readonly automatic?: boolean
}

/**
 * Somewhere email arrives from.
 *
 * `collect` takes the handler rather than returning a list, because the
 * acknowledgement has to happen *after* the work and the adapter is the only
 * thing that knows how to acknowledge. IMAP sets `\Seen`; a webhook source has
 * already been acknowledged with a 202 by the time this runs. Returning an
 * array would put "mark it done" in the caller, which is where a crash halfway
 * through a batch turns into either a lost enquiry or a duplicated one.
 *
 * A handler that throws leaves the message unacknowledged, so it is collected
 * again on the next run. At-least-once, and the same trade the notification
 * dispatcher makes for the same reason: a duplicate enquiry is a merge, a lost
 * one is a customer who never got a quote.
 */
export interface InboundMailSource {
  readonly key: string
  collect(handler: (message: InboundMessage) => Promise<void>): Promise<number>
}

/* -------------------------------------------------------------------------
 * The ninth port — a language model
 * ---------------------------------------------------------------------- */

/**
 * One part of a message. Text, or an image for the vision surfaces.
 *
 * Images are carried as data URIs rather than as URLs, and that is a security
 * property rather than a convenience: a `https://` image URL in a request
 * makes the provider fetch it, which turns "extract this bill of lading" into
 * a server-side request this application did not make and cannot see. Our
 * documents live behind signed URLs on object storage; the bytes go in the
 * body, and nothing about a scan's location leaves the building.
 */
export type ModelContent =
  | { readonly type: 'text'; readonly text: string }
  | {
      readonly type: 'image'
      /** `data:image/png;base64,…` — the bytes, not a link to them. */
      readonly dataUri: string
    }
  | {
      readonly type: 'document'
      /**
       * A PDF, inlined. `data:application/pdf;base64,…`.
       *
       * Separate from `image` because providers carry the two differently, and
       * because the distinction is one the caller genuinely has: a scan
       * attached to an email is a PDF far more often than it is a PNG, and
       * every supplier invoice this system will read is one.
       */
      readonly dataUri: string
      /** Shown to the model, and useful to it: invoices are named. */
      readonly filename: string
    }

export interface ModelMessage {
  readonly role: 'system' | 'user' | 'assistant' | 'tool'
  readonly content: string | readonly ModelContent[]
  /**
   * The tools an assistant turn asked for, replayed back on the next request.
   *
   * A tool-calling exchange is only coherent if the model is shown its own
   * request beside our answer to it. Dropping this and sending only the result
   * produces a model that asks for the same tool again, having no record of
   * having asked — which is a loop that terminates on the turn limit rather
   * than on an answer.
   */
  readonly toolCalls?: readonly ModelToolCall[]
  /** On a `tool` message: which call this answers. */
  readonly toolCallId?: string
}

/**
 * A function the model may ask us to run — the assistant's read tools.
 *
 * `parameters` is a JSON Schema. It is the provider's own contract and there
 * is no value in wrapping it: every provider worth using takes JSON Schema,
 * and a bespoke type here would be a translation layer between two identical
 * things that breaks on the first schema keyword it did not anticipate.
 */
export interface ModelTool {
  readonly name: string
  readonly description: string
  readonly parameters: Record<string, unknown>
}

export interface ModelToolCall {
  readonly id: string
  readonly name: string
  /** Raw JSON as the model produced it. Parsed and validated by the caller. */
  readonly arguments: string
}

export interface ModelRequest {
  /**
   * Which surface is asking — `AiSurface` in `core/ai.ts`.
   *
   * Required, and it is not telemetry. It selects the model, it selects the
   * spend limit, and it is the dimension the cost report is grouped by. A
   * call that cannot say which feature made it is a call nobody can price or
   * switch off.
   */
  readonly surface: string
  readonly messages: readonly ModelMessage[]
  /** Forces structured output where the provider supports it. */
  readonly schema?: Record<string, unknown>
  readonly tools?: readonly ModelTool[]
  readonly maxOutputTokens?: number
  /**
   * Zero unless a surface argues otherwise, and none of them do yet.
   *
   * Every surface in this system extracts a fact that is either on the page
   * or is not. Sampling buys variety, which is worth nothing here and costs
   * reproducibility — and reproducibility is what makes the golden set in
   * `AI-19` mean anything from one week to the next.
   */
  readonly temperature?: number
}

export interface ModelResponse {
  /**
   * What actually answered.
   *
   * Distinct from what was asked for, because a router may serve a different
   * model than the slug named — a fallback, a quantisation, a provider
   * outage. The ledger records both, since "the extraction got worse on
   * Tuesday" is otherwise an unanswerable question.
   */
  readonly model: string
  readonly text: string
  readonly toolCalls: readonly ModelToolCall[]
  readonly inputTokens: number
  readonly outputTokens: number
  /** USD, as a string, where the provider reports it. Never a JS number. */
  readonly costUsd?: string
  readonly finishReason: 'stop' | 'length' | 'tool_calls' | 'content_filter' | 'error'
  /** The provider's own body, stored verbatim in the ledger. */
  readonly raw: unknown
}

/**
 * A piece of an answer as it arrives.
 *
 * `text` is a fragment to show immediately; `final` is the whole response,
 * assembled, and always arrives last. Two shapes rather than one because they
 * serve different callers: the interface wants the fragment, and the ledger
 * wants the token counts, the cost and the finish reason — none of which exist
 * until the stream ends.
 */
export type ModelDelta =
  | { readonly type: 'text'; readonly text: string }
  | { readonly type: 'final'; readonly response: ModelResponse }

/**
 * Somewhere to ask a language model something.
 *
 * The ninth port, and it earns §10's rule rather than bending it. The first
 * implementation is OpenRouter, which is itself a router and therefore makes
 * the *model* a configuration value rather than a code change. The named
 * second is a regionally hosted model: GCC data residency is a live question
 * for a client whose customs declarations and commercial invoices are the
 * payload, and the answer may be that they may not leave the Gulf.
 *
 * The third is `none`, and it is a real implementation rather than an absence
 * — the same argument `manualFxSource` makes. A deployment that has bought no
 * model refuses politely and says so at boot, and `QABANDI_PILOT_FIXTURES=1`
 * keeps running the whole interface with no network at all.
 *
 * One method. Retries, backoff and the ledger live in the caller, once, not
 * in each adapter — the same division `NotificationChannel` draws, and for the
 * same reason: FR-NT-06's delivery states are not a per-provider concern and
 * neither is what a call cost.
 */
export interface ModelProvider {
  /** Which driver answered, for the boot log — as on the other eight. */
  readonly key: string
  /** Whether this driver can actually reach a model. `none` cannot. */
  readonly available: boolean
  complete(request: ModelRequest): Promise<ModelResponse>
  /**
   * The same request, answered in pieces.
   *
   * A separate method rather than a flag on `ModelRequest`, because the return
   * types genuinely differ and a caller must choose one deliberately. The
   * extraction surfaces want `complete`: a supplier invoice half-read is not
   * useful, and nobody is watching a worker. The assistant wants this, because
   * somebody *is* watching and a tool-calling loop can take half a minute
   * before it has a word to show.
   *
   * The last item is always `final`, carrying the assembled response — so a
   * caller that only needs the whole thing can drain the iterator and take it,
   * and the ledger is written from exactly the same shape either way.
   */
  stream(request: ModelRequest): AsyncIterable<ModelDelta>
}
