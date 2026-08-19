/**
 * The seven ports — Architecture §10.
 *
 * These are the *only* interfaces in the system. The rule from §1 applies
 * without exception: no abstraction without a named second implementation.
 * Each of the seven has a real first implementation today and a second one the
 * SRS itself names — which is why there is no `Repository`, no `Mapper`, no
 * `IEnquiryService` anywhere in this codebase.
 *
 *   NotificationChannel  email · WhatsApp · in-app   -> further channels (FR-NT-02)
 *   FileStore            Supabase Storage            -> S3 (pilot -> R1)
 *   AuthProvider         Better Auth                 -> replaceable (§8)
 *   FxRateSource         daily feed + manual         -> provider change
 *   CarrierTracking      manual milestone entry      -> tracking provider (R2)
 *   CustomsFiling        manual reference capture    -> Kuwait Single Window (R2)
 *   EInvoiceTransmit     compliant data, no send     -> accredited provider (R2)
 *
 * The last three are not speculative. R1 has a genuine first implementation —
 * manual capture — and SRS §8 states the intent that R2's connection be
 * "a plug, not a rebuild".
 */

export interface OutboundMessage {
  readonly to: string
  readonly subject?: string
  readonly body: string
  readonly locale: 'en' | 'ar'
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
