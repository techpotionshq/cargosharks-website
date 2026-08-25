'use server'

/**
 * Payables mutations — capture, match, approve, pay, net.
 *
 * Two of these matter commercially and the rest are bookkeeping around them.
 *
 * **Matching** is where a bill meets the accrual, and the moment an agent
 * billing 460 against a 400 accrual stops being invisible. The ceiling it
 * enforces — never more of a supplier line than they billed — is decided in
 * `core/matching.ts` and *enforced here*, inside the transaction that reads
 * the position, because a check outside the transaction is true when read and
 * false when written the moment two people work the same invoice.
 *
 * **Netting** is where a payable and a receivable cancel. It writes a document
 * rather than a calculation, because "we agreed 3,600 against your March
 * statement" has to be a row somebody can point at a year later.
 *
 * ## Approval is a separate act, and it is the point
 *
 * Anyone holding `payable.record` can capture what arrived and match it.
 * Releasing it for payment needs `payable.approve`, and where a line sits
 * outside tolerance the action refuses unless the approver explicitly accepts
 * the variance with a reason. That refusal is the whole feature: it is the
 * moment the argument with the agent happens, before the money leaves rather
 * than after.
 */

import { revalidatePath } from 'next/cache'
import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import { z } from 'zod'
import {
  D,
  SEED_CURRENCIES,
  checkMatch,
  checkSettlement,
  dec,
  matchPositionFromDb,
  money,
  netPosition,
  positionFromDb,
  type CurrencySpec,
} from '@qabandi/core'
import {
  invoices,
  partnerSettlementLines,
  partnerSettlements,
  partners,
  supplierInvoiceLines,
  supplierInvoiceMatches,
  supplierInvoices,
  supplierPaymentAllocations,
  supplierPayments,
  withActor,
} from '@qabandi/db'
import { requireSession } from '@/lib/session'
import { assertCan, assertInBranch } from '@/lib/permissions'
import {
  databaseMessage,
  echo,
  fail,
  failWith,
  fieldErrors,
  isUniqueViolation,
  succeed,
  type ActionState,
} from '@/lib/form-state'

