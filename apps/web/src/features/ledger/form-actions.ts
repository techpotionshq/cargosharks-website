'use server'

/**
 * Money mutations — quotations, invoices, receipts.
 *
 * The slice where getting it slightly wrong costs real money, so three rules
 * are enforced here rather than trusted to the interface:
 *
 *   1. **A quote is never edited.** A revision is a *new row* at the next
 *      version, and the previous one moves to `superseded` (SRS §7, rule one).
 *      A customer holding a printed quotation must be holding a document that
 *      still exists, unchanged, in the system.
 *   2. **Money is `numeric`, and it stays a string all the way down.** Never
 *      parsed into a JS number anywhere on this path — the third decimal of a
 *      KWD amount does not survive a float, and KWD has three.
 *   3. **A payment cannot be allocated to more than it is.** Checked inside
 *      the transaction against the sum of existing allocations, because two
 *      people allocating the same receipt at once is exactly the race that
 *      produces a customer statement nobody can reconcile.
 */

import { revalidatePath } from 'next/cache'
import { getTranslations } from 'next-intl/server'
import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import { z } from 'zod'
import {
  SettlementError,
  assertTransition,
  checkSettlement,
  billedFromNote,
  creditableAmount,
  dec,
  fromDb,
  invoiceMachine,
  money as moneyOf,
  planCreditNote,
  positionFromDb,
  round,
  toScale,
  todayIn,
  type CreditNoteRefusal,
} from '@qabandi/core'
import {
  branches,
  chargeLines,
  chargeTypes,
  checkCredit,
  currencies,
  enquiries,
  invoiceLines,
  invoices,
  jobs,
  nextQuoteVersion,
  notificationOutbox,
  paymentAllocations,
  payments,
  latestFxRate,
  moveQuote,
  quoteLines,
  quotes,
  rederiveInvoiceSettlement,
  retireQuoteVersion,
  withActor,
  type Tx,
} from '@qabandi/db'
import { requireSession } from '@/lib/session'
import { assertCan, assertCanIn } from '@/lib/permissions'
import {
  echo,
  fail,
  failWith,
  fieldErrors,
  succeed,
  type ActionState,
  type Translate,
} from '@/lib/form-state'
import { normaliseAmount } from '@/lib/amount'
import { localeParse } from '@/lib/validate'
import { refuseForbidden } from '@/lib/refuse-forbidden'
import { demoReadOnly } from '@/lib/pilot/read-only'

