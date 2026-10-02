/**
 * Money dialogs — quotations, invoices, receipts.
 *
 * The three forms where a wrong number costs real money, so each one shows the
 * figure it is about to commit rather than hiding it behind a total computed
 * elsewhere. The quotation form asks for cost *and* price side by side, which
 * is the point: margin is a decision made at quoting time, and a form that
 * asks only for the price makes it an accident.
 */

import { getLocale, getTranslations } from 'next-intl/server'
import { fromDb, toScale } from '@qabandi/core'
import { isLocale } from '@/i18n/request'
import { named } from '@/lib/named'
import { requireSession } from '@/lib/session'
import { branchesWhere, can, permittedBranches } from '@/lib/permissions'
import { loadOptions } from '@/lib/options'
import { usePilotFixtures } from '@/lib/pilot/source'
import type { OpenEnquiryRow, OutstandingInvoiceRow } from '@/lib/pilot/types'
import { RecordDialog, type FieldSpec } from '@/ui/record-dialog'
import { todayIn } from '@/lib/time'
import { shiftDay } from '@qabandi/core'
import {
  addQuoteLine,
  allocatePayment,
  createInvoice,
  createQuote,
  recordPayment,
} from '../form-actions'

/** The charge bases a quotation line can carry — `rating.ts` in core. */
const BASES = ['flat', 'per_unit', 'per_kg', 'per_container', 'per_day', 'percent'] as const

const TAX_TREATMENTS = [
  'out_of_scope',
  'zero_rated',
  'exempt',
  'standard',
  'reverse_charge',
] as const
const PAYMENT_METHODS = ['bank_transfer', 'cheque', 'cash', 'card', 'offset'] as const

/**
 * The reader's language, for the customer names in the pickers (F27). Read
 * only where a picker is actually loaded, so a dialog that is refused or
 * pre-bound to a record pays nothing for it.
 */
async function pickerLocale(): Promise<'en' | 'ar'> {
  const resolved = await getLocale()
  return isLocale(resolved) ? resolved : 'en'
}

/**
 * Today, and thirty days out — the two dates these forms default to.
 *
 * The business day (`todayIn`), not the UTC one: between midnight and 03:00 in
 * Kuwait the UTC date is still yesterday, and every default was a day stale.
 */
function isoDay(offsetDays = 0): string {
  return shiftDay(todayIn(), offsetDays)
}