function read(form: FormData, key: string): string | undefined {
  const value = form.get(key)
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

const spec = (code: string): CurrencySpec =>
  SEED_CURRENCIES.find((c) => c.code === code) ?? { code, minorUnits: 2 }

/** See `costing/form-actions.ts`: money is validated as text, never coerced. */
const decimalString = (label: string) =>
  z
    .string()
    .trim()
    .regex(/^\d+(\.\d{1,6})?$/, label)

const optionalUuid = z
  .uuid()
  .optional()
  .or(z.literal('').transform(() => undefined))

const isoDate = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter a date')

// --- capture ---------------------------------------------------------------

const billSchema = z.object({
  branchId: z.uuid('Choose a branch'),
  partnerId: z.uuid('Choose the supplier'),
  reference: z.string().trim().min(1, 'Enter their invoice number').max(60),
  currency: z.string().trim().length(3),
  fxRate: decimalString('Enter an exchange rate'),
  invoiceDate: isoDate,
  dueOn: isoDate.optional().or(z.literal('').transform(() => undefined)),
  taxAmount: decimalString('Enter the tax, or zero'),
  notes: z
    .string()
    .trim()
    .max(1000)
    .optional()
    .transform((v) => v || null),
})

export async function saveSupplierInvoice(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const session = await requireSession()
  assertCan(session, 'payable.record')

  const billId = read(form, 'supplierInvoiceId')
  const parsed = billSchema.safeParse({
    branchId: read(form, 'branchId'),
    partnerId: read(form, 'partnerId'),
    reference: read(form, 'reference'),
    currency: read(form, 'currency') ?? 'KWD',
    fxRate: read(form, 'fxRate') ?? '1',
    invoiceDate: read(form, 'invoiceDate') ?? '',
    dueOn: read(form, 'dueOn') ?? '',
    taxAmount: read(form, 'taxAmount') ?? '0',
    notes: read(form, 'notes'),
  })
  if (!parsed.success) return fail(fieldErrors(parsed.error), echo(form))

  const data = parsed.data
  assertInBranch(session, data.branchId)

  try {
    const outcome = await withActor(session.actor, async (tx) => {
      if (!billId) {
        const [row] = await tx
          .insert(supplierInvoices)
          .values({
            branchId: data.branchId,
            partnerId: data.partnerId,
            reference: data.reference,
            currency: data.currency,
            fxRate: data.fxRate,
            invoiceDate: data.invoiceDate,
            dueOn: data.dueOn ?? null,
            taxAmount: data.taxAmount,
            total: data.taxAmount,
            notes: data.notes,
          })
          .returning({ id: supplierInvoices.id })
        return { id: row!.id, error: null }
      }

      /*
        A bill stops being editable once finance has approved it.

        The condition is in the `where` rather than in a prior read, so an
        approval landing between the two does not let the edit through — which
        would change the figures somebody has already signed off.
      */
      const updated = await tx
        .update(supplierInvoices)
        .set({
          partnerId: data.partnerId,
          reference: data.reference,
          currency: data.currency,
          fxRate: data.fxRate,
          invoiceDate: data.invoiceDate,
          dueOn: data.dueOn ?? null,
          taxAmount: data.taxAmount,
          total: sql`${supplierInvoices.subtotal} + ${data.taxAmount}::numeric`,
          notes: data.notes,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(supplierInvoices.id, billId),
            inArray(supplierInvoices.status, ['received', 'disputed']),
          ),
        )
        .returning({ id: supplierInvoices.id })

      return { id: billId, error: updated.length === 0 ? ('locked' as const) : null }
    })

    if (outcome.error === 'locked') {
      return failWith(
        'That bill has been approved and can no longer be edited. Dispute it first if the figures are wrong.',
        echo(form),
      )
    }

    revalidatePath('/payables')
    revalidatePath(`/payables/${outcome.id}`)
    return succeed(outcome.id)
  } catch (error) {
    if (isUniqueViolation(error)) {
      return fail(
        { reference: 'That invoice number has already been captured for this supplier.' },
        echo(form),
      )
    }
    throw error
  }
}

const lineSchema = z.object({
  supplierInvoiceId: z.uuid(),
  description: z.string().trim().min(1, 'Enter the line as they wrote it').max(300),
  chargeTypeId: optionalUuid,
  jobId: optionalUuid,
  quantity: decimalString('Enter a quantity'),
  unitPrice: decimalString('Enter the rate'),
  taxAmount: decimalString('Enter the tax, or zero'),
})

export async function addSupplierInvoiceLine(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const session = await requireSession()
  assertCan(session, 'payable.record')

  const parsed = lineSchema.safeParse({
    supplierInvoiceId: read(form, 'supplierInvoiceId'),
    description: read(form, 'description'),
    chargeTypeId: read(form, 'chargeTypeId') ?? '',
    jobId: read(form, 'jobId') ?? '',
    quantity: read(form, 'quantity') ?? '1',
    unitPrice: read(form, 'unitPrice') ?? '',
    taxAmount: read(form, 'taxAmount') ?? '0',
  })
  if (!parsed.success) return fail(fieldErrors(parsed.error), echo(form))

  const data = parsed.data

  const outcome = await withActor(session.actor, async (tx) => {
    const [bill] = await tx
      .select({
        branchId: supplierInvoices.branchId,
        currency: supplierInvoices.currency,
        status: supplierInvoices.status,
      })
      .from(supplierInvoices)
      .where(eq(supplierInvoices.id, data.supplierInvoiceId))
      .limit(1)

    if (!bill) return { error: 'not_found' as const }
    if (!['received', 'disputed'].includes(bill.status)) return { error: 'locked' as const }
    assertInBranch(session, bill.branchId)

    const amount = dec(data.quantity)
      .times(dec(data.unitPrice))
      .toDecimalPlaces(spec(bill.currency).minorUnits)

    await tx.insert(supplierInvoiceLines).values({
      supplierInvoiceId: data.supplierInvoiceId,
      branchId: bill.branchId,
      jobId: data.jobId ?? null,
      chargeTypeId: data.chargeTypeId ?? null,
      description: data.description,
      quantity: data.quantity,
      unitPrice: data.unitPrice,
      amount: amount.toFixed(),
      taxAmount: data.taxAmount,
    })

    await rollBillTotals(tx, data.supplierInvoiceId)
    return { error: null }
  })

  if (outcome.error === 'not_found') return failWith('That bill is no longer visible.', echo(form))
  if (outcome.error === 'locked') {
    return failWith('That bill has been approved; its lines can no longer change.', echo(form))
  }

  revalidatePath(`/payables/${data.supplierInvoiceId}`)
  return succeed(data.supplierInvoiceId)
}

/**
 * Totals derived from the lines, in one statement, so they cannot drift.
 *
 * The same treatment `allocatePayment` gives an invoice's `amount_paid`: the
 * header is never typed and never incremented, it is recomputed from the rows
 * beneath it. An increment is a read-modify-write and loses one of two
 * concurrent line additions.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function rollBillTotals(tx: any, billId: string): Promise<void> {
  await tx.execute(sql`
    update supplier_invoices set
      subtotal   = coalesce((select sum(amount)     from supplier_invoice_lines
                              where supplier_invoice_id = ${billId}), 0),
      tax_amount = coalesce((select sum(tax_amount) from supplier_invoice_lines
                              where supplier_invoice_id = ${billId}), 0),
      total      = coalesce((select sum(amount + tax_amount) from supplier_invoice_lines
                              where supplier_invoice_id = ${billId}), 0),
      updated_at = now()
    where id = ${billId}
  `)
}

// --- matching --------------------------------------------------------------

export async function matchSupplierLine(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const session = await requireSession()
  assertCan(session, 'payable.record')

  const lineId = read(form, 'supplierInvoiceLineId')
  const chargeLineId = read(form, 'chargeLineId')
  const amount = read(form, 'amount')
  const billId = read(form, 'supplierInvoiceId')

  if (!lineId || !chargeLineId || !billId) {
    return fail({ chargeLineId: 'Choose a cost line to match against.' })
  }
  if (!amount || !/^\d+(\.\d{1,6})?$/.test(amount)) {
    return fail({ amount: 'Enter how much of this line that cost covers.' }, echo(form))
  }

  try {
    const outcome = await withActor(session.actor, async (tx) => {
      /*
        The position and the insert, in one transaction.

        `sum` over no rows is null, not zero — the first match against a line
        is exactly that case, and `matchPositionFromDb` coalesces at the edge
        so no caller has to remember.
      */
      const result = await tx.execute(sql`
        select
          (select amount from supplier_invoice_lines where id = ${lineId})::numeric as billed,
          coalesce((select sum(amount) from supplier_invoice_matches
                     where supplier_invoice_line_id = ${lineId}
                       and retracted_at is null), 0)::numeric                       as matched,
          (select si.currency from supplier_invoice_lines l
             join supplier_invoices si on si.id = l.supplier_invoice_id
            where l.id = ${lineId})                                                 as currency,
          (select l.branch_id from supplier_invoice_lines l where l.id = ${lineId}) as branch_id,
          (select si.status from supplier_invoice_lines l
             join supplier_invoices si on si.id = l.supplier_invoice_id
            where l.id = ${lineId})                                                 as status
      `)

      const row = result.rows[0] as
        | {
            billed: string | null
            matched: string | null
            currency: string | null
            branch_id: string | null
            status: string | null
          }
        | undefined

      if (!row || row.billed === null || !row.branch_id) return { error: 'not_found' as const }
      if (!['received', 'disputed'].includes(row.status ?? '')) return { error: 'locked' as const }
      assertInBranch(session, row.branch_id)

      const currency = row.currency ?? 'KWD'
      const verdict = checkMatch(
        amount,
        matchPositionFromDb({ billed: row.billed, matched: row.matched }, currency),
        currency,
      )
      if (!verdict.ok) return { error: 'over_billed' as const, available: verdict.available }

      await tx.insert(supplierInvoiceMatches).values({
        supplierInvoiceLineId: lineId,
        chargeLineId,
        branchId: row.branch_id,
        amount,
        matchedById: session.actor.principalId,
      })

      return { error: null }
    })

    if (outcome.error === 'not_found') {
      return failWith('That line is no longer visible.', echo(form))
    }
    if (outcome.error === 'locked') {
      return failWith(
        'That bill has been approved. Matching it now would change a variance somebody has already signed off.',
        echo(form),
      )
    }
    if (outcome.error === 'over_billed') {
      return fail({ amount: 'That is more than is left unmatched on this line.' }, echo(form))
    }
  } catch (error) {
    if (isUniqueViolation(error)) {
      return fail({ chargeLineId: 'That cost line is already matched to this line.' }, echo(form))
    }
    /*
      The branch trigger from 0014 speaks plainly; surface it rather than a
      generic failure. A Dubai bill matched against a Kuwait accrual lands the
      variance in the wrong entity's P&L, and the operator needs to know that
      is what they tried to do.
    */
    if (databaseMessage(error).includes('different branches')) {
      return fail({ chargeLineId: 'That cost line belongs to another branch.' }, echo(form))
    }
    throw error
  }

  revalidatePath(`/payables/${billId}`)
  return succeed(billId)
}

