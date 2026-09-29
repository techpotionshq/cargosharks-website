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
import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import { z } from 'zod'
import {
  assertTransition,
  checkSettlement,
  fromDb,
  invoiceMachine,
  positionFromDb,
  quoteMachine,
  toScale,
} from '@qabandi/core'
import {
  chargeLines,
  checkCredit,
  enquiries,
  invoiceLines,
  invoices,
  jobs,
  notificationOutbox,
  paymentAllocations,
  payments,
  quoteLines,
  quotes,
  withActor,
} from '@qabandi/db'
import { requireSession } from '@/lib/session'
import { assertCan, assertInBranch } from '@/lib/permissions'
import { echo, fail, failWith, fieldErrors, succeed, type ActionState } from '@/lib/form-state'

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
const money = (message = 'Amount must be a number') =>
  z
    .string()
    .trim()
    .regex(/^\d+(\.\d{1,6})?$/, message)

const optionalMoney = z
  .string()
  .trim()
  .regex(/^\d*(\.\d{1,6})?$/, 'Numbers only')
  .optional()
  .transform((v) => (v ? v : null))

// --- quotations ------------------------------------------------------------

const quoteSchema = z.object({
  enquiryId: z.uuid('Choose an enquiry'),
  branchId: z.uuid('Choose a branch'),
  currency: z
    .string()
    .trim()
    .length(3)
    .transform((v) => v.toUpperCase()),
  totalSell: money('Enter the price you are quoting'),
  totalCost: money('Enter what it costs us — the margin comes from this'),
  validUntil: z.string().trim().min(1, 'A quotation needs an expiry date'),
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
export async function createQuote(_previous: ActionState, form: FormData): Promise<ActionState> {
  const session = await requireSession()
  assertCan(session, 'quote.send')

  const parsed = quoteSchema.safeParse({
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
  assertInBranch(session, data.branchId)

  if (Number(data.totalCost) > Number(data.totalSell)) {
    return fail(
      { totalSell: 'The price is below what it costs us. Check the figures before sending.' },
      echo(form),
    )
  }

  const reference = await withActor(session.actor, async (tx) => {
    // The next version for this enquiry, and the previous one superseded in
    // the same transaction — so there is never a moment where two versions of
    // a quotation are both live.
    const [latest] = await tx
      .select({ id: quotes.id, version: quotes.version, reference: quotes.reference })
      .from(quotes)
      .where(eq(quotes.enquiryId, data.enquiryId))
      .orderBy(sql`${quotes.version} desc`)
      .limit(1)

    const version = (latest?.version ?? 0) + 1
    const result = await tx.execute(sql`select nextval('quote_reference_seq')::text as seq`)
    const seq = (result.rows[0] as { seq: string }).seq
    const year = new Date().getUTCFullYear()
    const newReference = latest?.reference ?? `QUO-${year}-${seq.padStart(5, '0')}`

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
        reference: version === 1 ? newReference : `${newReference}-v${version}`,
        enquiryId: data.enquiryId,
        branchId: data.branchId,
        version,
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
      .returning({ reference: quotes.reference })

    if (latest) {
      await tx
        .update(quotes)
        .set({ status: 'superseded', updatedAt: new Date() })
        .where(eq(quotes.id, latest.id))
    }

    return row!.reference
  })

  revalidatePath('/quotes')
  revalidatePath('/dashboard')
  return succeed(reference)
}

/** Add a priced line to a draft quotation. */
export async function addQuoteLine(_previous: ActionState, form: FormData): Promise<ActionState> {
  const session = await requireSession()
  assertCan(session, 'quote.send')

  const schema = z.object({
    quoteId: z.uuid(),
    chargeTypeId: z.uuid('Choose a charge'),
    basis: z.enum(['flat', 'per_unit', 'per_kg', 'per_container', 'per_day', 'percent']),
    quantity: money('Quantity must be a number'),
    rate: money('Rate must be a number'),
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

  const parsed = schema.safeParse({
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

  await withActor(session.actor, async (tx) => {
    const [quote] = await tx
      .select({ status: quotes.status })
      .from(quotes)
      .where(eq(quotes.id, data.quoteId))
      .limit(1)
    if (!quote) throw new Error('not_found')
    if (quote.status !== 'draft') throw new Error('not_draft')

    // The amount is multiplied in PostgreSQL, on `numeric`, rather than in
    // JavaScript. `0.1 * 3` is not `0.3` in a float and a quotation is not the
    // place to find that out.
    await tx.insert(quoteLines).values({
      quoteId: data.quoteId,
      chargeTypeId: data.chargeTypeId,
      description: data.description,
      basis: data.basis,
      quantity: data.quantity,
      rate: data.rate,
      amount: sql`${data.quantity}::numeric * ${data.rate}::numeric`,
      currency: data.currency,
    })
  }).catch((error: Error) => {
    if (error.message === 'not_draft') throw new Error('A sent quotation cannot be edited.')
    throw error
  })

  revalidatePath(`/quotes/${data.quoteId}`)
  return succeed(data.chargeTypeId)
}

/** Send, accept or reject — the three moves that change a quote's meaning. */
export async function setQuoteStatus(_previous: ActionState, form: FormData): Promise<ActionState> {
  const session = await requireSession()

  const quoteId = read(form, 'quoteId')
  const status = read(form, 'status')
  if (!quoteId || !status) return fail({ _: 'Nothing to update.' })

  const permission =
    status === 'accepted' ? 'quote.accept' : status === 'rejected' ? 'quote.reject' : 'quote.send'
  assertCan(session, permission)

  try {
    await withActor(session.actor, async (tx) => {
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
        })
        .from(quotes)
        .innerJoin(enquiries, eq(enquiries.id, quotes.enquiryId))
        .where(eq(quotes.id, quoteId))
        .limit(1)
      if (!current) throw new Error('not_found')

      assertTransition(quoteMachine, current.status, status as 'sent')

      await tx
        .update(quotes)
        .set({
          status: status as 'sent',
          sentAt: status === 'sent' ? sql`coalesce(${quotes.sentAt}, now())` : undefined,
          decidedAt: ['accepted', 'rejected'].includes(status) ? new Date() : undefined,
          updatedAt: new Date(),
        })
        .where(eq(quotes.id, quoteId))

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
            /*
              At the currency's own precision, not the column's.

              `numeric(19,6)` comes back as `1250.000000`, and a quotation that
              quotes a KWD figure to six decimal places reads as a machine
              rather than as a price. `toScale` puts it at the three decimals
              KWD actually has.
            */
            total: toScale(fromDb(current.totalSell, current.currency)),
            currency: current.currency,
            validUntil: current.validUntil ?? '',
          },
        })
      }
    })
  } catch (error) {
    if (error instanceof Error && error.message.includes('transition')) {
      return failWith('That quotation cannot move to that state from where it is.')
    }
    throw error
  }

  revalidatePath('/quotes')
  revalidatePath(`/quotes/${quoteId}`)
  return succeed(status)
}

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
export async function draftQuoteCoverNote(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const session = await requireSession()

  const quoteId = read(form, 'quoteId')
  const locale = read(form, 'locale') === 'ar' ? 'ar' : 'en'
  if (!quoteId) return fail({ _: 'Nothing to draft.' })
  assertCan(session, 'quote.send')

  const [quote] = await withActor(session.actor, (tx) =>
    tx
      .select({ branchId: quotes.branchId, status: quotes.status })
      .from(quotes)
      .where(eq(quotes.id, quoteId))
      .limit(1),
  )
  if (!quote) return failWith('No such quotation.')
  if (quote.status !== 'draft') {
    return failWith('A covering note can only be drafted on a draft quotation.')
  }

  const serviceUrl = process.env.SERVICE_URL
  const secret = process.env.INTERNAL_API_SECRET
  if (!serviceUrl || !secret) {
    return failWith(
      'Drafting a covering note needs the service. Set SERVICE_URL and ' +
        'INTERNAL_API_SECRET; a note can still be written by hand.',
    )
  }
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
      return failWith(
        response.status === 503
          ? 'No model is configured, so a covering note cannot be drafted yet. Add a key at Settings › Integrations.'
          : 'The covering note could not be drafted. Write one by hand, or try again.',
      )
    }

    const body = (await response.json()) as { note?: string | null; refusal?: string | null }
    if (!body.note) return failWith(body.refusal ?? 'Nothing was drafted.')

    revalidatePath(`/quotes/${quoteId}`)
    return succeed(body.note)
  } catch {
    return failWith('Drafting the covering note timed out. Write one by hand, or try again.')
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
export async function setQuoteCoverNote(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const session = await requireSession()

  const parsed = coverNoteSchema.safeParse({
    quoteId: read(form, 'quoteId'),
    locale: read(form, 'locale'),
    note: (form.get('note') as string | null) ?? '',
  })
  if (!parsed.success) return fail(fieldErrors(parsed.error))
  assertCan(session, 'quote.send')

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
  if (!updated) return failWith('That covering note can only be edited on a draft quotation.')

  revalidatePath(`/quotes/${quoteId}`)
  return succeed('saved')
}

// --- invoices --------------------------------------------------------------

const invoiceSchema = z.object({
  branchId: z.uuid('Choose a branch'),
  customerId: z.uuid('Choose a customer'),
  currency: z
    .string()
    .trim()
    .length(3)
    .transform((v) => v.toUpperCase()),
  subtotal: money('Enter the amount before tax'),
  taxTreatment: z.enum(['out_of_scope', 'zero_rated', 'exempt', 'standard', 'reverse_charge']),
  taxRatePercent: z
    .string()
    .trim()
    .regex(/^\d+(\.\d{1,4})?$/, 'A percentage')
    .default('0'),
  dueOn: z.string().trim().min(1, 'An invoice needs a due date'),
  language: z.enum(['en', 'ar']),
  notes: z
    .string()
    .trim()
    .max(1000)
    .optional()
    .transform((v) => v || null),
})

export async function createInvoice(_previous: ActionState, form: FormData): Promise<ActionState> {
  const session = await requireSession()
  assertCan(session, 'invoice.approve')

  const parsed = invoiceSchema.safeParse({
    branchId: read(form, 'branchId'),
    customerId: read(form, 'customerId'),
    currency: read(form, 'currency') ?? 'KWD',
    subtotal: read(form, 'subtotal') ?? '',
    taxTreatment: read(form, 'taxTreatment') ?? 'out_of_scope',
    taxRatePercent: read(form, 'taxRatePercent') ?? '0',
    dueOn: read(form, 'dueOn') ?? '',
    language: read(form, 'language') ?? 'en',
    notes: read(form, 'notes'),
  })
  if (!parsed.success) return fail(fieldErrors(parsed.error), echo(form))

  const data = parsed.data
  assertInBranch(session, data.branchId)

  // Tax and total are computed by PostgreSQL from the subtotal and the rate,
  // so the three columns cannot disagree — a total typed by hand is a total
  // that is eventually wrong.
  const rate = data.taxTreatment === 'standard' ? data.taxRatePercent : '0'

  await withActor(session.actor, async (tx) => {
    await tx.insert(invoices).values({
      branchId: data.branchId,
      customerId: data.customerId,
      status: 'draft',
      currency: data.currency,
      subtotal: data.subtotal,
      taxAmount: sql`round(${data.subtotal}::numeric * ${rate}::numeric / 100, 6)`,
      total: sql`${data.subtotal}::numeric + round(${data.subtotal}::numeric * ${rate}::numeric / 100, 6)`,
      taxTreatment: data.taxTreatment,
      taxRatePercent: rate,
      language: data.language,
      dueOn: data.dueOn,
      notes: data.notes,
    })
  })

  revalidatePath('/invoices')
  revalidatePath('/finance')
  return succeed(data.customerId)
}

/** Add a charge line to a draft invoice, and roll the totals forward. */
export async function addInvoiceLine(_previous: ActionState, form: FormData): Promise<ActionState> {
  const session = await requireSession()
  assertCan(session, 'invoice.approve')

  const schema = z.object({
    invoiceId: z.uuid(),
    chargeTypeId: z
      .uuid()
      .optional()
      .or(z.literal('').transform(() => undefined)),
    descriptionEn: z.string().trim().min(1, 'Describe the charge').max(200),
    quantity: money('Quantity must be a number'),
    unitPrice: money('Unit price must be a number'),
    isTaxable: z.coerce.boolean(),
  })

  const parsed = schema.safeParse({
    invoiceId: read(form, 'invoiceId'),
    chargeTypeId: read(form, 'chargeTypeId'),
    descriptionEn: read(form, 'descriptionEn') ?? '',
    quantity: read(form, 'quantity') ?? '1',
    unitPrice: read(form, 'unitPrice') ?? '',
    isTaxable: form.get('isTaxable') !== null,
  })
  if (!parsed.success) return fail(fieldErrors(parsed.error), echo(form))

  const data = parsed.data

  await withActor(session.actor, async (tx) => {
    const [invoice] = await tx
      .select({ status: invoices.status, rate: invoices.taxRatePercent })
      .from(invoices)
      .where(eq(invoices.id, data.invoiceId))
      .limit(1)
    if (!invoice) throw new Error('not_found')

    await tx.insert(invoiceLines).values({
      invoiceId: data.invoiceId,
      chargeTypeId: data.chargeTypeId ?? null,
      descriptionEn: data.descriptionEn,
      quantity: data.quantity,
      unitPrice: data.unitPrice,
      amount: sql`${data.quantity}::numeric * ${data.unitPrice}::numeric`,
      taxAmount: data.isTaxable
        ? sql`round(${data.quantity}::numeric * ${data.unitPrice}::numeric * ${invoice.rate}::numeric / 100, 6)`
        : '0',
      isTaxable: data.isTaxable,
    })

    // Recomputed from the lines rather than incremented, so a corrected line
    // cannot leave the header permanently out by the difference.
    await tx.execute(sql`
      update invoices set
        subtotal   = coalesce((select sum(amount)     from invoice_lines where invoice_id = ${data.invoiceId}), 0),
        tax_amount = coalesce((select sum(tax_amount) from invoice_lines where invoice_id = ${data.invoiceId}), 0),
        total      = coalesce((select sum(amount) + sum(tax_amount) from invoice_lines where invoice_id = ${data.invoiceId}), 0),
        updated_at = now()
      where id = ${data.invoiceId}
    `)
  })

  revalidatePath(`/invoices/${data.invoiceId}`)
  revalidatePath('/invoices')
  return succeed(data.descriptionEn)
}

/** Approve, issue, void or credit. Each is a different permission. */
export async function setInvoiceStatus(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const session = await requireSession()

  const invoiceId = read(form, 'invoiceId')
  const status = read(form, 'status')
  if (!invoiceId || !status) return fail({ _: 'Nothing to update.' })

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
    const blocked = await creditBlockOnIssue(session, invoiceId)
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
        })
        .from(invoices)
        .where(eq(invoices.id, invoiceId))
        .limit(1)
      if (!current) throw new Error('not_found')

      assertTransition(invoiceMachine, current.status, status as 'issued')

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

      await tx
        .update(invoices)
        .set({
          status: status as 'issued',
          seriesNo,
          issuedAt: status === 'issued' ? sql`coalesce(${invoices.issuedAt}, now())` : undefined,
          issuedById: status === 'issued' ? session.principal.id : undefined,
          updatedAt: new Date(),
        })
        .where(eq(invoices.id, invoiceId))

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
            dueOn: current.dueOn ?? '',
          },
        })
      }
    })
  } catch (error) {
    if (error instanceof Error && error.message.includes('transition')) {
      return failWith('That invoice cannot move to that state from where it is.')
    }
    throw error
  }

  revalidatePath('/invoices')
  revalidatePath(`/invoices/${invoiceId}`)
  revalidatePath('/finance')
  return succeed(status)
}

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

  const { assessment, allowed, standing } = await checkCredit(session.actor, {
    customerId: invoice.customerId,
    branchId: invoice.branchId,
    proposed: fromDb(invoice.total, invoice.currency),
    invoiceId,
  })

  if (allowed) return null

  const excess = `${toScale(assessment.excess)} ${standing.currency}`
  return failWith(
    assessment.outcome === 'on_hold'
      ? 'This customer is on credit hold. Release the hold on their account before issuing.'
      : `Issuing this invoice puts the customer ${excess} past their credit limit. ` +
          'A branch manager can record an override on the customer account.',
  )
}

