/**
 * The two notifications nobody clicks — FR-NT-01.
 *
 * Nine events are required. Seven of them happen because somebody does
 * something: a quote is sent, a milestone is ticked, an invoice is issued. Two
 * happen because *time passes*, and those are the two that were missing, which
 * is not a coincidence — an event with no button has no obvious place to live,
 * so it ends up with no place at all.
 *
 * Both raise outbox rows and nothing else. The dispatcher owns recipients,
 * language, quiet hours and retry, and duplicating any of that here is how a
 * system acquires two notification paths that behave differently.
 *
 * ## Neither one nags
 *
 * Each fires **once** per quote and per invoice. That is a deliberate limit
 * rather than an unfinished feature:
 *
 * - A quotation that has been chased twice has been answered by silence, and a
 *   third message makes the sender look automated rather than attentive.
 * - Automated dunning is worse. A customer who has already telephoned about a
 *   payment and then receives a weekly demand learns that nobody in the
 *   building is reading their own system. Chasing money is a finance decision
 *   about a relationship, and the ageing report already puts the list in front
 *   of the person who should be making it.
 *
 * ## Idempotent against the outbox, not against a flag
 *
 * There is no `warned_at` column, and adding one would mean a migration to
 * store a fact that is already recorded: the outbox *is* the log of what has
 * been announced. Both queries exclude anything already announced by matching
 * on the reference in the payload, so a schedule that fires twice in a night,
 * or a service restarted mid-run, cannot produce a second message.
 */

import { and, eq, gt, isNotNull, lt, lte, sql } from 'drizzle-orm'
import { fromDb, subtract, toScale, todayIn } from '@qabandi/core'
import {
  branches,
  enquiries,
  invoices,
  notificationOutbox,
  quotes,
  systemActor,
  withActor,
} from '@qabandi/db'

/** How much warning a customer gets before a quotation lapses. */
const QUOTE_WARNING_DAYS = 3

/** Nothing is chased on the day it falls due; a payment may be in flight. */
const OVERDUE_GRACE_DAYS = 1

export interface ReminderResult {
  readonly raised: number
}

/**
 * Quotations approaching the end of their validity.
 *
 * Only `sent` quotes: a draft has not been offered to anyone, and an accepted,
 * rejected or superseded one has already had its answer.
 */
export async function runQuoteExpiryWarnings(asOf = new Date()): Promise<ReminderResult> {
  const horizon = addDays(asOf, QUOTE_WARNING_DAYS)

  return withActor(systemActor(), async (tx) => {
    const due = await tx
      .select({
        id: quotes.id,
        reference: quotes.reference,
        branchId: quotes.branchId,
        enquiryId: quotes.enquiryId,
        validUntil: quotes.validUntil,
        customerId: enquiries.customerId,
      })
      .from(quotes)
      .innerJoin(enquiries, eq(enquiries.id, quotes.enquiryId))
      .where(
        and(
          eq(quotes.status, 'sent'),
          /*
            An enquiry already closed lost or cancelled has had its answer, and
            "your quotation expires in three days" to a customer who said no
            last week reads as a system nobody watches (S9).
          */
          sql`${enquiries.status} not in ('won', 'lost', 'cancelled', 'expired')`,
          isNotNull(quotes.validUntil),
          lte(quotes.validUntil, isoDate(horizon)),
          // Not already lapsed — a quotation that expired last week needs a
          // conversation, not a countdown.
          gt(quotes.validUntil, isoDate(asOf)),
          notAlreadyAnnounced('quote.expiring', 'reference', quotes.reference),
        ),
      )
      .limit(500)

    for (const quote of due) {
      await tx.insert(notificationOutbox).values({
        branchId: quote.branchId,
        eventKey: 'quote.expiring',
        enquiryId: quote.enquiryId,
        customerId: quote.customerId,
        payload: {
          reference: quote.reference,
          validUntil: quote.validUntil ?? '',
          daysRemaining: daysBetween(asOf, quote.validUntil!),
        },
      })
    }

    return { raised: due.length }
  })
}