function read(form: FormData, key: string): string | undefined {
  const value = form.get(key)
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

/**
 * A money field.
 *
 * Stays a string. The regex is the whole validation — anything that parses as
 * a decimal is handed to PostgreSQL's `numeric`, which is the only thing in
 * this stack that can be trusted with it.
 */
const money = (message: string) =>
  z
    .string()
    .trim()
    .overwrite(normaliseAmount)
    .regex(/^\d+(\.\d{1,6})?$/, message)

/**
 * Above zero — judged only once the figure is a decimal at all, because a
 * refinement runs after a failed regex too and `dec('')` throws.
 */
const aboveZero = (v: string | null): boolean =>
  v === null || !/^\d+(\.\d{1,6})?$/.test(v) || dec(v).greaterThan(0)

const optionalMoney = (tv: Translate) =>
  z
    .string()
    .trim()
    .regex(/^\d*(\.\d{1,6})?$/, tv('numbersOnly'))
    .optional()
    .transform((v) => (v ? v : null))

// --- quotations ------------------------------------------------------------

const quoteSchema = (tv: Translate) =>
  z.object({
    enquiryId: z.uuid(tv('chooseEnquiry')),
    branchId: z.uuid(tv('chooseBranch')),
    currency: z
      .string()
      .trim()
      .length(3)
      .transform((v) => v.toUpperCase()),
    totalSell: money(tv('enterQuotedPrice')),
    totalCost: money(tv('enterQuotedCost')),
    validUntil: z.string().trim().min(1, tv('quoteNeedsExpiry')),
    notes: z
      .string()
      .trim()
      .max(1000)
      .optional()
      .transform((v) => v || null),
  })

/**
 * Draft a quotation against an enquiry.
 *
 * The margin is computed here and frozen into `priced_snapshot`. It is never
 * recomputed against a later rate card (§6.3): a quote sent in March priced at
 * March's buying rates keeps March's margin forever, which is the only way the
 * margin column on the register means anything.
 */
export const createQuote = refuseForbidden(async function createQuote(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const session = await requireSession()
  assertCan(session, 'quote.send')
  const demo = await demoReadOnly(form)
  if (demo) return demo
  const tv = await getTranslations('ledgerValidation')

  const parsed = await localeParse(quoteSchema(tv), {
    enquiryId: read(form, 'enquiryId'),
    branchId: read(form, 'branchId'),
    currency: read(form, 'currency') ?? 'USD',
    totalSell: read(form, 'totalSell') ?? '',
    totalCost: read(form, 'totalCost') ?? '',
    validUntil: read(form, 'validUntil') ?? '',
    notes: read(form, 'notes'),
  })
  if (!parsed.success) return fail(fieldErrors(parsed.error), echo(form))

  const data = parsed.data

  if (Number(data.totalCost) > Number(data.totalSell)) {
    return fail({ totalSell: tv('priceBelowCost') }, echo(form))
  }
  /*
    A quotation that has already lapsed is not an offer (S9). Compared as
    calendar days in the branch's zone — the same reading the quote page and
    the PDF give `valid_until` — so "today" is still allowed all day.
  */
  if (data.validUntil < todayIn()) {
    return fail({ validUntil: tv('quoteExpiryInPast') }, echo(form))
  }

  const outcome = await withActor(
    session.actor,
    async (tx): Promise<{ error: string } | { reference: string }> => {
      /*
      The branch is the enquiry's, not the form's. The dialog defaulted to the
      session's first branch, so a KWI enquiry got a DXB quotation (S7); the
      form still posts one for the register's unbound dialog, and it is
      ignored rather than trusted.
    */
      const [enquiry] = await tx
        .select({ branchId: enquiries.branchId, status: enquiries.status })
        .from(enquiries)
        .where(eq(enquiries.id, data.enquiryId))
        .limit(1)
      if (!enquiry) throw new Error('not_found')
      assertCanIn(session, 'quote.send', enquiry.branchId)
      if (['won', 'lost', 'cancelled', 'expired'].includes(enquiry.status)) {
        return { error: tv('quoteEnquiryClosed') }
      }

      // The next version for this enquiry, and the previous one superseded in
      // the same transaction — so there is never a moment where two versions of
      // a quotation are both live. Shared with "Price it", which numbers the
      // same way because it is the same act.
      const next = await nextQuoteVersion(tx, data.enquiryId, {
        // Superseding a quotation the customer may be holding is a revision,
        // and a different right from raising the first one (S6).
        assertRevise: () => assertCan(session, 'quote.revise'),
      })
      if (!next.ok) {
        return {
          error:
            next.reason === 'quote_accepted' ? tv('quoteAlreadyAccepted') : tv('nothingToUpdate'),
        }
      }

      const marginPct =
        Number(data.totalSell) > 0
          ? Number(
              (
                ((Number(data.totalSell) - Number(data.totalCost)) / Number(data.totalSell)) *
                100
              ).toFixed(2),
            )
          : 0

      const [row] = await tx
        .insert(quotes)
        .values({
          reference: next.reference,
          enquiryId: data.enquiryId,
          branchId: enquiry.branchId,
          version: next.version,
          status: 'draft',
          currency: data.currency,
          totalSell: data.totalSell,
          totalCost: data.totalCost,
          validUntil: data.validUntil,
          pricedSnapshot: {
            pricedAt: new Date().toISOString(),
            marginPct,
            notes: data.notes,
          },
          preparedById: session.principal.id,
        })
        .returning({ id: quotes.id, reference: quotes.reference })

      /*
        A revision starts from the version it replaces (QA P2-5).

        "New quotation" on a priced enquiry made v2 with no lines at all, so
        the customer's revised offer printed a total over an empty table and
        every charge had to be typed again. The previous version's lines are
        copied onto the new draft, where they stay editable, and — the S10
        rule — once a draft has lines they are the offer, so the sell total
        follows them. Only lines in the new version's currency travel: a
        revision into another currency is a new price, and a quotation with
        lines in two currencies has no total.
      */
      if (next.previousId) {
        const copied = await tx.execute(sql`
          insert into quote_lines
                 (quote_id, charge_type_id, description, basis, quantity, rate, amount,
                  currency, sort_order)
          select ${row!.id}, charge_type_id, description, basis, quantity, rate, amount,
                 currency, sort_order
            from quote_lines
           where quote_id = ${next.previousId} and currency = ${data.currency}
           order by sort_order, created_at
        `)
        if ((copied.rowCount ?? 0) > 0) await totalFollowsLines(tx, row!.id)
      }

      await retireQuoteVersion(tx, next.previousId, row!.id)

      return { reference: row!.reference }
    },
  )

  if ('error' in outcome) return failWith(outcome.error, echo(form))

  revalidatePath('/quotes')
  revalidatePath(`/enquiries/${data.enquiryId}`)
  revalidatePath('/dashboard')
  return succeed(outcome.reference)
})

/**
 * A draft's sell total, restated as the sum of its lines, and its frozen
 * margin percentage restated against the cost it already carries (S10). In
 * SQL, on `numeric`: the total is money and never passes through a float.
 */
async function totalFollowsLines(tx: Tx, quoteId: string): Promise<void> {
  await tx.execute(sql`
    update quotes q
       set total_sell = l.total,
           priced_snapshot = jsonb_set(
             coalesce(q.priced_snapshot, '{}'::jsonb), '{marginPct}',
             to_jsonb(case when l.total > 0
                           then round((l.total - coalesce(q.total_cost, 0)) / l.total * 100, 2)
                           else 0 end)),
           updated_at = now()
      from (select sum(amount) as total from quote_lines where quote_id = ${quoteId}) l
     where q.id = ${quoteId}
  `)
}

/** Add a priced line to a draft quotation. */
export const addQuoteLine = refuseForbidden(async function addQuoteLine(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const session = await requireSession()
  assertCan(session, 'quote.send')
  const demo = await demoReadOnly(form)
  if (demo) return demo
  const tv = await getTranslations('ledgerValidation')

  const schema = z.object({
    quoteId: z.uuid(),
    chargeTypeId: z.uuid(tv('chooseCharge')),
    basis: z.enum(['flat', 'per_unit', 'per_kg', 'per_container', 'per_day', 'percent']),
    quantity: money(tv('quantityNumber')),
    rate: money(tv('rateNumber')),
    currency: z
      .string()
      .trim()
      .length(3)
      .transform((v) => v.toUpperCase()),
    description: z
      .string()
      .trim()
      .max(200)
      .optional()
      .transform((v) => v || null),
  })

  const parsed = await localeParse(schema, {
    quoteId: read(form, 'quoteId'),
    chargeTypeId: read(form, 'chargeTypeId'),
    basis: read(form, 'basis') ?? 'flat',
    quantity: read(form, 'quantity') ?? '1',
    rate: read(form, 'rate') ?? '',
    currency: read(form, 'currency') ?? 'USD',
    description: read(form, 'description'),
  })
  if (!parsed.success) return fail(fieldErrors(parsed.error), echo(form))

  const data = parsed.data

  const refused = await withActor(session.actor, async (tx) => {
    // Locked, so two lines added at once both land in the total below.
    const [quote] = await tx
      .select({ status: quotes.status, currency: quotes.currency })
      .from(quotes)
      .where(eq(quotes.id, data.quoteId))
      .limit(1)
      .for('update')
    if (!quote) throw new Error('not_found')
    if (quote.status !== 'draft') return 'sent' as const
    /*
      The dialog fixes the currency to the quotation's in a hidden field, and
      the action took whatever was posted (S10). A quotation whose lines are in
      two currencies has no total, so the server says no as well.
    */
    if (data.currency !== quote.currency) return 'currency' as const

    // The amount is multiplied in PostgreSQL, on `numeric`, rather than in
    // JavaScript. `0.1 * 3` is not `0.3` in a float and a quotation is not the
    // place to find that out. Rounded to the currency's own minor units, so
    // the line printed is the line summed.
    await tx.insert(quoteLines).values({
      quoteId: data.quoteId,
      chargeTypeId: data.chargeTypeId,
      description: data.description,
      basis: data.basis,
      quantity: data.quantity,
      rate: data.rate,
      amount: sql`round(${data.quantity}::numeric * ${data.rate}::numeric,
                        (select minor_units from currencies where code = ${quote.currency}))`,
      currency: quote.currency,
    })

    /*
      The total is the lines (S10). A manual quotation was created with a
      typed total and then given lines, and nothing reconciled the two: the
      PDF printed the lines and then an unrelated stored total beneath them.
      Once a draft has lines they are the offer, so the sell total follows
      them, and the frozen margin percentage is restated against the cost the
      quotation already carries.
    */
    await totalFollowsLines(tx, data.quoteId)
    return null
  })

  /*
    Returned, not thrown. The dialog is only offered on a draft, so this is a
    quotation sent from another tab while this one sat open — an ordinary
    race, and thrown it reached the error boundary, where production redacts
    the one sentence that says why the line was not added.
  */
  if (refused === 'sent') return failWith(tv('quoteSentNoEdit'), echo(form))
  if (refused === 'currency') return failWith(tv('quoteLineCurrency'), echo(form))

  revalidatePath(`/quotes/${data.quoteId}`)
  return succeed(data.chargeTypeId)
})

/** Send, accept or reject — the three moves that change a quote's meaning. */
export const setQuoteStatus = refuseForbidden(async function setQuoteStatus(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const session = await requireSession()
  const demo = await demoReadOnly(form)
  if (demo) return demo

  const quoteId = read(form, 'quoteId')
  const status = read(form, 'status')
  const tv = await getTranslations('ledgerValidation')
  if (!quoteId || !status) return fail({ _: tv('nothingToUpdate') })

  const permission =
    status === 'accepted' ? 'quote.accept' : status === 'rejected' ? 'quote.reject' : 'quote.send'
  assertCan(session, permission)

  /*
    The move itself is `moveQuote` in `@qabandi/db`, shared with the customer
    portal's Accept and Decline (D12), so the machine, the validity rule, the
    outbox and the enquiry's status are one implementation whichever door the
    decision came through.
  */
  const moved = await withActor(session.actor, (tx) =>
    moveQuote(tx, quoteId, status as 'sent', { by: 'staff' }),
  )
  if (!moved.ok) {
    if (moved.refusal === 'transition') return failWith(tv('quoteBadTransition'))
    if (moved.refusal === 'lapsed') return failWith(tv('quoteLapsed'))
    throw new Error('not_found')
  }

  revalidatePath('/quotes')
  revalidatePath(`/quotes/${quoteId}`)
  revalidatePath('/enquiries')
  return succeed(status)
})

/**
 * Ask the model to draft the quotation's covering note — FR-... the generative
 * surface behind the evaluation harness.
 *
 * Calls the service like "Read a bill" does, for the same reason: the web app
 * has no queue and no model client, so the drafting runs in the service and the
 * note is stored on the quote there. Only ever on a draft, and gated on
 * `quote.send` — the permission that also governs sending it. The model writes
 * prose; every figure stays owned by the pricing already frozen on the quote.
 */
export const draftQuoteCoverNote = refuseForbidden(async function draftQuoteCoverNote(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const session = await requireSession()
  const demo = await demoReadOnly(form)
  if (demo) return demo

  const quoteId = read(form, 'quoteId')
  const locale = read(form, 'locale') === 'ar' ? 'ar' : 'en'
  const tv = await getTranslations('ledgerValidation')
  if (!quoteId) return fail({ _: tv('nothingToDraft') })
  assertCan(session, 'quote.send')

  const [quote] = await withActor(session.actor, (tx) =>
    tx
      .select({ branchId: quotes.branchId, status: quotes.status })
      .from(quotes)
      .where(eq(quotes.id, quoteId))
      .limit(1),
  )
  if (!quote) return failWith(tv('noSuchQuote'))
  if (quote.status !== 'draft') return failWith(tv('coverNoteDraftOnly'))

  const serviceUrl = process.env.SERVICE_URL
  const secret = process.env.INTERNAL_API_SECRET
  if (!serviceUrl || !secret) return failWith(tv('coverNoteNeedsService'))
  const base = serviceUrl.replace(/\/$/, '')

  try {
    const response = await fetch(`${base}/internal/ai/quote-cover-note`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-internal-secret': secret },
      body: JSON.stringify({ actor: session.actor, branchId: quote.branchId, quoteId, locale }),
      cache: 'no-store',
      // A model writing a paragraph, not a page — but `invoke` has no retry of
      // its own, so this is the only ceiling.
      signal: AbortSignal.timeout(120_000),
    })

    if (!response.ok) {
      // 504: the model ran out of time or dropped its answer — worth another try (ai-12).
      if (response.status === 504) return failWith(tv('coverNoteTimedOut'))
      return failWith(response.status === 503 ? tv('coverNoteNoModel') : tv('coverNoteFailed'))
    }

    /*
      `refusal` is the service's English, for its own log — never shown. The
      code is worded here; one this file does not know (a newer service) gets
      the generic sentence rather than English in an Arabic screen.
    */
    const body = (await response.json()) as { note?: string | null; refusalCode?: string | null }
    if (!body.note) return failWith(coverNoteRefusal(tv, body.refusalCode) ?? tv('nothingDrafted'))

    revalidatePath(`/quotes/${quoteId}`)
    return succeed(body.note)
  } catch {
    return failWith(tv('coverNoteTimedOut'))
  }
})