export async function QuoteDialog({
  enquiryId,
  branchId,
  currency,
  totalSell,
  totalCost,
  variant = 'primary',
}: {
  readonly enquiryId?: string
  readonly branchId?: string
  /** The enquiry's quotation currency — its current quote's, or the branch base. */
  readonly currency?: string
  /** The current quotation's figures, so a revision starts from them. */
  readonly totalSell?: string
  readonly totalCost?: string
  readonly variant?: 'primary' | 'secondary' | 'ghost'
}) {
  const session = await requireSession()
  if (!can(session, 'quote.send')) return null

  const [options, t, tc] = await Promise.all([
    getLocale().then((locale) => loadOptions(session.actor, locale === 'ar' ? 'ar' : 'en')),
    getTranslations('quoteForm'),
    getTranslations('common'),
  ])

  const enquiries = enquiryId ? [] : await loadOpenEnquiries(session, await pickerLocale())
  const defaultBranch = branchId ?? branchesWhere(session, 'quote.send')[0]

  const fields: FieldSpec[] = [
    ...(enquiryId
      ? [{ kind: 'hidden' as const, name: 'enquiryId', value: enquiryId }]
      : [
          {
            kind: 'select' as const,
            name: 'enquiryId',
            label: t('enquiry'),
            span: 12 as const,
            required: true,
            hint: t('enquiryHint'),
            options: enquiries,
            placeholder: tc('choose'),
          },
        ]),
    /*
      Bound to an enquiry, the branch is the enquiry's and not a choice: the
      action takes it from the enquiry regardless, and a picker defaulting to
      the session's first branch produced DXB quotations on KWI enquiries (S7).
    */
    enquiryId && branchId
      ? { kind: 'hidden' as const, name: 'branchId', value: branchId }
      : {
          kind: 'select' as const,
          name: 'branchId',
          label: t('branch'),
          span: 6 as const,
          required: true,
          options: permittedBranches(session, 'quote.send', options.branches),
          defaultValue: defaultBranch,
        },
    {
      kind: 'select',
      name: 'currency',
      label: t('currency'),
      span: 6,
      required: true,
      options: options.currencies,
      defaultValue: currency ?? 'USD',
    },
    {
      kind: 'text',
      name: 'totalCost',
      label: t('cost'),
      span: 6,
      required: true,
      hint: t('costHint'),
      defaultValue: totalCost,
    },
    {
      kind: 'text',
      name: 'totalSell',
      label: t('sell'),
      span: 6,
      required: true,
      hint: t('sellHint'),
      defaultValue: totalSell,
    },
    {
      kind: 'note',
      text: t('marginNote'),
    },
    // A revision copies the current version's lines (QA P2-5); say so, since
    // the sell figure above then gives way to their total.
    ...(totalSell !== undefined ? [{ kind: 'note' as const, text: t('revisionNote') }] : []),
    {
      kind: 'date',
      name: 'validUntil',
      label: t('validUntil'),
      span: 6,
      required: true,
      hint: t('validUntilHint'),
      defaultValue: isoDay(14),
    },
    {
      kind: 'textarea',
      name: 'notes',
      label: t('notes'),
      span: 12,
      rows: 2,
      hint: t('notesHint'),
    },
  ]

  return (
    <RecordDialog
      action={createQuote}
      fields={fields}
      icon="quotes"
      size="lg"
      variant={variant}
      submitIcon="plus"
      labels={{
        open: t('open'),
        title: t('title'),
        description: t('description'),
        submit: t('submit'),
        submitting: tc('saving'),
        cancel: tc('cancel'),
      }}
    />
  )
}

export async function InvoiceDialog({
  customerId,
  variant = 'primary',
}: {
  readonly customerId?: string
  readonly variant?: 'primary' | 'secondary' | 'ghost'
}) {
  const session = await requireSession()
  if (!can(session, 'invoice.approve')) return null

  const [options, t, tc] = await Promise.all([
    getLocale().then((locale) => loadOptions(session.actor, locale === 'ar' ? 'ar' : 'en')),
    getTranslations('invoiceForm'),
    getTranslations('common'),
  ])

  const defaultBranch = branchesWhere(session, 'invoice.approve')[0]

  const fields: FieldSpec[] = [
    {
      kind: 'select',
      name: 'branchId',
      label: t('branch'),
      span: 6,
      required: true,
      options: permittedBranches(session, 'invoice.approve', options.branches),
      defaultValue: defaultBranch,
    },
    {
      kind: 'select',
      name: 'customerId',
      label: t('customer'),
      span: 6,
      required: true,
      options: options.customers,
      placeholder: tc('choose'),
      defaultValue: customerId,
    },
    {
      kind: 'text',
      name: 'descriptionEn',
      label: t('lineDescription'),
      span: 12,
      required: true,
      hint: t('lineDescriptionHint'),
    },
    {
      kind: 'select',
      name: 'chargeTypeId',
      label: t('charge'),
      span: 12,
      hint: t('chargeHint'),
      options: options.chargeTypes,
      placeholder: tc('none'),
    },
    {
      kind: 'text',
      name: 'subtotal',
      label: t('subtotal'),
      span: 6,
      required: true,
      hint: t('subtotalHint'),
    },
    {
      kind: 'select',
      name: 'currency',
      label: t('currency'),
      span: 6,
      required: true,
      options: options.currencies,
      defaultValue: 'KWD',
    },
    {
      kind: 'text',
      name: 'fxRate',
      label: t('fxRate'),
      span: 6,
      mono: true,
      hint: t('fxRateHint'),
    },
    {
      kind: 'select',
      name: 'taxTreatment',
      label: t('taxTreatment'),
      span: 6,
      required: true,
      hint: t('taxTreatmentHint'),
      options: TAX_TREATMENTS.map((key) => ({ value: key, label: t(`treatments.${key}`) })),
      defaultValue: 'out_of_scope',
    },
    {
      kind: 'number',
      name: 'taxRatePercent',
      label: t('taxRate'),
      span: 6,
      min: 0,
      max: 100,
      step: '0.01',
      suffix: '%',
      hint: t('taxRateHint'),
      defaultValue: '0',
    },
    {
      kind: 'date',
      name: 'dueOn',
      label: t('dueOn'),
      span: 6,
      required: true,
      hint: t('dueOnHint'),
      defaultValue: isoDay(30),
    },
    {
      kind: 'select',
      name: 'language',
      label: t('language'),
      span: 6,
      required: true,
      hint: t('languageHint'),
      options: [
        { value: 'en', label: t('languages.en') },
        { value: 'ar', label: t('languages.ar') },
      ],
      defaultValue: 'en',
    },
    {
      kind: 'note',
      text: t('draftNote'),
    },
    {
      kind: 'textarea',
      name: 'notes',
      label: t('notes'),
      span: 12,
      rows: 2,
    },
  ]

  return (
    <RecordDialog
      action={createInvoice}
      fields={fields}
      icon="invoices"
      size="lg"
      variant={variant}
      submitIcon="plus"
      labels={{
        open: t('open'),
        title: t('title'),
        description: t('description'),
        submit: t('submit'),
        submitting: tc('saving'),
        cancel: tc('cancel'),
      }}
    />
  )
}

