/**
 * The payables forms.
 *
 * Five, and two of them are the feature. Capturing a bill and adding its lines
 * are data entry — somebody typing what arrived. Matching a line to an accrual
 * and approving a bill with a variance on it are decisions, and both are shaped
 * so that the decision is visible while it is being made rather than
 * reconstructible afterwards.
 */

import { getLocale, getTranslations } from 'next-intl/server'
import { requireSession } from '@/lib/session'
import { branchesWhere, can } from '@/lib/permissions'
import { defaultBillBranch } from '../queries'
import { loadOptions } from '@/lib/options'
import { RecordDialog, type FieldSpec } from '@/ui/record-dialog'
import { todayIn } from '@/lib/time'
import {
  addSupplierInvoiceLine,
  allocateSupplierPayment,
  draftSettlement,
  linkPartnerAccount,
  matchSupplierLine,
  readSupplierBill,
  recordSupplierPayment,
  saveSupplierInvoice,
  setSupplierInvoiceStatus,
  setPartnerTolerance,
} from '../form-actions'
/**
 * One accrual, as it appears in the match picker.
 *
 * Declared here rather than in `panels.tsx` so the import runs one way: the
 * panel composes the dialog, and a type travelling back the other way would
 * make the two files circular.
 */
export interface MatchCandidateOption {
  readonly id: string
  readonly label: string
  readonly group?: string
}

// The business day, not the UTC one: between midnight and 03:00 in Kuwait the
// UTC date is still yesterday, and that is what these forms defaulted to.
const today = () => todayIn()

// --- capture ---------------------------------------------------------------

export interface BillDefaults {
  readonly id?: string
  readonly branchId?: string
  readonly partnerId?: string
  readonly reference?: string
  readonly currency?: string
  readonly fxRate?: string | null
  readonly invoiceDate?: string
  readonly dueOn?: string | null
  readonly taxAmount?: string | null
  readonly notes?: string | null
}