/**
 * Every code `quote-cover-note.ts` in the service refuses with. Mirrored rather
 * than imported, because `apps/web` does not import the service.
 */
const COVER_NOTE_REFUSALS = ['not_found', 'not_draft'] as const

type CoverNoteRefusal = (typeof COVER_NOTE_REFUSALS)[number]

function isCoverNoteRefusal(code: unknown): code is CoverNoteRefusal {
  return typeof code === 'string' && (COVER_NOTE_REFUSALS as readonly string[]).includes(code)
}

/**
 * Why the service drafted nothing, in the reader's language — or null for the
 * caller's fallback. The `never` default keeps the switch exhaustive.
 */
function coverNoteRefusal(tv: Translate<'ledgerValidation'>, code: unknown): string | null {
  if (!isCoverNoteRefusal(code)) return null
  switch (code) {
    case 'not_found':
      return tv('noSuchQuote')
    case 'not_draft':
      // Checked here before the call too; this is the race where it was sent
      // between that check and the service's own read.
      return tv('coverNoteDraftOnly')
    default: {
      const unhandled: never = code
      return unhandled
    }
  }
}

const coverNoteSchema = z.object({
  quoteId: z.uuid(),
  locale: z.enum(['en', 'ar']),
  note: z.string().trim().max(1500),
})

/**
 * Save the covering note a coordinator wrote or edited.
 *
 * The other half of drafting: a plain textarea, so the drafted prose is a
 * starting point and not a decision. Only on a draft quote — a sent quotation
 * is history — and the `where` guards that again against a race, so a note
 * cannot appear on a quote that has just been sent.
 */
export const setQuoteCoverNote = refuseForbidden(async function setQuoteCoverNote(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const session = await requireSession()
  const demo = await demoReadOnly(form)
  if (demo) return demo

  const parsed = await localeParse(coverNoteSchema, {
    quoteId: read(form, 'quoteId'),
    locale: read(form, 'locale'),
    note: (form.get('note') as string | null) ?? '',
  })
  if (!parsed.success) return fail(fieldErrors(parsed.error))
  assertCan(session, 'quote.send')
  const tv = await getTranslations('ledgerValidation')

  const { quoteId, locale, note } = parsed.data
  const value = note.trim() === '' ? null : note.trim()

  const [updated] = await withActor(session.actor, (tx) =>
    tx
      .update(quotes)
      .set(
        locale === 'ar'
          ? { coverNoteAr: value, updatedAt: new Date() }
          : { coverNoteEn: value, updatedAt: new Date() },
      )
      .where(and(eq(quotes.id, quoteId), eq(quotes.status, 'draft')))
      .returning({ id: quotes.id }),
  )
  if (!updated) return failWith(tv('coverNoteEditDraftOnly'))

  revalidatePath(`/quotes/${quoteId}`)
  return succeed('saved')
})

// --- invoices --------------------------------------------------------------

/**
 * A quantity on an invoice line: a decimal greater than zero.
 *
 * Its own refusal for a negative or zero figure, because "-1" *is* a number
 * and being told otherwise sends the clerk looking for a typo that is not
 * there. A correction to an issued invoice is a credit note, never a negative
 * line.
 */
const lineQuantity = (tv: Translate) =>
  z
    .string()
    .trim()
    .refine((v) => !v.startsWith('-'), tv('quantityMoreThanZero'))
    .pipe(money(tv('quantityNumber')))
    .refine(aboveZero, tv('quantityMoreThanZero'))

/** An exchange rate typed on a form: optional, and above zero where given. */
const optionalRate = (tv: Translate) => optionalMoney(tv).refine(aboveZero, tv('fxRatePositive'))

/**
 * The currency's minor units, from the table that is the authority on them
 * (NFR-02). Two where a currency is somehow missing, which is the common case
 * and never more precise than the column.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function minorUnits(tx: any, currency: string): Promise<number> {
  const [row] = await tx
    .select({ minorUnits: currencies.minorUnits })
    .from(currencies)
    .where(eq(currencies.code, currency))
    .limit(1)
  return row?.minorUnits ?? 2
}

/**
 * A line's amount and tax, each rounded to the currency at the line.
 *
 * Unrounded, a KWD line of 3 × 560.433883 stored 1681.301650 — shown on the
 * page as 1,681.302, so a customer paying the figure they were shown was told
 * it was more than they owed, and paying 1,681.301 left the invoice part-paid
 * for ever. Rounding each line, then summing, is the NFR-02 rule: the header
 * is always a sum of figures the currency can actually hold.
 */
function lineFigures(
  quantity: string,
  unitPrice: string,
  taxRatePercent: string,
  taxable: boolean,
  currency: string,
  units: number,
): { amount: string; taxAmount: string } {
  const spec = { code: currency, minorUnits: units }
  const amount = round(moneyOf(dec(quantity).times(dec(unitPrice)), currency), spec)
  const tax = taxable
    ? round(moneyOf(amount.amount.times(dec(taxRatePercent)).dividedBy(100), currency), spec)
    : moneyOf(0, currency)
  return { amount: amount.amount.toFixed(), taxAmount: tax.amount.toFixed() }
}

/**
 * The rate to the branch's base currency for a receipt or a hand-raised
 * invoice — 1 in base, what was typed where something was, and otherwise the
 * latest rate on file (the same lookup the credit check uses).
 *
 * Null where none of those exists, which the caller refuses: a USD receipt
 * stored at rate 1 cleared a USD 10,000 receivable as 10,000 KWD in the
 * export, and nothing downstream could tell.
 */
async function rateToBase(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx: any,
  branchId: string,
  currency: string,
  typed: string | null,
): Promise<{ rate: string | null; base: string }> {
  const [branch] = await tx
    .select({ base: branches.baseCurrency })
    .from(branches)
    .where(eq(branches.id, branchId))
    .limit(1)
  const base: string = branch?.base ?? currency
  if (base === currency) return { rate: '1', base }
  if (typed) return { rate: typed, base }
  return { rate: await latestFxRate(tx, currency, base), base }
}

/**
 * Header totals recomputed from the lines, so a corrected line cannot leave
 * the header permanently out by the difference.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function rollInvoiceTotals(tx: any, invoiceId: string): Promise<void> {
  await tx.execute(sql`
    update invoices set
      subtotal   = coalesce((select sum(amount)     from invoice_lines where invoice_id = ${invoiceId}), 0),
      tax_amount = coalesce((select sum(tax_amount) from invoice_lines where invoice_id = ${invoiceId}), 0),
      total      = coalesce((select sum(amount) + sum(tax_amount) from invoice_lines where invoice_id = ${invoiceId}), 0),
      updated_at = now()
    where id = ${invoiceId}
  `)
}

const invoiceSchema = (tv: Translate) =>
  z.object({
    branchId: z.uuid(tv('chooseBranch')),
    customerId: z.uuid(tv('chooseCustomer')),
    currency: z
      .string()
      .trim()
      .length(3)
      .transform((v) => v.toUpperCase()),
    subtotal: money(tv('enterSubtotal')).refine(aboveZero, tv('amountMustBePositive')),
    descriptionEn: z.string().trim().min(1, tv('describeCharge')).max(200),
    chargeTypeId: z
      .uuid()
      .optional()
      .or(z.literal('').transform(() => undefined)),
    fxRate: optionalRate(tv),
    taxTreatment: z.enum(['out_of_scope', 'zero_rated', 'exempt', 'standard', 'reverse_charge']),
    taxRatePercent: z
      .string()
      .trim()
      .regex(/^\d+(\.\d{1,4})?$/, tv('percentage'))
      .default('0'),
    dueOn: z.string().trim().min(1, tv('invoiceNeedsDueDate')),
    language: z.enum(['en', 'ar']),
    notes: z
      .string()
      .trim()
      .max(1000)
      .optional()
      .transform((v) => v || null),
  })

/**
 * A draft invoice, with its first line.
 *
 * The typed amount becomes a *line*, not a header figure. It used to be
 * written onto the header alone: the export builds receivables from lines, so
 * the invoice posted nothing at all, and the first line added afterwards
 * recomputed the header and silently threw the typed subtotal away. Every
 * total on an invoice is now a sum of its lines, however it was raised.
 */