export async function PaymentDialog({
  customerId,
  invoiceId,
  branchId,
  currency,
  variant = 'primary',
}: {
  readonly customerId?: string
  readonly invoiceId?: string
  /**
   * The record's own branch and currency, where the dialog is opened from
   * one. Defaulting to the principal's first branch put a KWI invoice's
   * receipt in DXB, and the allocation then refused it as another branch's.
   */
  readonly branchId?: string
  readonly currency?: string
  readonly variant?: 'primary' | 'secondary' | 'ghost'
}) {
  const session = await requireSession()
  if (!can(session, 'payment.record')) return null

  const [options, t, tc] = await Promise.all([
    getLocale().then((locale) => loadOptions(session.actor, locale === 'ar' ? 'ar' : 'en')),
    getTranslations('paymentForm'),
    getTranslations('common'),
  ])

  const outstanding = invoiceId ? [] : await loadOutstandingInvoices(session, await pickerLocale())
  /*
    No guess where there is nothing to go on. "The first branch the principal
    holds" is an accident of row order — it put KWI receipts in DXB — so a
    principal in several branches chooses, and one in a single branch is not
    asked.
  */
  const defaultBranch =
    branchId ??
    (branchesWhere(session, 'payment.record').length === 1
      ? branchesWhere(session, 'payment.record')[0]
      : undefined)
  const defaultRate =
    branchId && currency ? await defaultRateToBase(session, branchId, currency) : undefined

  const fields: FieldSpec[] = [
    {
      kind: 'select',
      name: 'branchId',
      label: t('branch'),
      span: 6,
      required: true,
      options: permittedBranches(session, 'payment.record', options.branches),
      placeholder: tc('choose'),
      defaultValue: defaultBranch,
    },
    {
      kind: 'select',
      name: 'customerId',
      label: t('customer'),
      span: 6,
      required: true,
      options: options.customers,
      placeholder: tc('choose'),
      defaultValue: customerId,
    },
    {
      kind: 'text',
      name: 'amount',
      label: t('amount'),
      span: 6,
      required: true,
      hint: t('amountHint'),
    },
    {
      kind: 'select',
      name: 'currency',
      label: t('currency'),
      span: 6,
      required: true,
      options: options.currencies,
      defaultValue: currency ?? 'KWD',
    },
    {
      kind: 'text',
      name: 'fxRate',
      label: t('fxRate'),
      span: 6,
      mono: true,
      hint: t('fxRateHint'),
      defaultValue: defaultRate,
    },
    {
      kind: 'date',
      name: 'receivedOn',
      label: t('receivedOn'),
      span: 6,
      required: true,
      defaultValue: isoDay(),
    },
    {
      kind: 'select',
      name: 'method',
      label: t('method'),
      span: 6,
      required: true,
      options: PAYMENT_METHODS.map((key) => ({ value: key, label: t(`methods.${key}`) })),
      defaultValue: 'bank_transfer',
    },
    {
      kind: 'text',
      name: 'reference',
      label: t('reference'),
      span: 6,
      mono: true,
      hint: t('referenceHint'),
    },
    ...(invoiceId
      ? [{ kind: 'hidden' as const, name: 'invoiceId', value: invoiceId }]
      : [
          {
            kind: 'select' as const,
            name: 'invoiceId',
            label: t('settles'),
            span: 6 as const,
            hint: t('settlesHint'),
            options: outstanding,
            placeholder: t('settleLater'),
          },
        ]),
    {
      kind: 'textarea',
      name: 'notes',
      label: t('notes'),
      span: 12,
      rows: 2,
      hint: t('notesHint'),
    },
  ]

  return (
    <RecordDialog
      action={recordPayment}
      fields={fields}
      icon="payments"
      size="lg"
      variant={variant}
      submitIcon="plus"
      labels={{
        open: t('open'),
        title: t('title'),
        description: t('description'),
        submit: t('submit'),
        submitting: tc('saving'),
        cancel: tc('cancel'),
      }}
    />
  )
}