export async function unmatchSupplierLine(form: FormData): Promise<void> {
  const session = await requireSession()
  assertCan(session, 'payable.record')

  const matchId = read(form, 'matchId')
  const billId = read(form, 'supplierInvoiceId')
  if (!matchId || !billId) return

  await withActor(session.actor, async (tx) => {
    /*
      Retracted, not deleted.

      The first instinct is that a match is an assertion rather than a record,
      so retracting it is not really a delete — but §5.5 holds here as
      everywhere, and the row is still evidence. "This bill was matched to that
      accrual and then somebody unmatched it" is exactly the history worth
      having when a variance is argued about three months later, and a deleted
      row cannot say who changed their mind. Every read filters
      `retracted_at is null`.
    */
    await tx.execute(sql`
      update supplier_invoice_matches m set
        retracted_at = now(),
        retracted_by_id = ${session.actor.principalId},
        updated_at = now()
       from supplier_invoice_lines l
       join supplier_invoices si on si.id = l.supplier_invoice_id
       where m.id = ${matchId}
         and l.id = m.supplier_invoice_line_id
         and m.retracted_at is null
         and si.status in ('received', 'disputed')
    `)
  })

  revalidatePath(`/payables/${billId}`)
}

// --- approval --------------------------------------------------------------

export async function setSupplierInvoiceStatus(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const session = await requireSession()

  const billId = read(form, 'supplierInvoiceId')
  const action = read(form, 'action')
  const reason = read(form, 'reason')
  const acceptVariance = form.get('acceptVariance') === 'on'

  if (!billId || !action) return failWith('Nothing to do.')

  if (action === 'approve') assertCan(session, 'payable.approve')
  else assertCan(session, 'payable.record')

  const outcome = await withActor(session.actor, async (tx) => {
    const [bill] = await tx
      .select({
        branchId: supplierInvoices.branchId,
        status: supplierInvoices.status,
        fxRate: supplierInvoices.fxRate,
      })
      .from(supplierInvoices)
      .where(eq(supplierInvoices.id, billId))
      .limit(1)

    if (!bill) return { error: 'not_found' as const }
    assertInBranch(session, bill.branchId)

    if (action === 'approve') {
      if (bill.status !== 'received' && bill.status !== 'disputed') {
        return { error: 'not_approvable' as const }
      }

      /*
        The gate this whole feature exists for.

        A bill whose lines disagree with the accrual by more than the
        configured tolerance, or which has lines matched to nothing at all,
        cannot be approved silently. The approver either goes and argues with
        the agent, or accepts the variance on the record with a reason — and
        the reason is what makes the second option a decision rather than a
        click.
      */
      const check = await tx.execute(sql`
        select
          count(*) filter (
            where abs(l.amount * ${bill.fxRate}::numeric - coalesce(acc.accrued, 0))
                  > greatest(
                      coalesce(acc.accrued, 0) * coalesce(
                        nullif(p.variance_tolerance_percent, 0),
                        ct.variance_tolerance_percent, 0) / 100,
                      coalesce(
                        nullif(p.variance_tolerance_absolute, 0),
                        ct.variance_tolerance_absolute, 0)
                    )
          )::int as out_of_tolerance,
          count(*) filter (where acc.matches is null)::int as unmatched
        from supplier_invoice_lines l
        join supplier_invoices si on si.id = l.supplier_invoice_id
        join partners p on p.id = si.partner_id
        left join charge_types ct on ct.id = l.charge_type_id
        left join lateral (
          select sum(cl.amount_base) as accrued, count(*) as matches
            from supplier_invoice_matches m
            join charge_lines cl on cl.id = m.charge_line_id
           where m.supplier_invoice_line_id = l.id and m.retracted_at is null
        ) acc on true
        where l.supplier_invoice_id = ${billId}
      `)

      const verdict = check.rows[0] as { out_of_tolerance: number; unmatched: number } | undefined
      const dirty = Number(verdict?.out_of_tolerance ?? 0) + Number(verdict?.unmatched ?? 0)

      if (dirty > 0 && !acceptVariance) return { error: 'needs_review' as const }
      if (dirty > 0 && (!reason || reason.length < 3)) return { error: 'needs_reason' as const }

      await tx
        .update(supplierInvoices)
        .set({
          status: 'approved',
          approvedAt: new Date(),
          approvedById: session.actor.principalId,
          disputedAt: null,
          disputeReason: null,
          varianceAcceptedAt: dirty > 0 ? new Date() : null,
          varianceAcceptedReason: dirty > 0 ? (reason ?? null) : null,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(supplierInvoices.id, billId),
            inArray(supplierInvoices.status, ['received', 'disputed']),
          ),
        )
      return { error: null }
    }

    if (action === 'dispute') {
      if (!reason || reason.length < 3) return { error: 'needs_reason' as const }
      await tx
        .update(supplierInvoices)
        .set({
          status: 'disputed',
          disputedAt: new Date(),
          disputeReason: reason,
          updatedAt: new Date(),
        })
        .where(eq(supplierInvoices.id, billId))
      return { error: null }
    }

    if (action === 'void') {
      if (!reason || reason.length < 3) return { error: 'needs_reason' as const }
      /*
        Voiding is refused once anything has been paid against it. A void that
        leaves allocations pointing at it makes the supplier's balance
        unexplainable, and there is no reversing entry to make it right.
      */
      const updated = await tx
        .update(supplierInvoices)
        .set({
          status: 'void',
          disputedAt: new Date(),
          disputeReason: reason,
          updatedAt: new Date(),
        })
        .where(and(eq(supplierInvoices.id, billId), sql`${supplierInvoices.amountPaid} = 0`))
        .returning({ id: supplierInvoices.id })

      return { error: updated.length === 0 ? ('paid_against' as const) : null }
    }

    return { error: 'unknown' as const }
  })

  const messages: Record<string, string> = {
    not_found: 'That bill is no longer visible.',
    not_approvable: 'That bill is not waiting for approval.',
    needs_review:
      'Some lines are outside tolerance or matched to nothing. Query them with the supplier, or tick the box and say why the variance is acceptable.',
    needs_reason: 'Say why — this goes on the record.',
    paid_against: 'Something has already been paid against that bill, so it cannot be voided.',
    unknown: 'Nothing to do.',
  }

  if (outcome.error) return failWith(messages[outcome.error] ?? 'That did not work.', echo(form))

  revalidatePath('/payables')
  revalidatePath(`/payables/${billId}`)
  return succeed(billId)
}