export const createInvoice = refuseForbidden(async function createInvoice(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const session = await requireSession()
  assertCan(session, 'invoice.approve')
  const demo = await demoReadOnly(form)
  if (demo) return demo
  const tv = await getTranslations('ledgerValidation')

  const parsed = await localeParse(invoiceSchema(tv), {
    branchId: read(form, 'branchId'),
    customerId: read(form, 'customerId'),
    currency: read(form, 'currency') ?? 'KWD',
    subtotal: read(form, 'subtotal') ?? '',
    descriptionEn: read(form, 'descriptionEn') ?? '',
    chargeTypeId: read(form, 'chargeTypeId'),
    fxRate: read(form, 'fxRate'),
    taxTreatment: read(form, 'taxTreatment') ?? 'out_of_scope',
    taxRatePercent: read(form, 'taxRatePercent') ?? '0',
    dueOn: read(form, 'dueOn') ?? '',
    language: read(form, 'language') ?? 'en',
    notes: read(form, 'notes'),
  })
  if (!parsed.success) return fail(fieldErrors(parsed.error), echo(form))

  const data = parsed.data
  assertCanIn(session, 'invoice.approve', data.branchId)

  const rate = data.taxTreatment === 'standard' ? data.taxRatePercent : '0'

  const outcome = await withActor(session.actor, async (tx) => {
    const fx = await rateToBase(tx, data.branchId, data.currency, data.fxRate)
    if (!fx.rate) return { error: 'no_rate' as const, base: fx.base }

    const [invoice] = await tx
      .insert(invoices)
      .values({
        branchId: data.branchId,
        customerId: data.customerId,
        status: 'draft',
        currency: data.currency,
        taxTreatment: data.taxTreatment,
        taxRatePercent: rate,
        fxRate: fx.rate,
        language: data.language,
        dueOn: data.dueOn,
        notes: data.notes,
      })
      .returning({ id: invoices.id })

    const taxable = dec(rate).greaterThan(0)
    const figures = lineFigures(
      '1',
      data.subtotal,
      rate,
      taxable,
      data.currency,
      await minorUnits(tx, data.currency),
    )
    await tx.insert(invoiceLines).values({
      invoiceId: invoice!.id,
      chargeTypeId: data.chargeTypeId ?? null,
      descriptionEn: data.descriptionEn,
      quantity: '1',
      unitPrice: data.subtotal,
      amount: figures.amount,
      taxAmount: figures.taxAmount,
      isTaxable: taxable,
    })
    await rollInvoiceTotals(tx, invoice!.id)
    return { error: null, id: invoice!.id }
  })

  if (outcome.error === 'no_rate') {
    return fail(
      { fxRate: tv('fxRateNeeded', { currency: data.currency, base: outcome.base }) },
      echo(form),
    )
  }

  revalidatePath('/invoices')
  revalidatePath('/finance')
  return succeed(data.customerId)
})

/** Add a charge line to a draft invoice, and roll the totals forward. */
export const addInvoiceLine = refuseForbidden(async function addInvoiceLine(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const session = await requireSession()
  assertCan(session, 'invoice.approve')
  const demo = await demoReadOnly(form)
  if (demo) return demo
  const tv = await getTranslations('ledgerValidation')

  const schema = z.object({
    invoiceId: z.uuid(),
    chargeTypeId: z
      .uuid()
      .optional()
      .or(z.literal('').transform(() => undefined)),
    descriptionEn: z.string().trim().min(1, tv('describeCharge')).max(200),
    quantity: lineQuantity(tv),
    unitPrice: money(tv('unitPriceNumber')),
    isTaxable: z.coerce.boolean(),
  })

  const parsed = await localeParse(schema, {
    invoiceId: read(form, 'invoiceId'),
    chargeTypeId: read(form, 'chargeTypeId'),
    descriptionEn: read(form, 'descriptionEn') ?? '',
    quantity: read(form, 'quantity') ?? '1',
    unitPrice: read(form, 'unitPrice') ?? '',
    isTaxable: form.get('isTaxable') !== null,
  })
  if (!parsed.success) return fail(fieldErrors(parsed.error), echo(form))

  const data = parsed.data

  const refused = await withActor(session.actor, async (tx) => {
    /*
      Locked, and only ever a draft.

      This read used to fetch the status and ignore it, so a line could be
      added to an issued — or paid — invoice, changing a statutory document
      the customer already holds. The lock makes the check hold against an
      approval or an issue landing between this read and the insert.
    */
    const [invoice] = await tx
      .select({
        status: invoices.status,
        rate: invoices.taxRatePercent,
        currency: invoices.currency,
      })
      .from(invoices)
      .where(eq(invoices.id, data.invoiceId))
      .limit(1)
      .for('update')
    if (!invoice) throw new Error('not_found')
    if (invoice.status !== 'draft') return true

    const figures = lineFigures(
      data.quantity,
      data.unitPrice,
      invoice.rate,
      data.isTaxable,
      invoice.currency,
      await minorUnits(tx, invoice.currency),
    )
    await tx.insert(invoiceLines).values({
      invoiceId: data.invoiceId,
      chargeTypeId: data.chargeTypeId ?? null,
      descriptionEn: data.descriptionEn,
      quantity: data.quantity,
      unitPrice: data.unitPrice,
      amount: figures.amount,
      taxAmount: figures.taxAmount,
      isTaxable: data.isTaxable,
    })

    await rollInvoiceTotals(tx, data.invoiceId)
    return false
  })

  if (refused) return failWith(tv('invoiceNotDraftNoEdit'), echo(form))

  revalidatePath(`/invoices/${data.invoiceId}`)
  revalidatePath('/invoices')
  return succeed(data.descriptionEn)
})