/**
 * Match what is left of a receipt against an open invoice — FR-FI-08.
 *
 * `allocatePayment` was written and tested and wired to nothing, so a receipt
 * recorded with "allocate later" stayed unallocated for ever: the money was in
 * the bank and the invoice it paid stayed overdue. Offered only the invoices
 * the action would accept — the same customer, branch and currency, issued and
 * still owed — so the select never holds a choice that is then refused.
 * Renders nothing where there is no such invoice.
 */
export async function AllocateReceiptDialog({
  paymentId,
  unallocated,
}: {
  readonly paymentId: string
  /** What is left on the receipt, at the currency's precision. */
  readonly unallocated: string
}) {
  const session = await requireSession()
  if (!can(session, 'payment.record')) return null

  const [t, tc, open] = await Promise.all([
    getTranslations('paymentForm'),
    getTranslations('common'),
    loadAllocatableInvoices(session, paymentId, await pickerLocale()),
  ])
  if (open.length === 0) return null

  const fields: FieldSpec[] = [
    { kind: 'hidden', name: 'paymentId', value: paymentId },
    {
      kind: 'select',
      name: 'invoiceId',
      label: t('settles'),
      span: 12,
      required: true,
      options: open,
      placeholder: tc('choose'),
    },
    {
      kind: 'text',
      name: 'amount',
      label: t('allocationAmount'),
      span: 6,
      required: true,
      mono: true,
      defaultValue: unallocated,
    },
  ]

  return (
    <RecordDialog
      action={allocatePayment}
      fields={fields}
      icon="check"
      variant="ghost"
      size="md"
      labels={{
        open: t('allocate'),
        title: t('allocateTitle'),
        description: t('allocateHint'),
        submit: t('allocate'),
        submitting: tc('saving'),
        cancel: tc('cancel'),
      }}
    />
  )
}