// --- paying ----------------------------------------------------------------

const supplierPaymentSchema = z.object({
  branchId: z.uuid('Choose a branch'),
  partnerId: z.uuid('Choose the supplier'),
  amount: decimalString('Enter the amount paid'),
  currency: z.string().trim().length(3),
  fxRate: decimalString('Enter an exchange rate'),
  paidOn: isoDate,
  method: z.string().trim().min(1, 'How was it paid?').max(40),
  reference: z
    .string()
    .trim()
    .max(60)
    .optional()
    .transform((v) => v || null),
})

export async function recordSupplierPayment(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const session = await requireSession()
  assertCan(session, 'payable.pay')

  const parsed = supplierPaymentSchema.safeParse({
    branchId: read(form, 'branchId'),
    partnerId: read(form, 'partnerId'),
    amount: read(form, 'amount') ?? '',
    currency: read(form, 'currency') ?? 'KWD',
    fxRate: read(form, 'fxRate') ?? '1',
    paidOn: read(form, 'paidOn') ?? '',
    method: read(form, 'method') ?? 'transfer',
    reference: read(form, 'reference'),
  })
  if (!parsed.success) return fail(fieldErrors(parsed.error), echo(form))

  const data = parsed.data
  assertInBranch(session, data.branchId)

  await withActor(session.actor, async (tx) => {
    await tx.insert(supplierPayments).values({
      branchId: data.branchId,
      partnerId: data.partnerId,
      amount: data.amount,
      currency: data.currency,
      fxRate: data.fxRate,
      paidOn: data.paidOn,
      method: data.method,
      reference: data.reference,
      recordedById: session.actor.principalId,
    })
  })

  revalidatePath('/payables')
  return succeed(data.partnerId)
}