/** Approve, issue, void or credit. Each is a different permission. */
export const setInvoiceStatus = refuseForbidden(async function setInvoiceStatus(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const session = await requireSession()
  const demo = await demoReadOnly(form)
  if (demo) return demo

  const invoiceId = read(form, 'invoiceId')
  const status = read(form, 'status')
  const tv = await getTranslations('ledgerValidation')
  if (!invoiceId || !status) return fail({ _: tv('nothingToUpdate') })

  const permission =
    status === 'issued'
      ? 'invoice.issue'
      : status === 'void'
        ? 'invoice.void'
        : status === 'credited'
          ? 'invoice.credit'
          : 'invoice.approve'
  assertCan(session, permission)

  /*
    Credit is checked before the number is allocated, not inside the mutation.

    Two reasons, and the second is the one that matters. An abandoned issue
    must not consume a series number — a gap in a statutory series is exactly
    what an auditor asks about — so the check has to come first. And
    `checkCredit` opens its own actor transaction; calling it inside the one
    below would hold two pooled connections for a single unit of work, which is
    how a busy month-end deadlocks.

    Only on issue. Voiding or crediting an invoice *reduces* exposure, and
    blocking the correction that would bring a customer back under their limit
    is precisely backwards.
  */
  if (status === 'issued') {
    const blocked = await creditBlockOnIssue(session, invoiceId, tv)
    if (blocked) return blocked
  }

  try {
    await withActor(session.actor, async (tx) => {
      const [current] = await tx
        .select({
          status: invoices.status,
          branchId: invoices.branchId,
          seriesNo: invoices.seriesNo,
          customerId: invoices.customerId,
          total: invoices.total,
          currency: invoices.currency,
          dueOn: invoices.dueOn,
          isCreditNote: invoices.isCreditNote,
        })
        .from(invoices)
        .where(eq(invoices.id, invoiceId))
        .limit(1)
        /*
          Locked for the rest of the transaction. Two clicks on Issue both read
          "approved, no number" without it, and each allocated a series number
          — the second overwrote the first, leaving a permanent gap in a
          statutory sequence. With the lock the second waits, then reads
          "issued" and is refused by the machine.
        */
        .for('update')
      if (!current) throw new Error('not_found')

      assertTransition(invoiceMachine, current.status, status as 'issued')

      /*
        Nothing with no lines is approved or issued. The export builds the
        receivable from the lines, so an invoice without any posts nothing
        while asking the customer for its header total.
      */
      if (status === 'approved' || status === 'issued') {
        const [lines] = await tx
          .select({ count: sql<number>`count(*)::int` })
          .from(invoiceLines)
          .where(eq(invoiceLines.invoiceId, invoiceId))
        if (!lines || Number(lines.count) === 0) throw new Error('invoice_no_lines')
      }

      /**
       * The number is allocated at *issue*, not at creation.
       *
       * A draft that is abandoned must not consume a number, because a gap in
       * a statutory series is precisely what an auditor asks about.
       *
       * The counter lives on the branch — `invoice_series` and
       * `invoice_series_next` — rather than in a PostgreSQL sequence, and that
       * is the right design rather than an accident: the series is per branch,
       * and one global sequence would hand KWI 1, 3, 4 and DXB 2, 5, leaving
       * both with gaps they cannot explain.
       *
       * The increment is atomic, so the read and the bump cannot be interleaved
       * by a second transaction. Two people issuing in the same branch at the
       * same instant queue on that row's lock; two in different branches never
       * contend at all.
       *
       * It goes through `app.allocate_series_number` rather than updating
       * `branches` here, because `branches` is configuration and its write
       * policy requires `admin.branches.write` — which `finance` does not hold.
       * Written inline, the update matched no rows for the very role that
       * issues invoices and this threw `not_found`. The function is
       * `security definer` and re-checks branch membership and `invoice.issue`
       * itself; migration 0016 has the whole account.
       */
      let seriesNo = current.seriesNo
      if (status === 'issued' && !seriesNo) {
        const allocated = await tx.execute(
          sql`select app.allocate_series_number(${current.branchId}::uuid, 'invoice') as next`,
        )
        const numbered = allocated.rows[0] as { next: string | null } | undefined
        if (!numbered?.next) throw new Error('not_found')
        seriesNo = numbered.next
      }

      const [moved] = await tx
        .update(invoices)
        .set({
          status: status as 'issued',
          seriesNo,
          issuedAt: status === 'issued' ? sql`coalesce(${invoices.issuedAt}, now())` : undefined,
          issuedById: status === 'issued' ? session.principal.id : undefined,
          /*
            An invoice issued with no due date fell into no ageing bucket and
            was never overdue — every draft billed from a job was one. The
            customer's terms at this branch, from today, where nobody set one.
          */
          dueOn:
            status === 'issued'
              ? sql`coalesce(${invoices.dueOn}, current_date + coalesce((
                  select t.payment_terms_days from customer_branch_terms t
                   where t.customer_id = "invoices"."customer_id"
                     and t.branch_id = "invoices"."branch_id"
                ), 30))`
              : undefined,
          updatedAt: new Date(),
        })
        // The status it was read in, as well as the lock: belt and braces on
        // the one write that consumes a statutory number.
        .where(and(eq(invoices.id, invoiceId), eq(invoices.status, current.status)))
        .returning({ dueOn: invoices.dueOn })

      /*
        A voided draft gives its revenue back. Billing a job stamps each charge
        line with the invoice it went on, which is what keeps it off a second
        invoice — and voiding the draft left the stamp, so the revenue was off
        the unbilled register and could never be billed again. Only a draft or
        an approved invoice can be voided, so nothing here has been sent.
      */
      if (status === 'void') {
        await tx
          .update(chargeLines)
          .set({ invoiceId: null, updatedAt: new Date() })
          .where(eq(chargeLines.invoiceId, invoiceId))
      }

      if (status === 'credited') {
        if (current.isCreditNote) throw new Error('invoice_transition_credit_note')
        // "Credit note raised" credits whatever is still owed — the whole
        // invoice unless part of it was paid or credited already (F9).
        await raiseCreditNote(tx, invoiceId, session.principal.id, 'rest')
      }

      /*
        FR-NT-01, and only on issue.

        Voiding and crediting are deliberately silent here. Both are corrections
        the operator makes, often within minutes, and a customer who receives
        "invoice raised" followed by "invoice voided" learns that the sender's
        accounting is unstable rather than that it is careful. The credit note
        is itself an invoice and announces itself when *it* is issued.

        The number is used rather than the id, because `series_no` is what the
        customer can quote back — and it was allocated immediately above, so it
        is never null on this path.
      */
      if (status === 'issued') {
        await tx.insert(notificationOutbox).values({
          branchId: current.branchId,
          eventKey: 'invoice.issued',
          customerId: current.customerId,
          payload: {
            seriesNo,
            // As above: the currency's precision, not the column's.
            total: toScale(fromDb(current.total, current.currency)),
            currency: current.currency,
            dueOn: moved?.dueOn ?? current.dueOn ?? '',
          },
        })
      }
    })
  } catch (error) {
    if (error instanceof Error && error.message.includes('transition')) {
      return failWith(tv('invoiceBadTransition'))
    }
    if (error instanceof Error && error.message === 'invoice_no_lines') {
      return failWith(tv('invoiceNoLines'))
    }
    // "Credit note raised" on an invoice with nothing left to credit.
    if (error instanceof CreditRefused) {
      return failWith(
        error.reason === 'exceeds_creditable'
          ? tv('creditExceedsOwed', { creditable: error.creditable, currency: error.currency })
          : tv('amountMustBePositive'),
      )
    }
    throw error
  }

  revalidatePath('/invoices')
  revalidatePath(`/invoices/${invoiceId}`)
  revalidatePath('/finance')
  return succeed(status)
})

/**
 * The credit note behind "Credit note raised", and behind a partial credit —
 * §5.5, F9.
 *
 * Crediting used to flip the invoice's status and nothing else: no document,
 * so the export posted the revenue and never reversed it, while ageing and
 * top debtors kept counting the balance and the credit exposure did not.
 * Now it raises the note as its own statutory document, numbered from the
 * branch series, pointing at what it reverses.
 *
 * Amounts are positive with `is_credit_note` set — the convention the export
 * already reverses on (`core/accounting.ts`), and the one the pilot data
 * shows. The note is born `credited` with `amount_paid` equal to its total,
 * which is how a credited document leaves every "what is owed" query without
 * being deleted.
 *
 * `amount` is what to credit, or `'rest'` for whatever is still owed. The
 * lines are the invoice's own, scaled by `planCreditNote` in core so each one
 * reverses revenue on the account its original posted to. The invoice's
 * `amount_credited` is re-derived from its notes, and a note that leaves
 * nothing owed moves it to `credited`; one that leaves something keeps it
 * issued or part paid, owing less.
 *
 * The rate travels with it — the invoice's own, or the one on the charge
 * lines it was billed from — so the reversal posts at exactly the figure the
 * original did. The caller holds the invoice's row lock and has checked its
 * state; a refusal comes back as a `CreditRefused`.
 */
