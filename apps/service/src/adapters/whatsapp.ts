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
