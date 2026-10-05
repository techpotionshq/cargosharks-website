/**
 * What a customer is told about a quotation's or an invoice's state (D12).
 *
 * Pure, so the list, the detail page and the tests read one rule.
 */

import { isInvoiceOverdue } from '@qabandi/core'
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
 * Overdue, for the portal: the shared rule in `core`, so a customer reads
 * "overdue" on exactly the invoices the operator's register flags. Kept as a
 * name here because the portal pages import it from this file.
 */
export function isOverdue(
  invoice: {
    readonly status: string
    readonly isCreditNote: boolean
    readonly balance: string
    readonly dueOn: string | null
  },
  today: string,
): boolean {
  return isInvoiceOverdue(invoice, today)
}