export async function SupplierInvoiceDialog({
  defaults,
  variant = 'primary',
}: {
  readonly defaults?: BillDefaults
  readonly variant?: 'primary' | 'secondary' | 'ghost'
}) {
  const session = await requireSession()
  if (!can(session, 'payable.record')) return null

  const [options, t, tc] = await Promise.all([
    getLocale().then((locale) => loadOptions(session.actor, locale === 'ar' ? 'ar' : 'en')),
    getTranslations('payableForm'),
    getTranslations('common'),
  ])

  const editing = Boolean(defaults?.id)
  // The bill's own branch when editing; otherwise the one this person
  // records bills in, or last did (U5).
  const branchId =
    defaults?.branchId ??
    (await defaultBillBranch(
      session.actor,
      branchesWhere(session, 'payable.record'),
      options.branches.map((b) => b.value),
    ))

  const fields: FieldSpec[] = [
    ...(editing
      ? [{ kind: 'hidden' as const, name: 'supplierInvoiceId', value: defaults!.id! }]
      : []),
    {
      kind: 'section',
      title: t('sections.who'),
      fields: [
        {
          kind: 'select',
          name: 'branchId',
          label: t('branch'),
          span: 6,
          required: true,
          options: options.branches,
          placeholder: tc('choose'),
          // Never the first in row order for everyone — that put KWI bills
          // in DXB — but the person's own branch, as `defaultBillBranch` reads it.
          defaultValue: branchId,
        },
        {
          kind: 'select',
          name: 'partnerId',
          label: t('supplier'),
          span: 6,
          required: true,
          options: options.partners,
          defaultValue: defaults?.partnerId,
        },
        {
          kind: 'text',
          name: 'reference',
          label: t('reference'),
          span: 6,
          required: true,
          mono: true,
          hint: t('referenceHint'),
          maxLength: 60,
          defaultValue: defaults?.reference,
        },
        {
          kind: 'date',
          name: 'invoiceDate',
          label: t('invoiceDate'),
          span: 3,
          required: true,
          defaultValue: defaults?.invoiceDate ?? today(),
        },
        {
          kind: 'date',
          name: 'dueOn',
          label: t('dueOn'),
          span: 3,
          defaultValue: defaults?.dueOn,
        },
      ],
    },
    {
      kind: 'section',
      title: t('sections.money'),
      hint: t('sections.moneyHint'),
      fields: [
        {
          kind: 'select',
          name: 'currency',
          label: t('currency'),
          span: 4,
          required: true,
          options: options.currencies,
          defaultValue: defaults?.currency ?? 'KWD',
        },
        {
          kind: 'text',
          name: 'fxRate',
          label: t('fxRate'),
          span: 4,
          mono: true,
          hint: t('fxRateHint'),
          // Blank, not 1: the action looks a blank rate up (O3).
          defaultValue: defaults?.fxRate,
        },
        {
          kind: 'text',
          name: 'taxAmount',
          label: t('tax'),
          span: 4,
          mono: true,
          defaultValue: defaults?.taxAmount ?? '0',
        },
        {
          kind: 'textarea',
          name: 'notes',
          label: tc('notes'),
          span: 12,
          rows: 2,
          defaultValue: defaults?.notes,
        },
      ],
    },
  ]

  /*
    Wider than the default `md`, because two of these fields are pickers whose
    values have to be readable: at `md` a supplier reads "CAR-ACCRUAL — Accrual
    Fixtu" and a currency reads "KWD — Kuwaiti D". A supplier you cannot read
    is a supplier you cannot confirm you picked, and this is the form where
    picking the wrong one books a stranger's bill. `xl` would leave nine fields
    swimming; `lg` is the width at which the date row stops being three slivers.
  */
  return (
    <RecordDialog
      action={saveSupplierInvoice}
      fields={fields}
      icon="payments"
      size="lg"
      variant={variant}
      labels={{
        open: editing ? tc('edit') : t('capture'),
        title: editing ? t('editTitle') : t('captureTitle'),
        description: t('captureHint'),
        submit: tc('save'),
        submitting: tc('saving'),
        cancel: tc('cancel'),
      }}
    />
  )
}

/**
 * Reading a supplier's scan instead of typing it — `AI-10`.
 *
 * The shortest path between a PDF and `core/matching.ts`, which has been
 * written, argued and tested since before there were rows for it to run on.
 * The lines are what the engine needs; this is how they arrive without
 * somebody keying them.
 *
 * Three fields and no more. The supplier is *chosen*, never read off the
 * letterhead — attribution decides whose money moves, and the person standing
 * on this screen knows the answer better than a model reading a header. The
 * job is optional because a statement covering four shipments has no single
 * one, and `AI-10` is worth having on those too.
 */
export async function ReadBillDialog({
  defaults,
  variant = 'secondary',
}: {
  readonly defaults?: {
    readonly branchId?: string
    readonly partnerId?: string
    readonly jobId?: string
  }
  readonly variant?: 'primary' | 'secondary' | 'ghost'
}) {
  const session = await requireSession()
  if (!can(session, 'payable.record')) return null

  const [options, t, tc] = await Promise.all([
    getLocale().then((locale) => loadOptions(session.actor, locale === 'ar' ? 'ar' : 'en')),
    getTranslations('payableForm'),
    getTranslations('common'),
  ])

  const fields: FieldSpec[] = [
    {
      kind: 'select',
      name: 'branchId',
      label: t('branch'),
      span: 6,
      required: true,
      options: options.branches,
      defaultValue: defaults?.branchId ?? [...session.branchRoles.keys()][0],
    },
    {
      kind: 'select',
      name: 'partnerId',
      label: t('supplier'),
      span: 6,
      required: true,
      options: options.partners,
      defaultValue: defaults?.partnerId,
    },
    {
      kind: 'file',
      name: 'scan',
      label: t('scan'),
      span: 12,
      required: true,
      accept: 'application/pdf,image/jpeg,image/png,image/webp',
      hint: t('scanHint'),
    },
    ...(defaults?.jobId ? [{ kind: 'hidden' as const, name: 'jobId', value: defaults.jobId }] : []),
    {
      kind: 'note',
      tone: 'info' as const,
      text: t('readBillNote'),
    },
  ]

  return (
    <RecordDialog
      action={readSupplierBill}
      fields={fields}
      icon="assistant"
      size="md"
      variant={variant}
      labels={{
        open: t('readBill'),
        title: t('readBillTitle'),
        description: t('readBillHint'),
        submit: t('readBillSubmit'),
        submitting: t('readBillSubmitting'),
        cancel: tc('cancel'),
      }}
    />
  )
}

