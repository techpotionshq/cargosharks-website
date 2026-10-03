/**
 * Send, accept or reject a quotation, inside the caller's actor transaction.
 *
 * One transition with two doors (D12). The operations screen moves a quote on
 * a coordinator's click, and the customer portal accepts or declines one on
 * the customer's. Both must apply the same state machine, the same validity
 * rule and the same side effects, and two copies of that in two feature slices
 * would agree only until the first one was changed. Slices never import each
 * other, so the move lives here, under both of them.
 *
 * Permission is the caller's business, not this function's: staff are checked
 * against `quote.accept` and friends before they get here, and a customer
 * contact holds no role at all; their authority is RLS, which shows them only
 * their own sent quotations and lets them make only the `sent -> decided`
 * write (`quotes_customer_decides`).
 */

import { and, eq, inArray, sql } from 'drizzle-orm'
import {
  IllegalTransitionError,
  assertTransition,
  fromDb,
  quoteMachine,
  toScale,
  todayIn,
  type QuoteStatus,
} from '@qabandi/core'
import type { Tx } from './actor'
import { customers } from './schema/commercial'
import { enquiries, quotes } from './schema/jobs'
import { notificationOutbox } from './schema/comms'

export type QuoteMove = 'sent' | 'accepted' | 'rejected'

export type QuoteMoveResult =
  | { readonly ok: true; readonly from: QuoteStatus }
  | {
      readonly ok: false
      /**
       * `not_found` is also the answer for a quote RLS hides: another
       * customer's, a draft, a superseded version (FR-ID-04).
       */
      readonly refusal: 'not_found' | 'lapsed' | 'transition'
      readonly from?: QuoteStatus
    }

export interface QuoteMoveOptions {
  /**
   * Who is answering. `customer` is the portal: the branch is told by an
   * outbox event, the optional reason is kept on the quote, and a lapsed
   * offer cannot be declined either, because the portal offers no move on
   * an offer that has run out.
   */
  readonly by?: 'staff' | 'customer'
  /** The customer's reason for declining, as typed. Ignored otherwise. */
  readonly reason?: string | null
}

