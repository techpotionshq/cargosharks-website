/**
 * E-invoice transmission — `EInvoiceTransmit` in `ports/index.ts`.
 *
 * The UAE mandate is the deadline this port exists for: Peppol PINT AE, ASP
 * appointment due 30 October 2026, go-live 1 January 2027 for the largest
 * filers. Saudi ZATCA Phase 2 is already live and enforced.
 *
 * ## We are not the access point, and must never try to be
 *
 * Becoming an Accredited Service Provider requires active Peppol certification
 * **and a solution that has been in operation for a minimum of two years**.
 * That is not a thing to plan around; it is a thing to accept. So this adapter
 * hands a finished document to somebody who is accredited and records what
 * they say back.
 *
 * That division is also why the port was worth declaring a year early: the
 * *document* is the hard part and it is ours, the transmission is a POST and
 * it is theirs.
 *
 * ## Idempotency is the whole risk
 *
 * A transmitted invoice is a tax filing. Sending the same one twice is a
 * correction exercise with the authority, not a duplicate row — so every
 * request carries the invoice id as an idempotency key and the adapter refuses
 * to invent one.
 */

import type { EInvoiceTransmit } from '../ports/index'
import type { LiveIntegration } from '../settings'

/**
 * Release One: the data is made compliant and nothing is sent.
 *
 * Returns `accepted: false` rather than throwing, and says why. A caller that
 * treats "no transmitter configured" as a failure would put the invoice into a
 * retry loop for a capability the deployment has deliberately not bought.
 */
export const noTransmit: EInvoiceTransmit = {
  key: 'none',
  transmit: () =>
    Promise.resolve({
      accepted: false,
      reference: 'not-configured',
    }),
}

interface AspResponse {
  readonly accepted?: boolean
  readonly status?: string
  readonly documentId?: string
  readonly id?: string
  readonly message?: string
  readonly errors?: readonly { readonly message?: string }[]
}

/**
 * A generic accredited-provider endpoint.
 *
 * Generic on purpose, unlike the carrier adapter: the *document* is a Peppol
 * standard, so what differs between providers is only the envelope they accept
 * it in — a URL, a bearer token, and a JSON acknowledgement. The parts that
 * would justify a per-provider file are the parts the standard already fixes.
 */
function aspTransmit(url: string, apiKey: string): EInvoiceTransmit {
  return {
    key: 'asp',

    async transmit(invoiceId, document) {
      const response = await fetch(url, {
        method: 'POST',
        signal: AbortSignal.timeout(30_000),
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${apiKey}`,
          /*
            The invoice id, as the idempotency key.

            A retry after a timeout is the normal case — the request may well
            have succeeded before the connection dropped — and without this the
            safe-looking retry files the same invoice twice with the tax
            authority. The id is stable, unique and already the thing both
            sides call this document.
          */
          'idempotency-key': invoiceId,
        },
        body: JSON.stringify(document),
      })

      const body = (await response.json().catch(() => ({}))) as AspResponse

      if (!response.ok) {
        /*
          A rejection is reported, not thrown.

          The provider rejecting a document is information about the document —
          a missing tax registration, a malformed line — and it belongs on the
          invoice for a human to fix. Throwing would make it a queue failure,
          which retries something that will be rejected identically forever.
        */
        const detail =
          body.errors
            ?.map((e) => e.message)
            .filter(Boolean)
            .join('; ') ??
          body.message ??
          `${response.status} ${response.statusText}`

        return { accepted: false, reference: detail.slice(0, 500) }
      }

      /*
        An explicit flag wins, then an explicit status, then the HTTP result.

        Written as a chain rather than `a ?? b === c ?? d`, which reads as
        three fallbacks and is really two — the comparison is always a boolean,
        so the final default was unreachable. A provider that answers 2xx with
        an opaque body has accepted the document; that is what 2xx means, and
        treating it as a rejection would strand a filed invoice as unfiled.
      */
      const accepted = body.accepted ?? (body.status ? body.status === 'accepted' : true)

      return {
        accepted,
        // The provider's own id, which is what a tax query is answered with.
        reference: body.documentId ?? body.id,
      }
    },
  }
}

/** Which transmitter this deployment runs on. Nothing sent unless configured. */
export function resolveEInvoiceTransmit(settings: LiveIntegration): EInvoiceTransmit {
  if (settings.driver !== 'asp') return noTransmit

  const url = settings.text('url')
  const apiKey = settings.secret('apiKey')

  if (!url || !apiKey) {
    throw new Error(
      'E-invoice transmission is set to `asp` and needs both a provider URL and ' +
        'an API key. Transmission goes through an accredited provider — we cannot ' +
        'be one (the accreditation requires two years of operating history).',
    )
  }

  return aspTransmit(url, apiKey)
}