async function raiseCreditNote(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx: any,
  invoiceId: string,
  principalId: string,
  amount: string | 'rest',
  notes: string | null = null,
): Promise<{ seriesNo: string; total: string; closes: boolean }> {
  const [original] = await tx
    .select({
      branchId: invoices.branchId,
      customerId: invoices.customerId,
      currency: invoices.currency,
      subtotal: invoices.subtotal,
      taxAmount: invoices.taxAmount,
      total: invoices.total,
      amountPaid: invoices.amountPaid,
      amountCredited: invoices.amountCredited,
      taxTreatment: invoices.taxTreatment,
      taxRatePercent: invoices.taxRatePercent,
      language: invoices.language,
      fxRate: sql<string | null>`coalesce(${invoices.fxRate}, (
        select cl.fx_rate from charge_lines cl where cl.invoice_id = "invoices"."id" limit 1
      ))`,
    })
    .from(invoices)
    .where(eq(invoices.id, invoiceId))
    .limit(1)
  if (!original) throw new Error('not_found')

  const lines: {
    chargeTypeId: string | null
    descriptionEn: string
    descriptionAr: string | null
    quantity: string
    unitPrice: string
    amount: string
    taxAmount: string
    isTaxable: boolean
    sortOrder: number
  }[] = await tx
    .select({
      chargeTypeId: invoiceLines.chargeTypeId,
      descriptionEn: invoiceLines.descriptionEn,
      descriptionAr: invoiceLines.descriptionAr,
      quantity: invoiceLines.quantity,
      unitPrice: invoiceLines.unitPrice,
      amount: invoiceLines.amount,
      taxAmount: invoiceLines.taxAmount,
      isTaxable: invoiceLines.isTaxable,
      sortOrder: invoiceLines.sortOrder,
    })
    .from(invoiceLines)
    .where(eq(invoiceLines.invoiceId, invoiceId))
    .orderBy(invoiceLines.sortOrder, invoiceLines.id)

  const spec = { code: original.currency, minorUnits: await minorUnits(tx, original.currency) }
  const invoice = { ...original, lines }
  /*
    "The rest" rounds down to the currency's places. An older invoice can carry
    a total finer than its currency (1681.301650 KWD), and rounding that up
    asks for more than is owed, which the planner rightly refuses; the fraction
    of a fils left over is below anything the currency can pay.
  */
  const credit =
    amount === 'rest'
      ? creditableAmount(invoice).toFixed(spec.minorUnits, 1 /* Decimal.ROUND_DOWN */)
      : amount
  const planned = planCreditNote(invoice, credit, spec)
  if (!planned.ok) throw new CreditRefused(planned.reason, planned.creditable, original.currency)
  const { plan } = planned

  const allocated = await tx.execute(
    sql`select app.allocate_series_number(${original.branchId}::uuid, 'invoice') as next`,
  )
  const seriesNo = (allocated.rows[0] as { next: string | null } | undefined)?.next
  if (!seriesNo) throw new Error('not_found')

  const [note] = await tx
    .insert(invoices)
    .values({
      branchId: original.branchId,
      customerId: original.customerId,
      seriesNo,
      status: 'credited',
      isCreditNote: true,
      creditsInvoiceId: invoiceId,
      currency: original.currency,
      subtotal: plan.subtotal,
      taxAmount: plan.taxAmount,
      total: plan.total,
      amountPaid: plan.total,
      taxTreatment: original.taxTreatment,
      taxRatePercent: original.taxRatePercent,
      fxRate: original.fxRate,
      language: original.language,
      notes,
      issuedAt: new Date(),
      issuedById: principalId,
    })
    .returning({ id: invoices.id })

  /*
    The whole invoice keeps its own quantities and prices, so a full credit
    note reads line for line like what it reverses. A part of it cannot — a
    third of "2 x 150.000" is not a quantity anyone shipped — so each line is
    one of its scaled amount.
  */
  const whole = dec(plan.total).equals(dec(original.total))
  if (lines.length > 0) {
    await tx.insert(invoiceLines).values(
      lines.map((line, index) => ({
        invoiceId: note!.id,
        chargeTypeId: line.chargeTypeId,
        descriptionEn: line.descriptionEn,
        descriptionAr: line.descriptionAr,
        quantity: whole ? line.quantity : '1',
        unitPrice: whole ? line.unitPrice : plan.lines[index]!.amount,
        amount: plan.lines[index]!.amount,
        taxAmount: plan.lines[index]!.taxAmount,
        isTaxable: line.isTaxable,
        sortOrder: line.sortOrder,
      })),
    )
  }

  /*
    Credited re-derived from the notes rather than incremented, as receipts
    are (`settled.ts`). `amount_paid` is left alone: an opening balance
    imported at cutover carries a paid figure with no receipts behind it,
    and re-deriving it here would put that money back on the customer.
  */
  await tx.execute(sql`
    update invoices set
      amount_credited = coalesce((select sum(n.total) from invoices n
                                   where n.credits_invoice_id = ${invoiceId}
                                     and n.is_credit_note and n.status <> 'void'), 0),
      status = ${plan.closes ? sql`'credited'::invoice_status` : sql`status`},
      updated_at = now()
    where id = ${invoiceId}
  `)

  return { seriesNo, total: plan.total, closes: plan.closes }
}

/** A partial credit the invoice cannot take, with what it can. */
class CreditRefused extends Error {
  constructor(
    readonly reason: CreditNoteRefusal,
    readonly creditable: string,
    readonly currency: string,
  ) {
    super(`credit_${reason}`)
  }
}

/**
 * Credit part of an issued or part-paid invoice — F9.
 *
 * "Credit note raised" reversed the whole invoice and nothing smaller. A
 * customer disputing one line, or owed a goodwill reduction, could only be
 * credited everything and invoiced again for the rest — two statutory
 * numbers and a statement nobody could follow. This raises one note for the
 * amount typed, up to what is still owed.
 *
 * The branch is the invoice's, checked with `assertCanIn`: `invoice.credit`
 * held in Dubai does not credit a Kuwait invoice.
 */
export const creditInvoice = refuseForbidden(async function creditInvoice(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const session = await requireSession()
  assertCan(session, 'invoice.credit')
  const demo = await demoReadOnly(form)
  if (demo) return demo
  const tv = await getTranslations('ledgerValidation')

  const invoiceId = read(form, 'invoiceId')
  // Grouped or Arabic-digit amounts read as the figure they are (QA P3).
  const rawAmount = read(form, 'amount')
  const amount = rawAmount === undefined ? undefined : normaliseAmount(rawAmount)
  const notes = read(form, 'notes')?.slice(0, 1000) ?? null
  if (!invoiceId) return failWith(tv('nothingToUpdate'))
  if (!amount || !/^\d+(\.\d{1,6})?$/.test(amount)) {
    return fail({ amount: tv('creditAmountNumber') }, echo(form))
  }

  let raised: { seriesNo: string; total: string; closes: boolean; currency: string }
  try {
    raised = await withActor(session.actor, async (tx) => {
      const [current] = await tx
        .select({
          status: invoices.status,
          branchId: invoices.branchId,
          isCreditNote: invoices.isCreditNote,
          currency: invoices.currency,
        })
        .from(invoices)
        .where(eq(invoices.id, invoiceId))
        .limit(1)
        // Two people crediting at once must not both fit under the ceiling.
        .for('update')
      if (!current) throw new Error('not_found')
      assertCanIn(session, 'invoice.credit', current.branchId)
      if (current.isCreditNote || !['issued', 'part_paid'].includes(current.status)) {
        throw new Error('invoice_transition_credit')
      }
      const note = await raiseCreditNote(tx, invoiceId, session.principal.id, amount, notes)
      return { ...note, currency: current.currency }
    })
  } catch (error) {
    if (error instanceof CreditRefused) {
      const message =
        error.reason === 'exceeds_creditable'
          ? tv('creditExceedsOwed', { creditable: error.creditable, currency: error.currency })
          : error.reason === 'too_precise'
            ? tv('creditTooPrecise')
            : tv('amountMustBePositive')
      return fail({ amount: message }, echo(form))
    }
    if (error instanceof Error && error.message.includes('transition')) {
      return failWith(tv('invoiceBadTransition'))
    }
    throw error
  }

  revalidatePath('/invoices')
  revalidatePath(`/invoices/${invoiceId}`)
  revalidatePath('/finance')
  return succeed(raised.seriesNo)
})

/**
 * The credit gate on invoice issuance.
 *
 * Returns the failure to hand back, or null to proceed. Separated from
 * `setInvoiceStatus` because that function is already long and this is a
 * complete thought: read the invoice, ask the shared rule, translate the
 * answer into a sentence a finance clerk can act on.
 *
 * The sentence names the number and the excess. "Credit limit exceeded" tells
 * the clerk to go and find out by how much, and they will do it in a
 * spreadsheet.
 */
async function creditBlockOnIssue(
  session: Awaited<ReturnType<typeof requireSession>>,
  invoiceId: string,
  tv: Translate,
): Promise<ActionState | null> {
  const [invoice] = await withActor(session.actor, (tx) =>
    tx
      .select({
        customerId: invoices.customerId,
        branchId: invoices.branchId,
        total: invoices.total,
        currency: invoices.currency,
        isCreditNote: invoices.isCreditNote,
      })
      .from(invoices)
      .where(eq(invoices.id, invoiceId))
      .limit(1),
  )
  if (!invoice) return null

  // A credit note reduces what is owed. Refusing to issue one because the
  // customer is over their limit would be refusing to lower the balance.
  if (invoice.isCreditNote) return null

  const { assessment, allowed, standing, unconverted } = await checkCredit(session.actor, {
    customerId: invoice.customerId,
    branchId: invoice.branchId,
    proposed: fromDb(invoice.total, invoice.currency),
    invoiceId,
    refuseUnconvertible: true,
  })

  if (allowed) return null
  if (unconverted && assessment.outcome !== 'on_hold') {
    return failWith(tv('creditNoRate', { currency: unconverted, limit: standing.currency }))
  }

  const excess = `${toScale(assessment.excess)} ${standing.currency}`
  return failWith(
    assessment.outcome === 'on_hold' ? tv('creditHold') : tv('creditLimitExceeded', { excess }),
  )
}

// --- receipts --------------------------------------------------------------

const paymentSchema = (tv: Translate) =>
  z.object({
    branchId: z.uuid(tv('chooseBranch')),
    customerId: z.uuid(tv('chooseCustomer')),
    amount: money(tv('enterAmountReceived')).refine(aboveZero, tv('amountMustBePositive')),
    currency: z
      .string()
      .trim()
      .length(3)
      .transform((v) => v.toUpperCase()),
    receivedOn: z.string().trim().min(1, tv('whenReceived')),
    method: z.enum(['bank_transfer', 'cheque', 'cash', 'card', 'offset']),
    reference: z
      .string()
      .trim()
      .max(80)
      .optional()
      .transform((v) => v || null),
    fxRate: optionalRate(tv),
    notes: z
      .string()
      .trim()
      .max(500)
      .optional()
      .transform((v) => v || null),
    /** Optional: settle one invoice straight away, which is the common case. */
    invoiceId: z
      .uuid()
      .optional()
      .or(z.literal('').transform(() => undefined)),
  })