/**
 * Allocating a payment across their bills — both ceilings, in one transaction.
 *
 * This is the receivables path in mirror image and it reuses the same engine:
 * `checkSettlement` names its figures received/allocated/invoiced/settled, and
 * paid/allocated/billed/settled maps onto them exactly. Writing a second copy
 * of two-ceiling arithmetic would mean two places to get three-decimal
 * subtraction wrong, and the first version of that arithmetic was wrong.
 */
export async function allocateSupplierPayment(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const session = await requireSession()
  assertCan(session, 'payable.pay')

  const paymentId = read(form, 'supplierPaymentId')
  const billId = read(form, 'supplierInvoiceId')
  const amount = read(form, 'amount')

  if (!paymentId || !billId) return fail({ supplierInvoiceId: 'Choose a bill to settle.' })
  if (!amount || !/^\d+(\.\d{1,6})?$/.test(amount)) {
    return fail({ amount: 'Enter how much of this payment settles that bill.' }, echo(form))
  }

  const outcome = await withActor(session.actor, async (tx) => {
    const result = await tx.execute(sql`
      select
        (select amount from supplier_payments where id = ${paymentId})::numeric   as received,
        coalesce((select sum(amount) from supplier_payment_allocations
                   where supplier_payment_id = ${paymentId}), 0)::numeric         as allocated,
        (select total from supplier_invoices where id = ${billId})::numeric       as invoiced,
        coalesce((select sum(amount) from supplier_payment_allocations
                   where supplier_invoice_id = ${billId}), 0)::numeric            as settled,
        (select currency from supplier_invoices where id = ${billId})             as currency,
        (select branch_id from supplier_invoices where id = ${billId})            as branch_id,
        (select status from supplier_invoices where id = ${billId})               as status
    `)

    const row = result.rows[0] as
      | {
          received: string | null
          allocated: string | null
          invoiced: string | null
          settled: string | null
          currency: string | null
          branch_id: string | null
          status: string | null
        }
      | undefined

    if (!row || row.received === null || row.invoiced === null || !row.branch_id) {
      return { error: 'not_found' as const }
    }
    if (!['approved', 'part_paid'].includes(row.status ?? '')) {
      return { error: 'not_approved' as const }
    }
    assertInBranch(session, row.branch_id)

    const currency = row.currency ?? 'KWD'
    const verdict = checkSettlement(amount, positionFromDb(row, currency), currency)
    if (!verdict.ok) return { error: verdict.reason }

    await tx.insert(supplierPaymentAllocations).values({
      supplierPaymentId: paymentId,
      supplierInvoiceId: billId,
      branchId: row.branch_id,
      amount,
    })

    // Paid-to-date and status derived from the allocations, in one statement.
    await tx.execute(sql`
      update supplier_invoices set
        amount_paid = coalesce((select sum(amount) from supplier_payment_allocations
                                 where supplier_invoice_id = ${billId}), 0),
        status = case
          when coalesce((select sum(amount) from supplier_payment_allocations
                          where supplier_invoice_id = ${billId}), 0) >= total
            then 'paid'::supplier_invoice_status
          when coalesce((select sum(amount) from supplier_payment_allocations
                          where supplier_invoice_id = ${billId}), 0) > 0
            then 'part_paid'::supplier_invoice_status
          else status
        end,
        updated_at = now()
      where id = ${billId}
    `)

    return { error: null }
  })

  const messages: Record<string, string> = {
    not_found: 'That bill is no longer visible.',
    not_approved: 'That bill has not been approved for payment yet.',
    over_allocated: 'That is more than is left unallocated on this payment.',
    over_invoiced: 'That is more than is still outstanding on that bill.',
  }
  if (outcome.error) {
    const key =
      outcome.error === 'over_invoiced' || outcome.error === 'over_allocated'
        ? 'amount'
        : 'supplierInvoiceId'
    return fail({ [key]: messages[outcome.error]! }, echo(form))
  }

  revalidatePath('/payables')
  revalidatePath(`/payables/${billId}`)
  return succeed(billId)
}

// --- netting ---------------------------------------------------------------

const settlementSchema = z.object({
  branchId: z.uuid('Choose a branch'),
  partnerId: z.uuid('Choose the agent'),
  periodFrom: isoDate,
  periodTo: isoDate,
  fxRate: decimalString('Enter the agreed rate'),
})

/**
 * Draft a month's set-off — the figures, and the documents behind them.
 *
 * Everything in the period, in the agreed currency, that no earlier settlement
 * has already claimed. The totals are *written*, not left to be re-derived:
 * a statement is a thing both sides agreed to on a date, and a screen that
 * re-derives it shows a different figure the moment a late invoice is captured
 * into the period.
 */