export async function moveQuote(
  tx: Tx,
  quoteId: string,
  status: QuoteMove,
  options: QuoteMoveOptions = {},
): Promise<QuoteMoveResult> {
  const byCustomer = options.by === 'customer'

  /*
    The customer comes from the enquiry, because a quote does not carry one.

    `quotes` references an enquiry and a branch; the customer is the
    enquiry's. That join is here rather than in the notification dispatcher
    for a reason worth stating once: the outbox row records *who the event
    was about at the time it happened*, so a customer later reassigned on
    the enquiry does not silently redirect a notification about a quotation
    that was already sent.
  */
  const [current] = await tx
    .select({
      status: quotes.status,
      reference: quotes.reference,
      branchId: quotes.branchId,
      enquiryId: quotes.enquiryId,
      totalSell: quotes.totalSell,
      currency: quotes.currency,
      validUntil: quotes.validUntil,
      customerId: enquiries.customerId,
      customerEn: customers.legalNameEn,
      customerAr: customers.legalNameAr,
    })
    .from(quotes)
    .innerJoin(enquiries, eq(enquiries.id, quotes.enquiryId))
    .leftJoin(customers, eq(customers.id, enquiries.customerId))
    .where(eq(quotes.id, quoteId))
    .limit(1)
    /*
      Locked, so a double-click on Send is two transactions in a row
      rather than two at once: the second reads `sent`, the machine
      refuses sent → sent, and the customer gets one `quote.sent` mail
      instead of two (S17). The same lock makes a customer's Accept and a
      coordinator's Reject on the same quote serialise rather than both win.
    */
    .for('update', { of: quotes })
  if (!current) {
    /*
      `for update` reads through the UPDATE policies as well as the SELECT
      ones, and `quotes_customer_decides` admits a customer only to a `sent`
      row. So a quotation the customer already answered is invisible to the
      lock while still visible to a plain read, and without this second look
      "you already answered" would come back as "no such quotation". Staff
      policies are the same for both verbs, so for them this finds nothing new.
    */
    const [seen] = await tx
      .select({ status: quotes.status })
      .from(quotes)
      .where(eq(quotes.id, quoteId))
      .limit(1)
    return seen
      ? { ok: false, refusal: 'transition', from: seen.status }
      : { ok: false, refusal: 'not_found' }
  }

  try {
    assertTransition(quoteMachine, current.status, status)
  } catch (error) {
    if (error instanceof IllegalTransitionError) {
      return { ok: false, refusal: 'transition', from: current.status }
    }
    throw error
  }

  /*
    A lapsed quotation is not an offer anyone can send or accept (S9). The
    validity is a calendar day, compared in the branch's zone, so the last
    valid day is valid all day. Rejecting one stays allowed for staff, a
    customer may well have said no to an offer that ran out, but the portal
    refuses both answers on an expired offer, and says it has expired.
  */
  const lapsed = current.validUntil !== null && current.validUntil < todayIn()
  if (lapsed && (status !== 'rejected' || byCustomer)) {
    return { ok: false, refusal: 'lapsed', from: current.status }
  }

  const decided = status === 'accepted' || status === 'rejected'
  const reason = byCustomer && status === 'rejected' ? options.reason?.trim() || null : null

  await tx
    .update(quotes)
    .set({
      status,
      sentAt: status === 'sent' ? sql`coalesce(${quotes.sentAt}, now())` : undefined,
      decidedAt: decided ? new Date() : undefined,
      decisionNote: reason ?? undefined,
      updatedAt: new Date(),
    })
    .where(eq(quotes.id, quoteId))

  /*
    At the currency's own precision, not the column's.

    `numeric(19,6)` comes back as `1250.000000`, and a quotation that quotes a
    KWD figure to six decimal places reads as a machine rather than as a
    price. `toScale` puts it at the three decimals KWD actually has.
  */
  const total = toScale(fromDb(current.totalSell, current.currency))

  // FR-NT-01. In this transaction, so a quote that fails to move never
  // announces itself to the customer (§7.4).
  if (status === 'sent') {
    await tx.insert(notificationOutbox).values({
      branchId: current.branchId,
      eventKey: 'quote.sent',
      enquiryId: current.enquiryId,
      customerId: current.customerId,
      payload: {
        reference: current.reference,
        total,
        currency: current.currency,
        validUntil: current.validUntil ?? '',
      },
    })

    /*
      Sending the quotation is what makes the enquiry `quoted` (S1).
      Nothing moved it out of `rating`, pricing only ever moved `new` and
      `assigned`, and `won` is legal only from `quoted`, so an enquiry
      that went through an RFQ could be sent, accepted and then never
      closed as won. `rating → quoted` is the machine's own transition,
      gated on the `quote.send` the caller already asserted.
    */
    await tx
      .update(enquiries)
      .set({
        status: 'quoted',
        firstRespondedAt: sql`coalesce(${enquiries.firstRespondedAt}, now())`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(enquiries.id, current.enquiryId),
          inArray(enquiries.status, ['new', 'assigned', 'rating']),
        ),
      )
  }

  /*
    The customer's answer, told to the branch (FR-CP-07). In the same
    transaction for the same reason as `quote.sent`: an answer that did not
    land is never announced. `notification_outbox_customer_decision` is the
    policy that lets the customer's own actor write exactly this row.
  */
  if (byCustomer && decided) {
    await tx.insert(notificationOutbox).values({
      branchId: current.branchId,
      eventKey: status === 'accepted' ? 'quote.accepted' : 'quote.declined',
      enquiryId: current.enquiryId,
      customerId: current.customerId,
      payload: {
        reference: current.reference,
        customer: current.customerEn ?? '',
        customerAr: current.customerAr || current.customerEn || '',
        total,
        currency: current.currency,
        // A hyphen when none was given, so the notice's "Reason given" line never ends bare.
        ...(status === 'rejected' ? { reason: reason ?? '-' } : {}),
      },
    })
  }

  return { ok: true, from: current.status }
}