// --- receipts --------------------------------------------------------------

const paymentSchema = z.object({
  branchId: z.uuid('Choose a branch'),
  customerId: z.uuid('Choose a customer'),
  amount: money('Enter the amount received'),
  currency: z
    .string()
    .trim()
    .length(3)
    .transform((v) => v.toUpperCase()),
  receivedOn: z.string().trim().min(1, 'When was it received?'),
  method: z.enum(['bank_transfer', 'cheque', 'cash', 'card', 'offset']),
  reference: z
    .string()
    .trim()
    .max(80)
    .optional()
    .transform((v) => v || null),
  fxRate: optionalMoney,
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

export async function recordPayment(_previous: ActionState, form: FormData): Promise<ActionState> {
  const session = await requireSession()
  assertCan(session, 'payment.record')

  const parsed = paymentSchema.safeParse({
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
  assertInBranch(session, data.branchId)

  await withActor(session.actor, async (tx) => {
    const [payment] = await tx
      .insert(payments)
      .values({
        branchId: data.branchId,
        customerId: data.customerId,
        amount: data.amount,
        currency: data.currency,
        fxRate: data.fxRate ?? '1',
        receivedOn: data.receivedOn,
        method: data.method,
        reference: data.reference,
        notes: data.notes,
        recordedById: session.principal.id,
      })
      .returning({ id: payments.id })

    if (data.invoiceId) {
      await allocate(tx, payment!.id, data.invoiceId, data.amount)
    }
  })

  revalidatePath('/payments')
  revalidatePath('/invoices')
  revalidatePath('/finance')
  return succeed(data.amount)
}

/** Match an existing receipt against an invoice. */
export async function allocatePayment(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const session = await requireSession()
  assertCan(session, 'payment.record')

  const paymentId = read(form, 'paymentId')
  const invoiceId = read(form, 'invoiceId')
  const amount = read(form, 'amount')
  if (!paymentId || !invoiceId) return fail({ invoiceId: 'Choose an invoice to settle.' })
  if (!amount || !/^\d+(\.\d{1,6})?$/.test(amount)) {
    return fail({ amount: 'Enter how much of this receipt settles that invoice.' }, echo(form))
  }

  try {
    await withActor(session.actor, (tx) => allocate(tx, paymentId, invoiceId, amount))
  } catch (error) {
    if (error instanceof Error && error.message === 'over_allocated') {
      return fail({ amount: 'That is more than is left unallocated on this receipt.' }, echo(form))
    }
    if (error instanceof Error && error.message === 'over_invoiced') {
      return fail({ amount: 'That is more than is still outstanding on that invoice.' }, echo(form))
    }
    throw error
  }

  revalidatePath('/payments')
  revalidatePath('/invoices')
  revalidatePath('/finance')
  return succeed(invoiceId)
}

/**
 * The allocation itself, with both ceilings checked inside the transaction.
 *
 * Both checks matter and they are different: you cannot allocate more of a
 * receipt than you received, and you cannot settle an invoice by more than it
 * is owed. Doing them in the same transaction as the insert is what makes them
 * hold when two people are allocating the same receipt at the same moment.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function allocate(tx: any, paymentId: string, invoiceId: string, amount: string) {
  const result = await tx.execute(sql`
    select
      (select amount from payments where id = ${paymentId})::numeric as received,
      coalesce((select sum(amount) from payment_allocations
                 where payment_id = ${paymentId}), 0)::numeric       as allocated,
      (select total from invoices where id = ${invoiceId})::numeric  as invoiced,
      coalesce((select sum(amount) from payment_allocations
                 where invoice_id = ${invoiceId}), 0)::numeric       as settled,
      (select currency from invoices where id = ${invoiceId})        as currency
  `)

  const row = result.rows[0] as
    | {
        received: string | null
        allocated: string | null
        invoiced: string | null
        settled: string | null
        currency: string | null
      }
    | undefined
  if (!row || row.received === null || row.invoiced === null) throw new Error('not_found')

  /*
    The ceilings are decided in `core` — see `settlement.ts` for why they are
    not decided here. The read and the insert stay in this one transaction,
    which is the half that cannot move: two people allocating the same receipt
    at the same moment must not both pass a check that was true when they read
    it.
  */
  const verdict = checkSettlement(
    amount,
    positionFromDb(row, row.currency ?? 'KWD'),
    row.currency ?? 'KWD',
  )
  if (!verdict.ok) throw new Error(verdict.reason)

  await tx.insert(paymentAllocations).values({ paymentId, invoiceId, amount })

  // The invoice's paid-to-date and its status are both derived from the
  // allocations, in one statement, so they cannot drift apart.
  await tx.execute(sql`
    update invoices set
      amount_paid = coalesce((select sum(amount) from payment_allocations
                               where invoice_id = ${invoiceId}), 0),
      status = case
        when coalesce((select sum(amount) from payment_allocations
                        where invoice_id = ${invoiceId}), 0) >= total then 'paid'::invoice_status
        when coalesce((select sum(amount) from payment_allocations
                        where invoice_id = ${invoiceId}), 0) > 0 then 'part_paid'::invoice_status
        else status
      end,
      updated_at = now()
    where id = ${invoiceId}
  `)
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
export async function billJob(_previous: ActionState, form: FormData): Promise<ActionState> {
  const session = await requireSession()
  assertCan(session, 'invoice.approve')

  const jobId = read(form, 'jobId')
  if (!jobId) return failWith('Nothing to do.')

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
        quantity: chargeLines.quantity,
        rate: chargeLines.rate,
        amount: chargeLines.amount,
        currency: chargeLines.currency,
      })
      .from(chargeLines)
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
        notes: `Billed from ${job.reference}`,
      })
      .returning({ id: invoices.id })

    const invoiceId = invoice!.id

    await tx.insert(invoiceLines).values(
      lines.map((line, index) => ({
        invoiceId,
        chargeTypeId: line.chargeTypeId,
        /*
          The line's own description, or the shipment reference as a fallback.

          `description` is nullable on `charge_lines` and `description_en` is
          not on `invoice_lines`, which is the right way round: an internal
          ledger line may be terse, and a document a customer reads may not be
          blank.
        */
        descriptionEn: line.description ?? job.reference,
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
      return failWith(
        `This shipment has revenue in ${outcome.currencies.join(' and ')}, and an invoice ` +
          'carries one currency. Bill them separately rather than converting — the sell-side ' +
          'rate is one the customer agreed, not one we hold.',
      )
    }
    if (outcome.error === 'no_customer') {
      return failWith('This shipment has no customer on it, so there is nobody to invoice.')
    }
    if (outcome.error === 'nothing_to_bill') {
      return failWith('Nothing unbilled is left on this shipment.')
    }
    return failWith('That shipment is no longer there.')
  }

  revalidatePath('/finance')
  revalidatePath('/invoices')
  revalidatePath(`/invoices/${outcome.invoiceId}`)
  revalidatePath(`/jobs/${jobId}`)
  return succeed(outcome.invoiceId)
}
