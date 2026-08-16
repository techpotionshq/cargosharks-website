/**
 * Money dialogs — quotations, invoices, receipts.
 *
 * The three forms where a wrong number costs real money, so each one shows the
 * figure it is about to commit rather than hiding it behind a total computed
 * elsewhere. The quotation form asks for cost *and* price side by side, which
 * is the point: margin is a decision made at quoting time, and a form that
 * asks only for the price makes it an accident.
 */

import { getTranslations } from 'next-intl/server'
import { requireSession } from '@/lib/session'
import { can } from '@/lib/permissions'
import { loadOptions } from '@/lib/options'
import { RecordDialog, type FieldSpec } from '@/ui/record-dialog'
import { createInvoice, createQuote, recordPayment } from '../form-actions'

const TAX_TREATMENTS = [
  'out_of_scope', 'zero_rated', 'exempt', 'standard', 'reverse_charge',
] as const
const PAYMENT_METHODS = ['bank_transfer', 'cheque', 'cash', 'card', 'offset'] as const

/** Today, and thirty days out — the two dates these forms default to. */
function isoDay(offsetDays = 0): string {
  const date = new Date()
  date.setUTCDate(date.getUTCDate() + offsetDays)
  return date.toISOString().slice(0, 10)
}

export async function QuoteDialog({
  enquiryId,
  branchId,
  variant = 'primary',
}: {
  readonly enquiryId?: string
  readonly branchId?: string
  readonly variant?: 'primary' | 'secondary' | 'ghost'
}) {
  const session = await requireSession()
  if (!can(session, 'quote.send')) return null

  const [options, t, tc] = await Promise.all([
    loadOptions(session.actor),
    getTranslations('quoteForm'),
    getTranslations('common'),
  ])

  const enquiries = enquiryId ? [] : await loadOpenEnquiries(session)
  const defaultBranch = branchId ?? [...session.branchRoles.keys()][0]

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
    {
      kind: 'select',
      name: 'branchId',
      label: t('branch'),
      span: 6,
      required: true,
      options: options.branches,
      defaultValue: defaultBranch,
    },
    {
      kind: 'select',
      name: 'currency',
      label: t('currency'),
      span: 6,
      required: true,
      options: options.currencies,
      defaultValue: 'USD',
    },
    {
      kind: 'text',
      name: 'totalCost',
      label: t('cost'),
      span: 6,
      required: true,
      hint: t('costHint'),
    },
    {
      kind: 'text',
      name: 'totalSell',
      label: t('sell'),
      span: 6,
      required: true,
      hint: t('sellHint'),
    },
    {
      kind: 'note',
      text: t('marginNote'),
    },
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
    loadOptions(session.actor),
    getTranslations('invoiceForm'),
    getTranslations('common'),
  ])

  const defaultBranch = [...session.branchRoles.keys()][0]

  const fields: FieldSpec[] = [
    {
      kind: 'select',
      name: 'branchId',
      label: t('branch'),
      span: 6,
      required: true,
      options: options.branches,
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
  variant = 'primary',
}: {
  readonly customerId?: string
  readonly invoiceId?: string
  readonly variant?: 'primary' | 'secondary' | 'ghost'
}) {
  const session = await requireSession()
  if (!can(session, 'payment.record')) return null

  const [options, t, tc] = await Promise.all([
    loadOptions(session.actor),
    getTranslations('paymentForm'),
    getTranslations('common'),
  ])

  const outstanding = invoiceId ? [] : await loadOutstandingInvoices(session)
  const defaultBranch = [...session.branchRoles.keys()][0]

  const fields: FieldSpec[] = [
    {
      kind: 'select',
      name: 'branchId',
      label: t('branch'),
      span: 6,
      required: true,
      options: options.branches,
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
      defaultValue: 'KWD',
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

/** Enquiries that could still be quoted. */
async function loadOpenEnquiries(session: Awaited<ReturnType<typeof requireSession>>) {
  const { withActor, enquiries, customers } = await import('@qabandi/db')
  const { asc, eq, notInArray } = await import('drizzle-orm')

  return withActor(session.actor, async (tx) => {
    const rows = await tx
      .select({
        id: enquiries.id,
        reference: enquiries.reference,
        customer: customers.legalNameEn,
        contact: enquiries.contactName,
      })
      .from(enquiries)
      .leftJoin(customers, eq(customers.id, enquiries.customerId))
      .where(notInArray(enquiries.status, ['won', 'lost', 'cancelled', 'expired']))
      .orderBy(asc(enquiries.reference))
      .limit(300)

    return rows.map((row) => ({
      value: row.id,
      label: `${row.reference}${row.customer || row.contact ? ` — ${row.customer ?? row.contact}` : ''}`,
    }))
  })
}

/**
 * Invoices with a balance, newest first, with the balance in the label.
 *
 * Showing the outstanding amount in the option text is what makes "which one
 * does this cheque settle?" answerable without leaving the dialog.
 */
async function loadOutstandingInvoices(session: Awaited<ReturnType<typeof requireSession>>) {
  const { withActor } = await import('@qabandi/db')
  const { sql } = await import('drizzle-orm')

  return withActor(session.actor, async (tx) => {
    const result = await tx.execute(sql`
      select i.id,
             coalesce(i.series_no, '(draft)') as label,
             c.legal_name_en                  as customer,
             (i.total - i.amount_paid)        as balance,
             i.currency
        from invoices i
        join customers c on c.id = i.customer_id
       where i.status in ('issued', 'part_paid', 'approved')
         and i.total > i.amount_paid
       order by i.due_on asc nulls last
       limit 200
    `)

    return (
      result.rows as {
        id: string
        label: string
        customer: string
        balance: string
        currency: string
      }[]
    ).map((row) => ({
      value: row.id,
      label: `${row.label} — ${row.customer} — ${row.currency} ${row.balance}`,
    }))
  })
}