export const recordPayment = refuseForbidden(async function recordPayment(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const session = await requireSession()
  assertCan(session, 'payment.record')
  const demo = await demoReadOnly(form)
  if (demo) return demo
  const tv = await getTranslations('ledgerValidation')

  const parsed = await localeParse(paymentSchema(tv), {
    branchId: read(form, 'branchId'),
    customerId: read(form, 'customerId'),
    amount: read(form, 'amount') ?? '',
    currency: read(form, 'currency') ?? 'KWD',
    receivedOn: read(form, 'receivedOn') ?? '',
    method: read(form, 'method') ?? 'bank_transfer',
    reference: read(form, 'reference'),
    fxRate: read(form, 'fxRate'),
    notes: read(form, 'notes'),
    invoiceId: read(form, 'invoiceId'),
  })
  if (!parsed.success) return fail(fieldErrors(parsed.error), echo(form))

  const data = parsed.data
  assertCanIn(session, 'payment.record', data.branchId)

  try {
    const outcome = await withActor(session.actor, async (tx) => {
      /*
        The rate the money arrived at — typed, or the latest on file, and
        refused where there is neither. It was always stored as 1: the dialog
        had no field for it, so a USD receipt reached the ledger at face value.
      */
      const fx = await rateToBase(tx, data.branchId, data.currency, data.fxRate)
      if (!fx.rate) return { error: 'no_rate' as const, base: fx.base }

      const [payment] = await tx
        .insert(payments)
        .values({
          branchId: data.branchId,
          customerId: data.customerId,
          amount: data.amount,
          currency: data.currency,
          fxRate: fx.rate,
          receivedOn: data.receivedOn,
          method: data.method,
          reference: data.reference,
          notes: data.notes,
          recordedById: session.principal.id,
        })
        .returning({ id: payments.id })

      // A refusal here throws, and the receipt rolls back with it: a cheque
      // recorded against the wrong invoice is re-entered, not half-kept.
      if (data.invoiceId) {
        await allocate(tx, payment!.id, data.invoiceId, data.amount)
      }
      return { error: null }
    })

    if (outcome.error === 'no_rate') {
      return fail(
        { fxRate: tv('fxRateNeeded', { currency: data.currency, base: outcome.base }) },
        echo(form),
      )
    }
  } catch (error) {
    const refused = allocationRefusal(error, tv)
    if (refused) return fail(refused, echo(form))
    throw error
  }

  revalidatePath('/payments')
  revalidatePath('/invoices')
  revalidatePath('/finance')
  return succeed(data.amount)
})

/** Match an existing receipt against an invoice. */
export const allocatePayment = refuseForbidden(async function allocatePayment(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const session = await requireSession()
  assertCan(session, 'payment.record')
  const demo = await demoReadOnly(form)
  if (demo) return demo
  const tv = await getTranslations('ledgerValidation')

  const paymentId = read(form, 'paymentId')
  const invoiceId = read(form, 'invoiceId')
  // Grouped or Arabic-digit amounts read as the figure they are (QA P3).
  const rawAmount = read(form, 'amount')
  const amount = rawAmount === undefined ? undefined : normaliseAmount(rawAmount)
  if (!paymentId || !invoiceId) return fail({ invoiceId: tv('chooseInvoiceToSettle') })
  if (!amount || !/^\d+(\.\d{1,6})?$/.test(amount)) {
    return fail({ amount: tv('enterAllocation') }, echo(form))
  }

  try {
    await withActor(session.actor, (tx) => allocate(tx, paymentId, invoiceId, amount))
  } catch (error) {
    const refused = allocationRefusal(error, tv)
    if (refused) return fail(refused, echo(form))
    throw error
  }

  revalidatePath('/payments')
  revalidatePath('/invoices')
  revalidatePath('/finance')
  return succeed(invoiceId)
})

/**
 * Why an allocation was refused, as the field error that says so — or null
 * for an error that is not a refusal and should reach the boundary.
 *
 * Shared by both actions. `recordPayment` used to catch none of these, so a
 * customer paying exactly the balance shown on an unrounded invoice got a 500
 * where `allocatePayment` gave the same case a sentence.
 */
function allocationRefusal(error: unknown, tv: Translate): Record<string, string> | null {
  if (error instanceof SettlementError) return { amount: tv('amountMustBePositive') }
  if (error instanceof AllocationRefused) {
    switch (error.code) {
      case 'over_allocated':
        return { amount: tv('overAllocated') }
      case 'over_invoiced':
        return { amount: tv('overInvoiced') }
      case 'not_payable':
        return { invoiceId: tv('invoiceNotPayable') }
      case 'currency_mismatch':
        return {
          invoiceId: tv('receiptCurrencyMismatch', {
            received: error.values.received ?? '',
            invoiced: error.values.invoiced ?? '',
          }),
        }
      case 'other_customer':
        return { invoiceId: tv('invoiceOtherCustomer') }
      case 'other_branch':
        return { invoiceId: tv('invoiceOtherBranch') }
      default: {
        const unhandled: never = error.code
        return unhandled
      }
    }
  }
  return null
}

class AllocationRefused extends Error {
  constructor(
    readonly code:
      | 'over_allocated'
      | 'over_invoiced'
      | 'not_payable'
      | 'currency_mismatch'
      | 'other_customer'
      | 'other_branch',
    readonly values: Readonly<Record<string, string>> = {},
  ) {
    super(code)
    this.name = 'AllocationRefused'
  }
}

/**
 * The allocation itself, with every check inside the transaction.
 *
 * The two ceilings — not more of a receipt than was received, not more of an
 * invoice than is owed — and the four things that make an allocation
 * meaningful at all: the invoice is issued and still owed (a draft has no
 * number, and a credited or voided one is owed by nobody), and the receipt is
 * the same customer's, the same branch's and in the invoice's currency. 500
 * KWD settling a 500 USD invoice is not a payment; it is a typo the ledger
 * would keep.
 *
 * Both rows are locked first. Without it two allocations against one invoice
 * each read "120 owed" and together settled 240 of it; with it the second
 * waits and reads the first one's result.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function allocate(tx: any, paymentId: string, invoiceId: string, amount: string) {
  const [invoice] = await tx
    .select({
      status: invoices.status,
      seriesNo: invoices.seriesNo,
      currency: invoices.currency,
      customerId: invoices.customerId,
      branchId: invoices.branchId,
      total: invoices.total,
      amountCredited: invoices.amountCredited,
    })
    .from(invoices)
    .where(eq(invoices.id, invoiceId))
    .limit(1)
    .for('update')
  const [payment] = await tx
    .select({
      amount: payments.amount,
      currency: payments.currency,
      customerId: payments.customerId,
      branchId: payments.branchId,
    })
    .from(payments)
    .where(eq(payments.id, paymentId))
    .limit(1)
    .for('update')
  if (!invoice || !payment) throw new Error('not_found')

  if (!['issued', 'part_paid'].includes(invoice.status) || !invoice.seriesNo) {
    throw new AllocationRefused('not_payable')
  }
  if (invoice.currency !== payment.currency) {
    throw new AllocationRefused('currency_mismatch', {
      received: payment.currency,
      invoiced: invoice.currency,
    })
  }
  if (invoice.customerId !== payment.customerId) throw new AllocationRefused('other_customer')
  if (invoice.branchId !== payment.branchId) throw new AllocationRefused('other_branch')

  const result = await tx.execute(sql`
    select
      coalesce((select sum(amount) from payment_allocations
                 where payment_id = ${paymentId}), 0)::numeric as allocated,
      -- Receipts and agreed set-offs both settle an invoice: the same sum
      -- rederiveInvoiceSettlement writes, or a netted invoice could be paid
      -- again in cash.
      (coalesce((select sum(amount) from payment_allocations
                  where invoice_id = ${invoiceId}), 0)
       + coalesce((select sum(sl.amount) from partner_settlement_lines sl
                     join partner_settlements ps on ps.id = sl.settlement_id
                    where sl.invoice_id = ${invoiceId}
                      and ps.status in ('agreed', 'settled')), 0)
       -- And what was paid before cutover (F22), or an imported part-paid
       -- invoice could be paid in full a second time.
       + (select i.amount_paid_opening from invoices i where i.id = ${invoiceId}))::numeric as settled
  `)
  const row = result.rows[0] as { allocated: string | null; settled: string | null } | undefined

  /*
    The ceilings are decided in `core` — see `settlement.ts` for why they are
    not decided here.
  */
  const verdict = checkSettlement(
    amount,
    positionFromDb(
      {
        received: payment.amount,
        allocated: row?.allocated ?? null,
        // What a partial credit note took off is no longer there to pay (F9).
        invoiced: dec(invoice.total).minus(dec(invoice.amountCredited)).toFixed(),
        settled: row?.settled ?? null,
      },
      invoice.currency,
    ),
    invoice.currency,
  )
  if (!verdict.ok) throw new AllocationRefused(verdict.reason)

  /*
    A top-up adds to the allocation already there.

    `payment_allocations` is unique on (payment, invoice), so the second part
    of one receipt against the same invoice hit a raw unique violation. The
    ceilings above were checked against the sum *including* the existing row,
    so incrementing it is exactly as safe as a new one would have been.
  */
  await tx
    .insert(paymentAllocations)
    .values({ paymentId, invoiceId, amount })
    .onConflictDoUpdate({
      target: [paymentAllocations.paymentId, paymentAllocations.invoiceId],
      set: {
        amount: sql`${paymentAllocations.amount} + excluded.amount`,
        updatedAt: new Date(),
      },
    })

  // Paid-to-date and status re-derived from everything set against it —
  // receipts and agreed set-offs alike (`packages/db/src/settled.ts`).
  await rederiveInvoiceSettlement(tx, invoiceId)
}