export async function draftSettlement(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const session = await requireSession()
  assertCan(session, 'settlement.run')

  const parsed = settlementSchema.safeParse({
    branchId: read(form, 'branchId'),
    partnerId: read(form, 'partnerId'),
    periodFrom: read(form, 'periodFrom') ?? '',
    periodTo: read(form, 'periodTo') ?? '',
    fxRate: read(form, 'fxRate') ?? '1',
  })
  if (!parsed.success) return fail(fieldErrors(parsed.error), echo(form))

  const data = parsed.data
  assertInBranch(session, data.branchId)
  if (data.periodTo < data.periodFrom) {
    return fail({ periodTo: 'The period ends before it starts.' }, echo(form))
  }

  const outcome = await withActor(session.actor, async (tx) => {
    const [partner] = await tx
      .select({
        id: partners.id,
        customerId: partners.settlementCustomerId,
        settlementCurrency: partners.settlementCurrency,
        currency: partners.currency,
      })
      .from(partners)
      .where(eq(partners.id, data.partnerId))
      .limit(1)

    if (!partner) return { error: 'not_found' as const }
    if (!partner.customerId) return { error: 'no_account' as const }

    const currency = partner.settlementCurrency ?? partner.currency ?? 'KWD'

    const bills = await tx
      .select({
        id: supplierInvoices.id,
        total: supplierInvoices.total,
        amountPaid: supplierInvoices.amountPaid,
      })
      .from(supplierInvoices)
      .where(
        and(
          eq(supplierInvoices.partnerId, data.partnerId),
          eq(supplierInvoices.currency, currency),
          isNull(supplierInvoices.settlementId),
          inArray(supplierInvoices.status, ['approved', 'part_paid']),
          sql`${supplierInvoices.invoiceDate} between ${data.periodFrom}::date and ${data.periodTo}::date`,
          sql`${supplierInvoices.total} > ${supplierInvoices.amountPaid}`,
        ),
      )

    const ours = await tx
      .select({
        id: invoices.id,
        total: invoices.total,
        amountPaid: invoices.amountPaid,
      })
      .from(invoices)
      .where(
        and(
          eq(invoices.customerId, partner.customerId),
          eq(invoices.currency, currency),
          inArray(invoices.status, ['issued', 'part_paid']),
          sql`${invoices.issuedAt}::date between ${data.periodFrom}::date and ${data.periodTo}::date`,
          sql`${invoices.total} > ${invoices.amountPaid}`,
          sql`not exists (
            select 1 from partner_settlement_lines sl where sl.invoice_id = "invoices"."id"
          )`,
        ),
      )

    if (bills.length === 0 && ours.length === 0) return { error: 'nothing_to_net' as const }

    const open = (rows: { total: string; amountPaid: string }[]) =>
      rows.reduce((acc, r) => acc.plus(new D(r.total).minus(new D(r.amountPaid))), new D(0))

    const receivable = money(open(ours).toFixed(), currency)
    const payable = money(open(bills).toFixed(), currency)
    const net = netPosition(receivable, payable, currency)

    const [row] = await tx
      .insert(partnerSettlements)
      .values({
        reference: sql`'SET-' || to_char(now(), 'YYYY') || '-' ||
                       lpad(nextval('settlement_reference_seq')::text, 5, '0')`,
        branchId: data.branchId,
        partnerId: data.partnerId,
        currency,
        periodFrom: data.periodFrom,
        periodTo: data.periodTo,
        receivableTotal: receivable.amount.toFixed(),
        payableTotal: payable.amount.toFixed(),
        offsetAmount: net.offset.amount.toFixed(),
        residualAmount: net.residual.amount.toFixed(),
        residualDirection: net.direction,
        fxRate: data.fxRate,
      })
      .returning({ id: partnerSettlements.id })

    const settlementId = row!.id

    await tx.insert(partnerSettlementLines).values([
      ...ours.map((i) => ({
        settlementId,
        branchId: data.branchId,
        kind: 'invoice' as const,
        invoiceId: i.id,
        amount: new D(i.total).minus(new D(i.amountPaid)).toFixed(),
        isFull: true,
      })),
      ...bills.map((b) => ({
        settlementId,
        branchId: data.branchId,
        kind: 'bill' as const,
        supplierInvoiceId: b.id,
        amount: new D(b.total).minus(new D(b.amountPaid)).toFixed(),
        isFull: true,
      })),
    ])

    return { error: null, id: settlementId }
  })

  const messages: Record<string, string> = {
    not_found: 'That partner is no longer visible.',
    no_account:
      'No current account is configured for that partner. Link them to the customer record they invoice us as, on their partner page.',
    nothing_to_net: 'Nothing open in that period, in that currency.',
  }
  if (outcome.error) return failWith(messages[outcome.error]!, echo(form))

  revalidatePath('/settlements')
  return succeed(outcome.id!)
}

/**
 * Agreeing, settling, voiding.
 *
 * `agree` is the point of no return for the figures, and it is also where the
 * bills are claimed: `settlement_id` is stamped on them, which is what keeps
 * the same invoice out of next month's statement. `settle` records that the
 * residual actually moved.
 */
