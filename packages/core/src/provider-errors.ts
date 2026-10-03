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