// --- billing what was earned ----------------------------------------------

/**
 * One shipment's unbilled revenue, as a draft invoice — in one act.
 *
 * The path this replaces is the whole problem. A coordinator reads the job's
 * charge lines on one screen and retypes each of them into `addInvoiceLine` on
 * another, which is slow, and slow is why it gets deferred, and deferred is
 * why `unbilled.ts` exists at all. Nothing here is cleverer than that loop —
 * it is the same insert the form does, run once per line, inside one
 * transaction, from figures that are already on the shipment.
 *
 * ## It lands as a draft, and every gate after it is unchanged
 *
 * `draft` is where `createInvoice` puts a hand-typed invoice too. Approving,
 * numbering and issuing remain exactly the acts they were, under exactly the
 * permissions they were. This does not shorten the path to *sending a customer
 * a bill*; it shortens the path to *having one to check*.
 *
 * ## Why the lines are stamped inside the same transaction
 *
 * `charge_lines.invoice_id` is what makes a line billed, and it is what stops
 * the same revenue being invoiced twice. Setting it in the same transaction as
 * the insert means the failure mode is "nothing happened" rather than "an
 * invoice exists and the lines are still loose" — which would put the same
 * money on a second invoice the next time anybody looked at this register.
 *
 * ## One currency, or none
 *
 * An invoice carries a single currency. A job billing in both USD and KWD is
 * refused rather than converted, because converting here would invent an FX
 * rate on the sell side that nobody agreed with the customer — and the ledger
 * already holds the rate each line was booked at, which is a different number
 * and the right one for the cost side only.
 */
export const billJob = refuseForbidden(async function billJob(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const session = await requireSession()
  assertCan(session, 'invoice.approve')
  const demo = await demoReadOnly(form)
  if (demo) return demo
  const tv = await getTranslations('ledgerValidation')

  const jobId = read(form, 'jobId')
  if (!jobId) return failWith(tv('nothingToDo'))

  const outcome = await withActor(session.actor, async (tx) => {
    const [job] = await tx
      .select({
        id: jobs.id,
        branchId: jobs.branchId,
        customerId: jobs.customerId,
        reference: jobs.reference,
      })
      .from(jobs)
      .where(eq(jobs.id, jobId))
      .limit(1)

    if (!job) return { error: 'gone' as const }
    if (!job.customerId) return { error: 'no_customer' as const }

    const lines = await tx
      .select({
        id: chargeLines.id,
        description: chargeLines.description,
        chargeTypeId: chargeLines.chargeTypeId,
        chargeNameEn: chargeTypes.nameEn,
        chargeNameAr: chargeTypes.nameAr,
        quantity: chargeLines.quantity,
        rate: chargeLines.rate,
        amount: chargeLines.amount,
        currency: chargeLines.currency,
      })
      .from(chargeLines)
      .leftJoin(chargeTypes, eq(chargeTypes.id, chargeLines.chargeTypeId))
      .where(
        and(
          eq(chargeLines.jobId, jobId),
          eq(chargeLines.direction, 'revenue'),
          eq(chargeLines.isAccrual, false),
          isNull(chargeLines.invoiceId),
        ),
      )
      .orderBy(chargeLines.createdAt)

    if (lines.length === 0) return { error: 'nothing_to_bill' as const }

    const currencies = [...new Set(lines.map((line) => line.currency))]
    if (currencies.length > 1) {
      return { error: 'mixed_currency' as const, currencies }
    }

    const currency = currencies[0]!
    // Plain values for the terms lookup below — bound as parameters.
    const customerId = job.customerId
    const jobBranchId = job.branchId

    /*
      Tax is out of scope until somebody says otherwise, which is the same
      default `invoices` carries. Kuwait has no VAT today and the column exists
      because Saudi and the UAE do; guessing a treatment here would put a tax
      figure on a document from a branch that does not charge it.
    */
    const [invoice] = await tx
      .insert(invoices)
      .values({
        branchId: job.branchId,
        customerId: job.customerId,
        status: 'draft',
        currency,
        subtotal: '0',
        taxAmount: '0',
        total: '0',
        /*
          The customer's terms at this branch, from today — redrawn at issue
          if this draft waits. Without it these invoices were in no ageing
          bucket and never overdue.
        */
        dueOn: sql`current_date + coalesce((
          select t.payment_terms_days from customer_branch_terms t
           where t.customer_id = ${customerId} and t.branch_id = ${jobBranchId}
        ), 30)`,
        // One stored form, said in each reader's language on the way out
        // (NEW-6): in the drafter's language, the Arabic PDF printed English.
        notes: billedFromNote(job.reference),
      })
      .returning({ id: invoices.id })

    const invoiceId = invoice!.id

    await tx.insert(invoiceLines).values(
      lines.map((line, index) => ({
        invoiceId,
        chargeTypeId: line.chargeTypeId,
        /*
          The line's own description, else the charge's name — in both
          languages, because the Arabic invoice prints `description_ar`.

          `description` is nullable on `charge_lines` and `description_en` is
          not on `invoice_lines`, which is the right way round: an internal
          ledger line may be terse, and a document a customer reads may not be
          blank. The fallback was the shipment reference, so an undescribed
          line read "KWI-JOB-2026-00012" in English and nothing in Arabic (QA
          P2-6); the charge type is what the line actually is.
        */
        descriptionEn: line.description ?? line.chargeNameEn ?? job.reference,
        descriptionAr: line.chargeNameAr ?? null,
        quantity: line.quantity,
        unitPrice: line.rate,
        amount: line.amount,
        taxAmount: '0',
        isTaxable: false,
        sortOrder: index,
      })),
    )

    await tx
      .update(chargeLines)
      .set({ invoiceId, updatedAt: new Date() })
      .where(
        inArray(
          chargeLines.id,
          lines.map((line) => line.id),
        ),
      )

    // Recomputed from the lines, for the reason `addInvoiceLine` gives: a
    // header summed by hand is a header that is eventually out by a correction.
    await tx.execute(sql`
      update invoices set
        subtotal   = coalesce((select sum(amount)     from invoice_lines where invoice_id = ${invoiceId}), 0),
        tax_amount = coalesce((select sum(tax_amount) from invoice_lines where invoice_id = ${invoiceId}), 0),
        total      = coalesce((select sum(amount) + sum(tax_amount) from invoice_lines where invoice_id = ${invoiceId}), 0),
        updated_at = now()
      where id = ${invoiceId}
    `)

    return { ok: true as const, invoiceId, count: lines.length }
  })

  if ('error' in outcome) {
    if (outcome.error === 'mixed_currency') {
      // The joining word is the catalogue's too: " and " reads as "USD and
      // KWD" in English and as nothing sensible in the Arabic sentence.
      return failWith(
        tv('mixedCurrency', { currencies: outcome.currencies.join(tv('currencyJoiner')) }),
      )
    }
    if (outcome.error === 'no_customer') return failWith(tv('billNoCustomer'))
    if (outcome.error === 'nothing_to_bill') return failWith(tv('nothingUnbilled'))
    return failWith(tv('shipmentGone'))
  }

  revalidatePath('/finance')
  revalidatePath('/invoices')
  revalidatePath(`/invoices/${outcome.invoiceId}`)
  revalidatePath(`/jobs/${jobId}`)
  return succeed(outcome.invoiceId)
})