export interface LapseResult {
  /** Sent quotations moved to `expired`. */
  readonly quotes: number
  /** Quoted enquiries whose current quotation lapsed, moved to `expired`. */
  readonly enquiries: number
}

/**
 * Quotations past their validity, and the enquiries they leave unanswered —
 * the two `expired` transitions the machines declare and nothing performed (S9).
 *
 * The screens said "after this it expires by itself", and nothing ever did: a
 * quotation a month past its date was still `sent`, could still be accepted,
 * and its enquiry sat in `quoted` for good. Run from the same morning job as
 * the expiry warning, first, so a quotation is either warned about or expired
 * and never both, and needing no cron of its own.
 *
 * - A `sent` quotation whose last valid day is before today, in Kuwait time —
 *   the reading the PDF and the send guard give `valid_until` — becomes
 *   `expired` (`sent → expired` needs no permission: time did it). Drafts are
 *   left alone; nobody was offered them.
 * - A `quoted` enquiry whose *current* quotation (the one nothing superseded)
 *   is now `expired`, and that was never accepted, becomes `expired` too
 *   (`quoted → expired`). One with a fresh draft or a newer version in flight
 *   is somebody's work in progress and stays put.
 *
 * Both are ordinary audited updates under the system actor; nothing is deleted.
 */
export async function runQuoteLapse(asOf = new Date()): Promise<LapseResult> {
  const today = todayIn(undefined, asOf)

  return withActor(systemActor(), async (tx) => {
    const lapsed = await tx
      .update(quotes)
      .set({ status: 'expired', updatedAt: new Date() })
      .where(
        and(eq(quotes.status, 'sent'), isNotNull(quotes.validUntil), lt(quotes.validUntil, today)),
      )
      .returning({ id: quotes.id })

    const closed = await tx.execute(sql`
      update enquiries e
         set status = 'expired', closed_at = now(), updated_at = now()
       where e.status = 'quoted'
         and exists (
           select 1 from quotes q
            where q.enquiry_id = e.id and q.superseded_by_id is null and q.status = 'expired'
         )
         and not exists (
           select 1 from quotes q
            where q.enquiry_id = e.id
              and (q.status = 'accepted' or (q.superseded_by_id is null and q.status <> 'expired'))
         )
      returning e.id
    `)

    return { quotes: lapsed.length, enquiries: closed.rows.length }
  })
}

/**
 * Issued invoices past their due date with money still outstanding.
 *
 * `part_paid` counts. An invoice half settled and a month late is exactly the
 * one worth a note, and treating it as paid because *something* arrived is how
 * a balance quietly ages out of anybody's view.
 */
export async function runInvoiceOverdueNotices(asOf = new Date()): Promise<ReminderResult> {
  const cutoff = addDays(asOf, -OVERDUE_GRACE_DAYS)

  return withActor(systemActor(), async (tx) => {
    const due = await tx
      .select({
        id: invoices.id,
        seriesNo: invoices.seriesNo,
        branchId: invoices.branchId,
        customerId: invoices.customerId,
        currency: invoices.currency,
        total: invoices.total,
        // Receipts and partial credit notes (F9): both are off what is owed.
        amountPaid: sql<string>`(${invoices.amountPaid} + ${invoices.amountCredited})::text`,
        dueOn: invoices.dueOn,
      })
      .from(invoices)
      .innerJoin(branches, eq(branches.id, invoices.branchId))
      .where(
        and(
          // `issued` and `part_paid` only. `paid` is settled; `draft` and
          // `approved` were never sent; `void` and `credited` are reversed.
          sql`${invoices.status} in ('issued', 'part_paid')`,
          isNotNull(invoices.seriesNo),
          isNotNull(invoices.dueOn),
          lt(invoices.dueOn, isoDate(cutoff)),
          // Compared as `numeric`, never in JavaScript. KWD has three decimals
          // and a float loses the third — see §11 and `core/money.ts`.
          sql`${invoices.amountPaid} + ${invoices.amountCredited} < ${invoices.total}`,
          notAlreadyAnnounced('invoice.overdue', 'seriesNo', invoices.seriesNo),
        ),
      )
      .limit(500)

    for (const invoice of due) {
      await tx.insert(notificationOutbox).values({
        branchId: invoice.branchId,
        eventKey: 'invoice.overdue',
        customerId: invoice.customerId,
        payload: {
          seriesNo: invoice.seriesNo,
          // What is *outstanding*, not what was invoiced. Asking a customer
          // for the full amount of an invoice they have part paid is the
          // fastest way to have the whole balance disputed.
          total: outstanding(invoice.total, invoice.amountPaid, invoice.currency),
          currency: invoice.currency,
          dueOn: invoice.dueOn ?? '',
          daysOverdue: daysBetween(invoice.dueOn!, asOf),
        },
      })
    }

    return { raised: due.length }
  })
}