/** The invoices one receipt could settle — `allocate`'s own conditions. */
async function loadAllocatableInvoices(
  session: Awaited<ReturnType<typeof requireSession>>,
  paymentId: string,
  locale: 'en' | 'ar',
) {
  if (usePilotFixtures()) {
    const { pilotOutstandingInvoices } = await import('@/lib/pilot/fixtures')
    return pilotOutstandingInvoices(Date.now(), locale).map(outstandingOption)
  }

  const { withActor } = await import('@qabandi/db')
  const { sql } = await import('drizzle-orm')
  const customer = named(locale, sql`c.legal_name_en`, sql`c.legal_name_ar`)

  return withActor(session.actor, async (tx) => {
    const result = await tx.execute(sql`
      select i.id,
             i.series_no               as label,
             ${customer}               as customer,
             (i.total - i.amount_paid - i.amount_credited) as balance,
             i.currency
        from payments p
        join invoices i on i.customer_id = p.customer_id
                       and i.branch_id = p.branch_id
                       and i.currency = p.currency
        join customers c on c.id = i.customer_id
       where p.id = ${paymentId}
         and i.status in ('issued', 'part_paid')
         and i.series_no is not null
         and i.total > i.amount_paid + i.amount_credited
       order by i.due_on asc nulls last
       limit 200
    `)
    return (result.rows as unknown as OutstandingInvoiceRow[]).map(outstandingOption)
  })
}

/**
 * Enquiries that could still be quoted.
 *
 * The fixture branch and the statement both return the *select*, and the label
 * is built once below them. Returning finished options from each arm would put
 * the em dash and the `??` fallback in two places, and this dialog is the one
 * that proved how that ends: it was the last read on `/quotes` without a
 * fixture branch, so the register rendered offline and the screen still 500ed.
 */
async function loadOpenEnquiries(
  session: Awaited<ReturnType<typeof requireSession>>,
  locale: 'en' | 'ar',
) {
  const rows: readonly OpenEnquiryRow[] = usePilotFixtures()
    ? (await import('@/lib/pilot/fixtures')).pilotOpenEnquiries(Date.now(), locale)
    : await (async () => {
        const { withActor, enquiries, customers } = await import('@qabandi/db')
        const { asc, eq, notInArray } = await import('drizzle-orm')

        return withActor(session.actor, (tx) =>
          tx
            .select({
              id: enquiries.id,
              reference: enquiries.reference,
              customer: named(locale, customers.legalNameEn, customers.legalNameAr),
              contact: enquiries.contactName,
            })
            .from(enquiries)
            .leftJoin(customers, eq(customers.id, enquiries.customerId))
            .where(notInArray(enquiries.status, ['won', 'lost', 'cancelled', 'expired']))
            .orderBy(asc(enquiries.reference))
            .limit(300),
        )
      })()

  return rows.map((row) => ({
    value: row.id,
    label: `${row.reference}${row.customer || row.contact ? ` — ${row.customer ?? row.contact}` : ''}`,
  }))
}

/**
 * The rate a receipt in `currency` would take today, to prefill the field.
 *
 * Only a suggestion — the action looks the same rate up when the field is
 * left empty, and refuses where there is none. Nothing to suggest offline or
 * for a receipt in the branch's own currency.
 */
async function defaultRateToBase(
  session: Awaited<ReturnType<typeof requireSession>>,
  branchId: string,
  currency: string,
): Promise<string | undefined> {
  if (usePilotFixtures()) return undefined
  const { withActor, branches, latestFxRate } = await import('@qabandi/db')
  const { eq } = await import('drizzle-orm')
  return withActor(session.actor, async (tx) => {
    const [branch] = await tx
      .select({ base: branches.baseCurrency })
      .from(branches)
      .where(eq(branches.id, branchId))
      .limit(1)
    if (!branch || branch.base === currency) return undefined
    return (await latestFxRate(tx, currency, branch.base)) ?? undefined
  })
}

/**
 * Invoices with a balance, newest first, with the balance in the label.
 *
 * Showing the outstanding amount in the option text is what makes "which one
 * does this cheque settle?" answerable without leaving the dialog. At the
 * currency's own precision: the column's six places printed "KWD
 * 3940.500000".
 */
const outstandingOption = (row: OutstandingInvoiceRow) => ({
  value: row.id,
  label: `${row.label ?? ''} — ${row.customer} — ${row.currency} ${toScale(fromDb(row.balance, row.currency))}`,
})

/**
 * Only invoices a receipt can actually settle: issued or part paid, and so
 * numbered. Drafts, approved-but-unissued, credited and voided invoices were
 * offered here and each one failed the allocation with a 500.
 */