export async function SupplierLineDialog({
  billId,
  variant = 'ghost',
}: {
  readonly billId: string
  readonly variant?: 'primary' | 'secondary' | 'ghost'
}) {
  const session = await requireSession()
  if (!can(session, 'payable.record')) return null

  const [options, t, tc] = await Promise.all([
    getLocale().then((locale) => loadOptions(session.actor, locale === 'ar' ? 'ar' : 'en')),
    getTranslations('payableForm'),
    getTranslations('common'),
  ])

  const fields: FieldSpec[] = [
    { kind: 'hidden', name: 'supplierInvoiceId', value: billId },
    {
      kind: 'text',
      name: 'description',
      label: t('lineDescription'),
      span: 12,
      required: true,
      maxLength: 300,
      /*
        Their words, deliberately. A supplier invoice arrives saying "ORIGIN
        DOC FEE"; retyping that as our charge-type name loses the only string
        that ties the row back to the document in the dispute.
      */
      hint: t('lineDescriptionHint'),
    },
    {
      kind: 'select',
      name: 'chargeTypeId',
      label: t('chargeType'),
      span: 6,
      hint: t('chargeTypeHint'),
      options: options.chargeTypes,
      placeholder: tc('none'),
    },
    {
      kind: 'text',
      name: 'quantity',
      label: t('quantity'),
      span: 3,
      required: true,
      mono: true,
      defaultValue: '1',
    },
    {
      kind: 'text',
      name: 'unitPrice',
      label: t('unitPrice'),
      span: 3,
      required: true,
      mono: true,
    },
    {
      kind: 'text',
      name: 'taxAmount',
      label: t('tax'),
      span: 3,
      mono: true,
      defaultValue: '0',
    },
  ]

  return (
    <RecordDialog
      action={addSupplierInvoiceLine}
      fields={fields}
      icon="plus"
      variant={variant}
      labels={{
        open: t('addLine'),
        title: t('addLineTitle'),
        description: t('addLineHint'),
        submit: tc('add'),
        submitting: tc('saving'),
        cancel: tc('cancel'),
      }}
    />
  )
}

// --- the match -------------------------------------------------------------

/**
 * Matching one supplier line to one accrual.
 *
 * The candidate list carries what each accrual is worth and what is already
 * matched against it, because the question being answered is "is this the same
 * cost" and the amounts are most of the answer. A bare list of charge-type
 * names would make the operator open another tab.
 */
export async function MatchDialog({
  billId,
  lineId,
  lineDescription,
  outstanding,
  candidates,
}: {
  readonly billId: string
  readonly lineId: string
  readonly lineDescription: string
  readonly outstanding: string
  readonly candidates: readonly MatchCandidateOption[]
}) {
  const session = await requireSession()
  if (!can(session, 'payable.record')) return null

  const [t, tc] = await Promise.all([getTranslations('payableForm'), getTranslations('common')])

  const fields: FieldSpec[] = [
    { kind: 'hidden', name: 'supplierInvoiceId', value: billId },
    { kind: 'hidden', name: 'supplierInvoiceLineId', value: lineId },
    { kind: 'note', text: t('matchNote', { line: lineDescription }), tone: 'info' },
    {
      kind: 'select',
      name: 'chargeLineId',
      label: t('costLine'),
      span: 12,
      required: true,
      options: candidates.map((c) => ({ value: c.id, label: c.label, group: c.group })),
    },
    {
      kind: 'text',
      name: 'amount',
      label: t('matchAmount'),
      span: 6,
      required: true,
      mono: true,
      hint: t('matchAmountHint'),
      defaultValue: outstanding,
    },
  ]

  return (
    <RecordDialog
      action={matchSupplierLine}
      fields={fields}
      icon="check"
      variant="ghost"
      iconOnly
      labels={{
        open: t('match'),
        title: t('matchTitle'),
        description: t('matchHint'),
        submit: t('match'),
        submitting: tc('saving'),
        cancel: tc('cancel'),
      }}
    />
  )
}