export async function setSettlementStatus(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const session = await requireSession()
  assertCan(session, 'settlement.run')

  const settlementId = read(form, 'settlementId')
  const action = read(form, 'action')
  const reason = read(form, 'reason')
  if (!settlementId || !action) return failWith('Nothing to do.')

  const outcome = await withActor(session.actor, async (tx) => {
    const [row] = await tx
      .select({ branchId: partnerSettlements.branchId, status: partnerSettlements.status })
      .from(partnerSettlements)
      .where(eq(partnerSettlements.id, settlementId))
      .limit(1)

    if (!row) return { error: 'not_found' as const }
    assertInBranch(session, row.branchId)

    if (action === 'agree') {
      if (row.status !== 'draft') return { error: 'not_draft' as const }

      const updated = await tx
        .update(partnerSettlements)
        .set({
          status: 'agreed',
          agreedAt: new Date(),
          agreedById: session.actor.principalId,
          updatedAt: new Date(),
        })
        .where(and(eq(partnerSettlements.id, settlementId), eq(partnerSettlements.status, 'draft')))
        .returning({ id: partnerSettlements.id })

      if (updated.length === 0) return { error: 'not_draft' as const }

      /*
        Claim the bills, in the same transaction as the agreement.

        Without this the next statement lists them again and they get netted
        twice — which is not caught by any balance check, because both
        settlements are individually consistent.
      */
      await tx.execute(sql`
        update supplier_invoices set settlement_id = ${settlementId}, updated_at = now()
         where id in (
           select supplier_invoice_id from partner_settlement_lines
            where settlement_id = ${settlementId} and supplier_invoice_id is not null
         )
      `)
      return { error: null }
    }

    if (action === 'settle') {
      if (row.status !== 'agreed') return { error: 'not_agreed' as const }
      await tx
        .update(partnerSettlements)
        .set({
          status: 'settled',
          settledAt: new Date(),
          settledById: session.actor.principalId,
          updatedAt: new Date(),
        })
        .where(eq(partnerSettlements.id, settlementId))
      return { error: null }
    }

    if (action === 'void') {
      if (!reason || reason.length < 3) return { error: 'needs_reason' as const }
      if (row.status === 'settled') return { error: 'already_settled' as const }

      await tx
        .update(partnerSettlements)
        .set({
          status: 'void',
          voidedAt: new Date(),
          voidReason: reason,
          agreedAt: null,
          updatedAt: new Date(),
        })
        .where(eq(partnerSettlements.id, settlementId))

      // Release the bills it claimed, so the next statement sees them again.
      await tx
        .update(supplierInvoices)
        .set({ settlementId: null, updatedAt: new Date() })
        .where(eq(supplierInvoices.settlementId, settlementId))
      return { error: null }
    }

    return { error: 'unknown' as const }
  })

  const messages: Record<string, string> = {
    not_found: 'That settlement is no longer visible.',
    not_draft: 'That settlement has already been agreed.',
    not_agreed: 'Agree the statement with the agent before recording the residual as settled.',
    already_settled: 'That settlement has been settled and cannot be voided.',
    needs_reason: 'Say why — this goes on the record.',
    unknown: 'Nothing to do.',
  }
  if (outcome.error) return failWith(messages[outcome.error]!, echo(form))

  revalidatePath('/settlements')
  revalidatePath(`/settlements/${settlementId}`)
  return succeed(settlementId)
}

/**
 * Agree and settle, as plain form actions.
 *
 * They take no input beyond the id, so they are buttons rather than dialogs —
 * and a button posts a bare `FormData`. `setSettlementStatus` keeps the
 * `useActionState` signature because voiding needs a reason and therefore
 * needs a form that can show a field error.
 *
 * Both are `POST`s and neither is a link: a `GET` that claims a month's
 * invoices could be fired by a link preview in somebody's chat client.
 */
export async function advanceSettlement(form: FormData): Promise<void> {
  await setSettlementStatus({}, form)
}

/** Linking a partner to the customer record they invoice us as — enables netting. */
export async function linkPartnerAccount(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const session = await requireSession()
  assertCan(session, 'partner.write')

  const partnerId = read(form, 'partnerId')
  const customerId = read(form, 'settlementCustomerId')
  const currency = read(form, 'settlementCurrency')
  if (!partnerId) return failWith('Nothing to do.')

  await withActor(session.actor, async (tx) => {
    await tx
      .update(partners)
      .set({
        settlementCustomerId: customerId ?? null,
        settlementCurrency: currency ?? null,
        updatedAt: new Date(),
      })
      .where(eq(partners.id, partnerId))
  })

  revalidatePath(`/partners/${partnerId}`)
  return succeed(partnerId)
}

/** Tolerances live on the partner and on the charge type — this is the partner half. */
export async function setPartnerTolerance(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const session = await requireSession()
  assertCan(session, 'partner.write')

  const partnerId = read(form, 'partnerId')
  const percent = read(form, 'varianceTolerancePercent') ?? '0'
  const absolute = read(form, 'varianceToleranceAbsolute') ?? '0'
  if (!partnerId) return failWith('Nothing to do.')

  if (!/^\d+(\.\d{1,6})?$/.test(percent) || !/^\d+(\.\d{1,6})?$/.test(absolute)) {
    return fail({ varianceTolerancePercent: 'Enter a number, or zero.' }, echo(form))
  }

  await withActor(session.actor, async (tx) => {
    await tx
      .update(partners)
      .set({
        varianceTolerancePercent: percent,
        varianceToleranceAbsolute: absolute,
        updatedAt: new Date(),
      })
      .where(eq(partners.id, partnerId))
  })

  revalidatePath(`/partners/${partnerId}`)
  return succeed(partnerId)
}

// --- reading a bill --------------------------------------------------------

