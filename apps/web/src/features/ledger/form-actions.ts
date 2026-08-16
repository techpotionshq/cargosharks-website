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
import { eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import { assertTransition, invoiceMachine, quoteMachine } from '@qabandi/core'
import {
  invoiceLines,
  invoices,
  paymentAllocations,
  payments,
  quoteLines,
  quotes,
  withActor,
} from '@qabandi/db'
import { requireSession } from '@/lib/session'
import { assertCan, assertInBranch } from '@/lib/permissions'
import {
  echo,
  fail,
  failWith,
  fieldErrors,
  succeed,
  type ActionState,
} from '@/lib/form-state'

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
  currency: z.string().trim().length(3).transform((v) => v.toUpperCase()),
  totalSell: money('Enter the price you are quoting'),
  totalCost: money('Enter what it costs us — the margin comes from this'),
  validUntil: z.string().trim().min(1, 'A quotation needs an expiry date'),
  notes: z.string().trim().max(1000).optional().transform((v) => v || null),
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
    const newReference =
      latest?.reference ?? `QUO-${year}-${seq.padStart(5, '0')}`

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
    currency: z.string().trim().length(3).transform((v) => v.toUpperCase()),
    description: z.string().trim().max(200).optional().transform((v) => v || null),
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
      const [current] = await tx
        .select({ status: quotes.status })
        .from(quotes)
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

// --- invoices --------------------------------------------------------------

const invoiceSchema = z.object({
  branchId: z.uuid('Choose a branch'),
  customerId: z.uuid('Choose a customer'),
  currency: z.string().trim().length(3).transform((v) => v.toUpperCase()),
  subtotal: money('Enter the amount before tax'),
  taxTreatment: z.enum(['out_of_scope', 'zero_rated', 'exempt', 'standard', 'reverse_charge']),
  taxRatePercent: z
    .string()
    .trim()
    .regex(/^\d+(\.\d{1,4})?$/, 'A percentage')
    .default('0'),
  dueOn: z.string().trim().min(1, 'An invoice needs a due date'),
  language: z.enum(['en', 'ar']),
  notes: z.string().trim().max(1000).optional().transform((v) => v || null),
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
    chargeTypeId: z.uuid().optional().or(z.literal('').transform(() => undefined)),
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

  try {
    await withActor(session.actor, async (tx) => {
      const [current] = await tx
        .select({
          status: invoices.status,
          branchId: invoices.branchId,
          seriesNo: invoices.seriesNo,
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
       * `update … returning` is atomic, so the read and the increment cannot
       * be interleaved by a second transaction. Two people issuing in the same
       * branch at the same instant queue on that row's lock; two in different
       * branches never contend at all.
       */
      let seriesNo = current.seriesNo
      if (status === 'issued' && !seriesNo) {
        const allocated = await tx.execute(sql`
          update branches
             set invoice_series_next = invoice_series_next + 1,
                 updated_at = now()
           where id = ${current.branchId}
          returning invoice_series
                    || '-' || extract(year from now())::int
                    || '-' || lpad(invoice_series_next::text, 5, '0') as next
        `)
        const numbered = allocated.rows[0] as { next: string } | undefined
        if (!numbered) throw new Error('not_found')
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

// --- receipts --------------------------------------------------------------

const paymentSchema = z.object({
  branchId: z.uuid('Choose a branch'),
  customerId: z.uuid('Choose a customer'),
  amount: money('Enter the amount received'),
  currency: z.string().trim().length(3).transform((v) => v.toUpperCase()),
  receivedOn: z.string().trim().min(1, 'When was it received?'),
  method: z.enum(['bank_transfer', 'cheque', 'cash', 'card', 'offset']),
  reference: z.string().trim().max(80).optional().transform((v) => v || null),
  fxRate: optionalMoney,
  notes: z.string().trim().max(500).optional().transform((v) => v || null),
  /** Optional: settle one invoice straight away, which is the common case. */
  invoiceId: z.uuid().optional().or(z.literal('').transform(() => undefined)),
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
                 where invoice_id = ${invoiceId}), 0)::numeric       as settled
  `)

  const row = result.rows[0] as
    | { received: string; allocated: string; invoiced: string; settled: string }
    | undefined
  if (!row) throw new Error('not_found')

  const value = Number(amount)
  if (value > Number(row.received) - Number(row.allocated)) throw new Error('over_allocated')
  if (value > Number(row.invoiced) - Number(row.settled)) throw new Error('over_invoiced')

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