async function loadOutstandingInvoices(
  session: Awaited<ReturnType<typeof requireSession>>,
  locale: 'en' | 'ar',
) {
  if (usePilotFixtures()) {
    const { pilotOutstandingInvoices } = await import('@/lib/pilot/fixtures')
    return pilotOutstandingInvoices(Date.now(), locale).map(outstandingOption)
  }

  const { withActor } = await import('@qabandi/db')
  const { sql } = await import('drizzle-orm')
  const customer = named(locale, sql`c.legal_name_en`, sql`c.legal_name_ar`)

  return withActor(session.actor, async (tx) => {
    const result = await tx.execute(sql`
      select i.id,
             i.series_no                      as label,
             ${customer}                      as customer,
             (i.total - i.amount_paid - i.amount_credited) as balance,
             i.currency
        from invoices i
        join customers c on c.id = i.customer_id
       where i.status in ('issued', 'part_paid')
         and i.series_no is not null
         and i.total > i.amount_paid + i.amount_credited
       order by i.due_on asc nulls last
       limit 200
    `)

    return (result.rows as unknown as OutstandingInvoiceRow[]).map(outstandingOption)
  })
}

/**
 * A priced line on a draft quotation.
 *
 * Offered only while the quote is a draft, which is not a nicety: `addQuoteLine`
 * refuses anything else, because a sent quotation is an offer somebody is
 * holding and a revision is a new row (FR-RT-08). A control that appears and
 * then refuses teaches people the product is unreliable; one that is absent
 * teaches them the rule.
 *
 * The line total is not asked for. It is `quantity * rate`, computed in
 * PostgreSQL on `numeric` — see the action, and the reason is that `0.1 * 3`
 * is not `0.3` in a float and a quotation is not where anybody should discover
 * that.
 */
export async function QuoteLineDialog({
  quoteId,
  currency,
  variant = 'secondary',
}: {
  readonly quoteId: string
  /** The quote's own currency; a line cannot be in another one. */
  readonly currency: string
  readonly variant?: 'primary' | 'secondary' | 'ghost'
}) {
  const session = await requireSession()
  if (!can(session, 'quote.send')) return null

  const [options, t, tc] = await Promise.all([
    getLocale().then((locale) => loadOptions(session.actor, locale === 'ar' ? 'ar' : 'en')),
    getTranslations('quoteForm'),
    getTranslations('common'),
  ])

  const fields: FieldSpec[] = [
    { kind: 'hidden', name: 'quoteId', value: quoteId },
    // Fixed to the quotation's currency. A quote whose lines are in three
    // currencies has no total, and the schema would take one happily.
    { kind: 'hidden', name: 'currency', value: currency },
    {
      kind: 'select',
      name: 'chargeTypeId',
      label: t('charge'),
      span: 12,
      required: true,
      options: options.chargeTypes,
      placeholder: tc('choose'),
    },
    {
      kind: 'text',
      name: 'description',
      label: t('lineDescription'),
      span: 12,
      hint: t('lineDescriptionHint'),
    },
    {
      kind: 'select',
      name: 'basis',
      label: t('basis'),
      span: 4,
      required: true,
      options: BASES.map((key) => ({ value: key, label: t(`bases.${key}`) })),
      defaultValue: 'flat',
    },
    {
      kind: 'text',
      name: 'quantity',
      label: t('quantity'),
      span: 4,
      required: true,
      mono: true,
      defaultValue: '1',
    },
    { kind: 'text', name: 'rate', label: t('rate'), span: 4, required: true, mono: true },
  ]

  return (
    <RecordDialog
      action={addQuoteLine}
      fields={fields}
      icon="plus"
      variant={variant}
      labels={{
        open: t('addLine'),
        title: t('addLineTitle'),
        description: t('addLineDescription'),
        submit: tc('save'),
        submitting: tc('saving'),
        cancel: tc('cancel'),
      }}
    />
  )
}