/**
 * A supplier's scan, read into a captured bill — FR-FN-09, `AI-10`.
 *
 * This is the shortest path between a PDF and `core/matching.ts`, and that is
 * the whole justification for it. The matching engine is written, argued and
 * tested: it compares quoted against accrued against billed, applies a
 * two-limit tolerance so a rounding difference on a documentation fee does not
 * flag while a real drift on ocean freight does, and surfaces the agent who
 * billed 460 for something quoted at 400. It has been idle since it was
 * written, for want of rows that somebody types by hand.
 *
 * ## It lands in `received`, which is not a concession
 *
 * `received` is the draft gate this table already had. A bill is payable only
 * once `approved_at` is stamped, and that has been a separate act by finance
 * since the table existed — *anyone in operations can enter what arrived;
 * releasing it for payment is finance's*. A model is another thing that can
 * enter what arrived. It cannot approve, and nothing here gives it a way to.
 *
 * ## The supplier is chosen, never read off the letterhead
 *
 * `partnerId` comes from the form. Attribution decides whose money moves, and
 * `invoice-extract.ts` makes the same refusal in its own header: the caller
 * knows the supplier from the screen they are standing on, and that is better
 * evidence than a letterhead a model read.
 *
 * ## Nothing is invented on failure
 *
 * A scan that does not reconcile writes no bill and says why, in figures — so
 * a coordinator reads *"line 3 says 450.000, the figures give 451.500"* and
 * captures it by hand, which is exactly where they were before this existed.
 * The upload still happened, so the scan is on file either way.
 */
export async function readSupplierBill(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const session = await requireSession()
  assertCan(session, 'payable.record')

  const branchId = read(form, 'branchId')
  const partnerId = read(form, 'partnerId')
  const jobId = read(form, 'jobId')
  const file = form.get('scan')

  if (!branchId || !partnerId) {
    return fail(
      {
        ...(branchId ? {} : { branchId: 'Choose a branch' }),
        ...(partnerId ? {} : { partnerId: 'Choose the supplier' }),
      },
      echo(form),
    )
  }
  assertInBranch(session, branchId)

  if (!(file instanceof File) || file.size === 0) {
    return fail({ scan: 'Choose the supplier’s invoice' }, echo(form))
  }
  if (!READABLE_TYPES.includes(file.type)) {
    return fail({ scan: 'A PDF or a photograph of the bill' }, echo(form))
  }

  const serviceUrl = process.env.SERVICE_URL
  const secret = process.env.INTERNAL_API_SECRET
  if (!serviceUrl || !secret) {
    return failWith(
      'Reading a bill needs the service. Set SERVICE_URL and INTERNAL_API_SECRET; ' +
        'bills can still be captured by hand.',
      echo(form),
    )
  }
  const base = serviceUrl.replace(/\/$/, '')

  let assetId: string
  try {
    assetId = await uploadScan(base, secret, session.actor, branchId, file)
  } catch {
    return failWith('The scan could not be stored, so nothing was read.', echo(form))
  }

  try {
    /*
      Generous, because this is a model reading a multi-page scan and the
      alternative to waiting is the coordinator typing it. `invoke` runs no
      retry loop of its own by design, so this timeout is the only ceiling.
    */
    const response = await fetch(`${base}/internal/ai/supplier-invoice`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-internal-secret': secret },
      body: JSON.stringify({
        actor: session.actor,
        branchId,
        assetId,
        partnerId,
        jobId: jobId ?? null,
        // The unattended path: write the bill and its lines, in `received`.
        write: true,
      }),
      cache: 'no-store',
      signal: AbortSignal.timeout(120_000),
    })

    if (!response.ok) {
      return failWith(
        response.status === 503
          ? 'No model is configured, so bills cannot be read yet. Add a key at Settings › Integrations.'
          : 'The bill could not be read. Capture it by hand — the scan is on file.',
        echo(form),
      )
    }

    const body = (await response.json()) as {
      supplierInvoiceId?: string | null
      refusal?: string | null
      findings?: string[]
    }

    if (!body.supplierInvoiceId) {
      /*
        The refusal is shown as the service worded it.

        `refusalFor` already writes a sentence naming the figures that did not
        reconcile, and rephrasing it here would put a second, vaguer
        explanation in front of the person who has the document open.
      */
      return failWith(
        body.refusal ?? 'Nothing on that scan could be read as an invoice.',
        echo(form),
      )
    }

    revalidatePath('/payables')
    revalidatePath(`/payables/${body.supplierInvoiceId}`)
    return succeed(body.supplierInvoiceId)
  } catch {
    return failWith(
      'Reading the bill timed out. Capture it by hand — the scan is on file.',
      echo(form),
    )
  }
}

/** What a bill may arrive as. The service holds the same list and decides. */
const READABLE_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp']

/**
 * Bytes to the service, which owns the storage credentials.
 *
 * `apps/web` never holds the object-store secret — the same boundary the
 * signed-URL route keeps for downloads, and the reason `pod/form-actions.ts`
 * uploads the same way rather than reaching for the bucket directly.
 */
async function uploadScan(
  base: string,
  secret: string,
  actor: Awaited<ReturnType<typeof requireSession>>['actor'],
  branchId: string,
  file: File,
): Promise<string> {
  const bytes = Buffer.from(await file.arrayBuffer())

  const response = await fetch(`${base}/internal/files/upload`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-internal-secret': secret },
    body: JSON.stringify({
      actor,
      branchId,
      fileName: file.name || 'supplier-invoice',
      contentType: file.type,
      data: bytes.toString('base64'),
      purpose: 'supplier-invoice',
      meta: { source: 'payables-capture' },
    }),
    signal: AbortSignal.timeout(60_000),
  })

  if (!response.ok) throw new Error(`upload_failed_${response.status}`)
  const body = (await response.json()) as { assetId?: string }
  if (!body.assetId) throw new Error('upload_failed_no_asset')
  return body.assetId
}