/**
 * Approving, disputing, voiding.
 *
 * The approval form carries the acceptance switch and the reason, and the
 * action refuses without both where the bill is outside tolerance. That
 * refusal is the feature: it is the moment the argument with the agent
 * happens, before the money leaves rather than after.
 */
export async function BillDecisionDialog({
  billId,
  action,
  needsReview,
}: {
  readonly billId: string
  readonly action: 'approve' | 'dispute' | 'void'
  readonly needsReview?: boolean
}) {
  const session = await requireSession()
  const permission = action === 'approve' ? 'payable.approve' : 'payable.record'
  if (!can(session, permission)) return null

  const [t, tc] = await Promise.all([getTranslations('payableForm'), getTranslations('common')])

  const fields: FieldSpec[] = [
    { kind: 'hidden', name: 'supplierInvoiceId', value: billId },
    { kind: 'hidden', name: 'action', value: action },
    ...(action === 'approve' && needsReview
      ? ([
          { kind: 'note', text: t('varianceWarning'), tone: 'caution' },
          {
            kind: 'switch',
            name: 'acceptVariance',
            label: t('acceptVariance'),
            span: 12,
            hint: t('acceptVarianceHint'),
          },
        ] as FieldSpec[])
      : []),
    ...(action !== 'approve' || needsReview
      ? ([
          {
            kind: 'textarea',
            name: 'reason',
            label: t(action === 'approve' ? 'acceptReason' : 'reason'),
            span: 12,
            rows: 3,
            required: true,
          },
        ] as FieldSpec[])
      : []),
  ]

  return (
    <RecordDialog
      action={setSupplierInvoiceStatus}
      fields={fields}
      icon={action === 'approve' ? 'check' : 'alert'}
      variant={action === 'approve' ? 'primary' : 'danger'}
      labels={{
        open: t(`actions.${action}`),
        title: t(`actions.${action}Title`),
        description: t(`actions.${action}Hint`),
        submit: t(`actions.${action}`),
        submitting: tc('saving'),
        cancel: tc('cancel'),
      }}
    />
  )
}

// --- paying ----------------------------------------------------------------