/**
 * "This has not been announced before."
 *
 * Matches on the identifier inside the payload rather than on a foreign key,
 * because `notification_outbox` carries a job, an enquiry and a customer — and
 * neither a quote nor an invoice is any of those. The identifier is unique per
 * quotation *version* and per invoice number, which is exactly the granularity
 * wanted: a revised quotation is a new reference and warns on its own terms.
 *
 * ## The payload key is a parameter, and it has to be
 *
 * This read `payload ->> 'reference'` for both callers. A quotation's payload
 * carries `reference`; an invoice's carries `seriesNo`. So for invoices the
 * comparison was `null = 'KWI-2026-00042'`, which is null, which is not true —
 * `not exists` was therefore always satisfied and the guard never once
 * suppressed anything.
 *
 * The effect was not a duplicate. It was **a dunning letter to every customer
 * with an unpaid invoice, every night, for as long as it stayed unpaid** — the
 * exact behaviour this file's header promises it does not have. It was found
 * by running the worker twice in a row, which is the only way it could have
 * been: once looks perfect.
 */
function notAlreadyAnnounced(
  eventKey: string,
  payloadKey: 'reference' | 'seriesNo',
  value: unknown,
) {
  return sql`not exists (
    select 1
      from ${notificationOutbox} o
     where o.event_key = ${eventKey}
       and o.payload ->> ${payloadKey} = ${value}
  )`
}

function addDays(from: Date, days: number): Date {
  const at = new Date(from)
  at.setUTCDate(at.getUTCDate() + days)
  return at
}

/** `date` columns are compared as `YYYY-MM-DD`, never as a timestamp. */
function isoDate(at: Date): string {
  return at.toISOString().slice(0, 10)
}

function daysBetween(from: Date | string, to: Date | string): number {
  const a = new Date(typeof from === 'string' ? `${from}T00:00:00Z` : from).getTime()
  const b = new Date(typeof to === 'string' ? `${to}T00:00:00Z` : to).getTime()
  return Math.max(0, Math.round((b - a) / 86_400_000))
}

/**
 * The balance still owed, at the currency's own scale.
 *
 * Every part of this goes through `core/money.ts`, which is the only thing in
 * the stack allowed to do arithmetic on money (§11). The first version of this
 * function did the subtraction by hand on strings — correct, and still the
 * wrong thing to have written, because `core` already holds the rounding mode,
 * the minor units per currency and the `numeric` round trip, and a second
 * implementation of any of those is a second thing to keep right.
 *
 * The scale matters in the message itself. KWD has three decimals, so an
 * outstanding balance of 380 has to read `380.000` — a customer-facing figure
 * that drops its fils looks like a different number to the invoice it refers
 * to, and a customer comparing the two has every reason to query it.
 */
function outstanding(total: string, paid: string, currency: string): string {
  return toScale(subtract(fromDb(total, currency), fromDb(paid, currency)))
}
