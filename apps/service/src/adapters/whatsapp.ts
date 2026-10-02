/**
 * WhatsApp through Kapso — the outbound half of the `NotificationChannel` port.
 *
 * Kapso fronts the WhatsApp Cloud API with a Meta-shaped proxy, so a send is the
 * Cloud API's own `POST /{phone_number_id}/messages` — authenticated with the
 * account's Kapso API key in `X-API-Key` rather than a Meta bearer token. The
 * request and response shapes are Meta's, unchanged, which is the whole promise
 * of the proxy.
 *
 * ## Not registered in the dispatcher, on purpose
 *
 * The notification dispatcher fans every customer event out to *every* registered
 * channel, addressing each with the recipient's email. A WhatsApp channel in that
 * registry would be handed an email address as a phone number for every arrival
 * notice and every overdue invoice — a wall of failed sends. So this channel is
 * resolved and used deliberately, by the caller that has a WhatsApp number to
 * send to and a reason to: today that is the inbound worker's same-channel
 * acknowledgement (`inbound-whatsapp-webhook.ts`). A full WhatsApp path through
 * the dispatcher — per-channel addressing, number resolution, templates in both
 * languages — is a larger change than one adapter, and is left for when the
 * product asks for WhatsApp arrival notices rather than only enquiry replies.
 *
 * ## The sending number rides on `from`
 *
 * `OutboundMessage.from` is documented as "where the sender is not the default",
 * and for WhatsApp that is the `phone_number_id` the message goes out on — the
 * business number, not an address. Without it there is no endpoint to call, so a
 * send with no `from` is refused rather than guessed.
 */

import type { NotificationChannel, OutboundMessage, SendResult } from '../ports/index'
import { integration } from '../settings'

export const KAPSO_DEFAULT_BASE_URL = 'https://api.kapso.ai/meta/whatsapp'

/** The Graph version the Kapso proxy mirrors. Pinned, as Meta's own SDKs pin it. */
const GRAPH_VERSION = 'v24.0'

export interface KapsoWhatsAppOptions {
  readonly apiKey: string
  readonly baseUrl: string
  /** Test seam — a `fetch` that never touches the network. */
  readonly fetchImpl?: typeof fetch
}

export function kapsoChannel(options: KapsoWhatsAppOptions): NotificationChannel {
  const base = options.baseUrl.replace(/\/+$/, '')
  const doFetch = options.fetchImpl ?? fetch

  return {
    key: 'whatsapp',
    async send(message: OutboundMessage): Promise<SendResult> {
      const phoneNumberId = message.from?.trim()
      if (!phoneNumberId) {
        return { accepted: false, error: 'whatsapp send has no sending phone_number_id (from)' }
      }
      const to = message.to.trim()
      if (to === '') return { accepted: false, error: 'whatsapp send has no recipient' }

      const url = `${base}/${GRAPH_VERSION}/${encodeURIComponent(phoneNumberId)}/messages`

      try {
        const res = await doFetch(url, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-api-key': options.apiKey,
          },
          body: JSON.stringify({
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to,
            type: 'text',
            // A quote reference is not a link to unfurl; preview off keeps the
            // reply clean and avoids Kapso fetching anything on our behalf.
            text: { preview_url: false, body: message.body },
          }),
        })

        const bodyText = await res.text()
        if (!res.ok) {
          return { accepted: false, error: `kapso ${res.status}: ${bodyText.slice(0, 300)}` }
        }

        return { accepted: true, externalRef: extractMessageId(bodyText) }
      } catch (error) {
        return { accepted: false, error: error instanceof Error ? error.message : String(error) }
      }
    },
  }
}

/**
 * The wamid of the sent message, matched back later by a delivery-status webhook.
 *
 * Kapso wraps most endpoints in a `data` object and passes the Cloud API's own
 * `{ messages: [{ id }] }` through; both are read so the ref survives whichever
 * shape a given endpoint returns. A body that parses to neither simply yields no
 * ref, which is not an error — the send was accepted.
 */
function extractMessageId(bodyText: string): string | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(bodyText)
  } catch {
    return undefined
  }
  const root = parsed as Record<string, unknown>
  const data = (root.data as Record<string, unknown> | undefined) ?? root
  const messages = data.messages
  if (Array.isArray(messages) && messages.length > 0) {
    const id = (messages[0] as Record<string, unknown>).id
    if (typeof id === 'string') return id
  }
  const id = data.id
  return typeof id === 'string' ? id : undefined
}

/**
 * The WhatsApp channel this deployment is configured with, or `null` when it is
 * off.
 *
 * `null` rather than a refusing channel because the one caller — the inbound
 * acknowledgement — treats "off" as "do not reply on WhatsApp", which is a
 * perfectly good outcome, not a failure to record. Off by default (`driver`
 * other than `kapso`, or no key) so a deployment that has bought no number sends
 * nothing, exactly as the integration spec's "ships dark" promises.
 */