export async function SupplierPaymentDialog({
  partnerId,
  variant = 'primary',
}: {
  readonly partnerId?: string
  readonly variant?: 'primary' | 'secondary' | 'ghost'
}) {
  const session = await requireSession()
  if (!can(session, 'payable.pay')) return null

  const [options, t, tc] = await Promise.all([
    getLocale().then((locale) => loadOptions(session.actor, locale === 'ar' ? 'ar' : 'en')),
    getTranslations('payableForm'),
    getTranslations('common'),
  ])

  const fields: FieldSpec[] = [
    {
      kind: 'select',
      name: 'branchId',
      label: t('branch'),
      span: 6,
      required: true,
      options: options.branches,
      defaultValue: [...session.branchRoles.keys()][0],
    },
    {
      kind: 'select',
      name: 'partnerId',
      label: t('supplier'),
      span: 6,
      required: true,
      options: options.partners,
      defaultValue: partnerId,
    },
    { kind: 'text', name: 'amount', label: t('amount'), span: 4, required: true, mono: true },
    {
      kind: 'select',
      name: 'currency',
      label: t('currency'),
      span: 4,
      required: true,
      options: options.currencies,
      defaultValue: 'KWD',
    },
    { kind: 'text', name: 'fxRate', label: t('fxRate'), span: 4, mono: true, defaultValue: '1' },
    {
      kind: 'date',
      name: 'paidOn',
      label: t('paidOn'),
      span: 4,
      required: true,
      defaultValue: today(),
    },
    {
      kind: 'select',
      name: 'method',
      label: t('method'),
      span: 4,
      required: true,
      options: ['transfer', 'cheque', 'cash', 'card'].map((m) => ({
        value: m,
        label: t(`methods.${m}` as 'methods.transfer'),
      })),
      defaultValue: 'transfer',
    },
    { kind: 'text', name: 'reference', label: t('paymentReference'), span: 4, mono: true },
  ]

  // `lg`, not the default: currency and method share a span-4 row with the
  // date, and at `md` both pickers cut their own values off mid-word.
  return (
    <RecordDialog
      size="lg"
      action={recordSupplierPayment}
      fields={fields}
      icon="payments"
      variant={variant}
      labels={{
        open: t('recordPayment'),
        title: t('recordPaymentTitle'),
        description: t('recordPaymentHint'),
        submit: tc('save'),
        submitting: tc('saving'),
        cancel: tc('cancel'),
      }}
    />
  )
}

