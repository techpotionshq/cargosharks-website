/**
 * What a messaging provider's refusal means, in terms a screen can translate.
 *
 * A provider answers in its own words and its own JSON, in English. Shown as
 * they are, they were the whole message on an Arabic screen: "kapso 422:
 * {"error":"Cannot send non-template messages outside the 24-hour window."}"
 * (NEW-2). So a refusal is read here into a code, the screen says the code's
 * sentence in the reader's language, and the provider's words go to the log.
 *
 * Pure, so the service that sends and the web that shows an intake turn's
 * failure read one rule.
 */

/** A refusal the coordinator can act on, or `other` for one only the log can explain. */
export type DeliveryRefusal = 'whatsapp_window' | 'other'

/*
  WhatsApp's customer-service window, every way it has been worded to us.

  Meta's own refusal is error 131047, "Re-engagement message", with details
  "more than 24 hours have passed since the customer last replied". Kapso does
  not always pass that through: the live run recorded HTTP 422 with
  {"error":"Cannot send non-template messages outside the 24-hour window."},
  which names neither the code nor "24 hours". Both shapes, and the plain
  phrases between them, are matched.
*/
const WHATSAPP_WINDOW =
  /\b131047\b|re-?engagement|24[- ]hours?\b|customer[- ]service window|non-template messages? outside|outside (?:of )?the (?:24|customer)/i

/** Whether a provider's refusal is WhatsApp's 24-hour window closing. */
export function isWhatsAppWindowClosed(error: string | null | undefined): boolean {
  return Boolean(error) && WHATSAPP_WINDOW.test(error!)
}

/** The code a provider's refusal reads as. */
export function deliveryRefusal(error: string | null | undefined): DeliveryRefusal {
  return isWhatsAppWindowClosed(error) ? 'whatsapp_window' : 'other'
}

/**
 * What an integration's last failure means, in terms a screen can translate.
 *
 * The integrations board printed the provider's own sentence — "Maersk
 * track-and-trace returned 401 — consumer key rejected" — as the whole
 * explanation, in English, on the Arabic screen too. The kinds below are the
 * ones with different fixes: a rejected key is the administrator's to change,
 * an unreachable host or an outage is not. The provider's words stay
 * available to the screen as detail; they are no longer the headline.
 */
export type IntegrationFailure =
  | 'credentials'
  | 'not_found'
  | 'rate_limited'
  | 'unreachable'
  | 'certificate'
  | 'provider_down'
  | 'other'

const FAILURE_PATTERNS: readonly (readonly [IntegrationFailure, RegExp])[] = [
  ['certificate', /certificate|self[- ]signed|\bTLS\b|\bSSL\b|CERT_/i],
  [
    'credentials',
    /\b40[13]\b|unauthori[sz]ed|forbidden|authenticat|invalid (?:api )?key|key (?:was )?rejected|rejected key|bad credentials|wrong password|access denied|\bEAUTH\b|\b535\b/i,
  ],
  ['rate_limited', /\b429\b|rate[- ]?limit|too many requests|quota/i],
  ['not_found', /\b404\b|not found/i],
  [
    'unreachable',
    /timed? ?out|timeout|ETIMEDOUT|ECONNREFUSED|ECONNRESET|ENOTFOUND|EAI_AGAIN|unreachable|network|getaddrinfo|socket hang up/i,
  ],
  ['provider_down', /\b5\d\d\b|service unavailable|bad gateway|internal server error/i],
]

/** The kind an integration's recorded failure reads as. */
export function integrationFailure(error: string | null | undefined): IntegrationFailure {
  if (!error) return 'other'
  for (const [kind, pattern] of FAILURE_PATTERNS) if (pattern.test(error)) return kind
  return 'other'
}