export async function resolveWhatsAppChannel(): Promise<NotificationChannel | null> {
  const settings = await integration('whatsapp')
  if (settings.driver !== 'kapso') return null

  const apiKey = settings.secret('kapsoApiKey')
  if (!apiKey) return null

  return kapsoChannel({
    apiKey,
    baseUrl: settings.text('baseUrl') || KAPSO_DEFAULT_BASE_URL,
  })
}

/**
 * A media item a WhatsApp message refers to — the picture, the PDF, the voice
 * note — named by the id Meta assigned it, and sometimes by a link Kapso
 * already resolved.
 */
export interface WhatsAppMediaRef {
  readonly kind: string
  readonly id: string
  readonly mimeType: string | null
  readonly filename: string | null
  /** A download link the webhook carried, where Kapso put one on the payload. */
  readonly url: string | null
}

export interface FetchedMedia {
  readonly filename: string
  readonly contentType: string
  /** Empty when the file was larger than the limit — stored as a stub, never read. */
  readonly content: Buffer
  readonly oversized: boolean
}

export interface WhatsAppMediaSource {
  fetch(ref: WhatsAppMediaRef): Promise<FetchedMedia>
}

/** A photograph of a packing list, or a PDF of one — and refused well before memory trouble. */
export const WHATSAPP_MEDIA_MAX_BYTES = 10 * 1024 * 1024

const EXTENSION: Readonly<Record<string, string>> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
}

/**
 * The bytes behind a media id, through Kapso's authenticated media call.
 *
 * Meta's own two steps, through Kapso's proxy and its `X-API-Key`: `GET
 * /{media_id}` answers with a short-lived `url`, the type and the size, and
 * that `url` answers with the bytes. Where the webhook already carried a link,
 * the first step is skipped. The size is checked twice — against what the
 * metadata claims before downloading, and against what arrived after — because
 * a claim is not a byte count, and an oversized file comes back as an empty
 * stub so the message is still filed and a person sees that a file came.
 *
 * Throws on a provider failure: the caller files the message without the file
 * rather than losing the message over it.
 */
export function kapsoMediaSource(
  options: KapsoWhatsAppOptions & { readonly maxBytes?: number },
): WhatsAppMediaSource {
  const base = options.baseUrl.replace(/\/+$/, '')
  const doFetch = options.fetchImpl ?? fetch
  const max = options.maxBytes ?? WHATSAPP_MEDIA_MAX_BYTES
  const headers = { 'x-api-key': options.apiKey }

  return {
    async fetch(ref: WhatsAppMediaRef): Promise<FetchedMedia> {
      let url = ref.url
      let contentType = ref.mimeType ?? 'application/octet-stream'
      let claimed = 0

      if (!url) {
        const meta = await doFetch(`${base}/${GRAPH_VERSION}/${encodeURIComponent(ref.id)}`, {
          headers,
        })
        if (!meta.ok)
          throw new Error(`kapso media ${meta.status}: ${(await meta.text()).slice(0, 200)}`)
        const body = (await meta.json()) as Record<string, unknown>
        const data = (body.data as Record<string, unknown> | undefined) ?? body
        url = typeof data.url === 'string' ? data.url : null
        if (typeof data.mime_type === 'string') contentType = data.mime_type
        claimed = Number(data.file_size ?? 0) || 0
        if (!url) throw new Error('kapso media answered with no download url')
      }

      const filename =
        ref.filename ||
        `whatsapp-${ref.kind}.${EXTENSION[contentType.split(';')[0]!.trim()] ?? 'bin'}`
      const stub = { filename, contentType, content: Buffer.alloc(0), oversized: true }
      if (claimed > max) return stub

      const file = await doFetch(url, { headers })
      if (!file.ok) throw new Error(`kapso media download ${file.status}`)
      const length = Number(file.headers.get('content-length') ?? 0)
      if (length > max) return stub
      const content = Buffer.from(await file.arrayBuffer())
      if (content.byteLength > max) return stub
      const served = file.headers.get('content-type')
      return {
        filename,
        contentType: ref.mimeType ?? (served ? served.split(';')[0]!.trim() : contentType),
        content,
        oversized: false,
      }
    },
  }
}

/** The media source this deployment is configured with, or `null` when WhatsApp is off. */
export async function resolveWhatsAppMedia(): Promise<WhatsAppMediaSource | null> {
  const settings = await integration('whatsapp')
  if (settings.driver !== 'kapso') return null
  const apiKey = settings.secret('kapsoApiKey')
  if (!apiKey) return null
  return kapsoMediaSource({ apiKey, baseUrl: settings.text('baseUrl') || KAPSO_DEFAULT_BASE_URL })
}