export async function AllocatePaymentDialog({
  paymentId,
  bills,
  unallocated,
}: {
  readonly paymentId: string
  readonly bills: readonly { readonly id: string; readonly label: string }[]
  readonly unallocated: string
}) {
  const session = await requireSession()
  if (!can(session, 'payable.pay')) return null

  const [t, tc] = await Promise.all([getTranslations('payableForm'), getTranslations('common')])

  const fields: FieldSpec[] = [
    { kind: 'hidden', name: 'supplierPaymentId', value: paymentId },
    {
      kind: 'select',
      name: 'supplierInvoiceId',
      label: t('bill'),
      span: 12,
      required: true,
      options: bills.map((b) => ({ value: b.id, label: b.label })),
    },
    {
      kind: 'text',
      name: 'amount',
      label: t('amount'),
      span: 6,
      required: true,
      mono: true,
      defaultValue: unallocated,
    },
  ]

  return (
    <RecordDialog
      action={allocateSupplierPayment}
      fields={fields}
      icon="check"
      variant="ghost"
      iconOnly
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

// --- netting ---------------------------------------------------------------

export async function SettlementDialog({
  partners: settleable,
  variant = 'primary',
}: {
  readonly partners: readonly { readonly id: string; readonly name: string }[]
  readonly variant?: 'primary' | 'secondary' | 'ghost'
}) {
  const session = await requireSession()
  if (!can(session, 'settlement.run')) return null

  const [options, t, tc] = await Promise.all([
    getLocale().then((locale) => loadOptions(session.actor, locale === 'ar' ? 'ar' : 'en')),
    getTranslations('settlementForm'),
    getTranslations('common'),
  ])

  const now = new Date()
  const firstOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
    .toISOString()
    .slice(0, 10)

  const fields: FieldSpec[] = [
    {
      kind: 'select',
      name: 'branchId',
      label: t('branch'),
      span: 6,
      required: true,
      options: options.branches,
      defaultValue: [...session.branchRoles.keys()][0],
    },
    {
      kind: 'select',
      name: 'partnerId',
      label: t('agent'),
      span: 6,
      required: true,
      hint: t('agentHint'),
      options: settleable.map((p) => ({ value: p.id, label: p.name })),
    },
    {
      kind: 'date',
      name: 'periodFrom',
      label: t('periodFrom'),
      span: 4,
      required: true,
      defaultValue: firstOfMonth,
    },
    {
      kind: 'date',
      name: 'periodTo',
      label: t('periodTo'),
      span: 4,
      required: true,
      defaultValue: today(),
    },
    {
      kind: 'text',
      name: 'fxRate',
      label: t('agreedRate'),
      span: 4,
      mono: true,
      hint: t('agreedRateHint'),
      defaultValue: '1',
    },
  ]

  return (
    <RecordDialog
      action={draftSettlement}
      fields={fields}
      icon="finance"
      variant={variant}
      labels={{
        open: t('draft'),
        title: t('draftTitle'),
        description: t('draftHint'),
        submit: t('draft'),
        submitting: tc('saving'),
        cancel: tc('cancel'),
      }}
    />
  )
}

/**
 * Linking a partner to the customer record they invoice us as.
 *
 * Nothing guesses at this. Matching on name, or on country, would eventually
 * net a settlement against a different company with a similar name, and that
 * is not a mistake anybody discovers quickly.
 */
export async function PartnerAccountDialog({
  partnerId,
  defaults,
}: {
  readonly partnerId: string
  readonly defaults?: {
    readonly settlementCustomerId?: string | null
    readonly settlementCurrency?: string | null
  }
}) {
  const session = await requireSession()
  if (!can(session, 'partner.write')) return null

  const [options, t, tc] = await Promise.all([
    getLocale().then((locale) => loadOptions(session.actor, locale === 'ar' ? 'ar' : 'en')),
    getTranslations('settlementForm'),
    getTranslations('common'),
  ])

  const fields: FieldSpec[] = [
    { kind: 'hidden', name: 'partnerId', value: partnerId },
    { kind: 'note', text: t('linkNote'), tone: 'info' },
    {
      kind: 'select',
      name: 'settlementCustomerId',
      label: t('asCustomer'),
      span: 8,
      options: options.customers,
      placeholder: tc('none'),
      defaultValue: defaults?.settlementCustomerId,
    },
    {
      kind: 'select',
      name: 'settlementCurrency',
      label: t('settlementCurrency'),
      span: 4,
      hint: t('settlementCurrencyHint'),
      options: options.currencies,
      placeholder: tc('none'),
      defaultValue: defaults?.settlementCurrency,
    },
  ]

  return (
    <RecordDialog
      action={linkPartnerAccount}
      fields={fields}
      icon="partners"
      variant="secondary"
      labels={{
        open: t('link'),
        title: t('linkTitle'),
        description: t('linkHint'),
        submit: tc('save'),
        submitting: tc('saving'),
        cancel: tc('cancel'),
      }}
    />
  )
}

/** The partner half of the tolerance configuration — FR-AD-03, rows not code. */
export async function PartnerToleranceDialog({
  partnerId,
  defaults,
}: {
  readonly partnerId: string
  readonly defaults?: { readonly percent?: string | null; readonly absolute?: string | null }
}) {
  const session = await requireSession()
  if (!can(session, 'partner.write')) return null

  const [t, tc] = await Promise.all([getTranslations('settlementForm'), getTranslations('common')])

  const fields: FieldSpec[] = [
    { kind: 'hidden', name: 'partnerId', value: partnerId },
    { kind: 'note', text: t('toleranceNote'), tone: 'info' },
    {
      kind: 'text',
      name: 'varianceTolerancePercent',
      label: t('tolerancePercent'),
      span: 6,
      mono: true,
      suffix: '%',
      defaultValue: defaults?.percent ?? '0',
    },
    {
      kind: 'text',
      name: 'varianceToleranceAbsolute',
      label: t('toleranceAbsolute'),
      span: 6,
      mono: true,
      defaultValue: defaults?.absolute ?? '0',
    },
  ]

  return (
    <RecordDialog
      action={setPartnerTolerance}
      fields={fields}
      icon="rates"
      variant="secondary"
      labels={{
        open: t('tolerance'),
        title: t('toleranceTitle'),
        description: t('toleranceHint'),
        submit: tc('save'),
        submitting: tc('saving'),
        cancel: tc('cancel'),
      }}
    />
  )
}
