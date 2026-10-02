/**
 * What a customer is told about a quotation's or an invoice's state (D12).
 *
 * Pure, so the list, the detail page and the tests read one rule.
 */

import { D } from '@qabandi/core'
import type { Tone } from '@/ui/status'

export type PortalQuoteState = 'sent' | 'expired' | 'accepted' | 'rejected'

/**
 * A sent offer whose validity has run out reads as expired before the nightly
 * job marks it so. `validUntil` is a calendar day and `today` is the day in
 * Kuwait (`todayIn()`), compared as `YYYY-MM-DD` strings: the last valid day is
 * valid all day, which is the reading `moveQuote` refuses an answer by too, so
 * the page never offers a button the server will turn down.
 */
export function portalQuoteState(
  quote: { readonly status: string; readonly validUntil: string | null },
  today: string,
): PortalQuoteState {
  if (quote.status === 'accepted' || quote.status === 'rejected') return quote.status
  if (quote.status === 'expired') return 'expired'
  return quote.validUntil !== null && quote.validUntil < today ? 'expired' : 'sent'
}

export const QUOTE_STATE_TONE: Record<PortalQuoteState, Tone> = {
  sent: 'info',
  expired: 'caution',
  accepted: 'positive',
  rejected: 'muted',
}

/**
 * Overdue: an invoice (not a credit note) with something still owed, whose due
 * day has passed in Kuwait. The balance is compared as a `Decimal`, because
 * `'0.000000' > 0` is a question a string cannot answer.
 */
export function isOverdue(
  invoice: {
    readonly isCreditNote: boolean
    readonly balance: string
    readonly dueOn: string | null
  },
  today: string,
): boolean {
  return (
    !invoice.isCreditNote &&
    invoice.dueOn !== null &&
    invoice.dueOn < today &&
    new D(invoice.balance).greaterThan(0)
  )
}
