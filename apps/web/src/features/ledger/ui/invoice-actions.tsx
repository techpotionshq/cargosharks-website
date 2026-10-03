/**
 * Invoice actions — adding a line, and moving the document on.
 *
 * The status moves come from `invoiceMachine` in `@qabandi/core`, so the
 * buttons offered are exactly the transitions the server action will accept.
 * Each has its own permission, and they are genuinely different rights:
 * approving is a review, issuing commits a statutory number, voiding destroys
 * an issued document's effect and crediting replaces it with another.
 */

import { getLocale, getTranslations } from 'next-intl/server'
import { invoiceMachine, nextStates, type InvoiceStatus } from '@qabandi/core'
import { requireSession } from '@/lib/session'
import { can, canIn } from '@/lib/permissions'
import { loadOptions } from '@/lib/options'
import { RecordDialog } from '@/ui/record-dialog'
import { formatMoney } from '@/lib/format'
import {
  addInvoiceLine,
  creditInvoice,
  setInvoiceLanguage,
  setInvoiceStatus,
} from '../form-actions'

const MOVES: Partial<
  Record<
    InvoiceStatus,
    {
      permission: string
      variant: 'primary' | 'secondary' | 'danger'
      icon: 'check' | 'arrow-end' | 'close'
      /** Warns rather than informs — an irreversible move. */
      grave?: boolean
    }
  >
> = {
  approved: { permission: 'invoice.approve', variant: 'secondary', icon: 'check' },
  issued: { permission: 'invoice.issue', variant: 'primary', icon: 'arrow-end', grave: true },
  void: { permission: 'invoice.void', variant: 'danger', icon: 'close', grave: true },
  credited: { permission: 'invoice.credit', variant: 'secondary', icon: 'close', grave: true },
}

/** The moves that take the record forward, as opposed to ending it. */
const FORWARD: readonly InvoiceStatus[] = ['approved', 'issued']

export async function InvoiceStatusActions({
  invoiceId,
  status,
  part = 'all',
}: {
  readonly invoiceId: string
  readonly status: string
  /**
   * Which half of the moves to render.
   *
   * A detail page header shows the move that takes the record *forward* as
   * its one primary button and folds the rest — voiding, crediting,
   * rejecting — into its More menu, so the page is split by the caller and
   * each half asks for its own. `all` is the old behaviour.
   */
  readonly part?: 'forward' | 'other' | 'all'
}) {
  const session = await requireSession()
  const [t, tc] = await Promise.all([getTranslations('invoiceDetail'), getTranslations('common')])

  const allowed = nextStates(invoiceMachine, status as InvoiceStatus)
    .map((next) => ({ next, move: MOVES[next] }))
    .filter(
      (entry): entry is { next: InvoiceStatus; move: NonNullable<(typeof MOVES)[InvoiceStatus]> } =>
        Boolean(entry.move) && can(session, entry.move!.permission),
    )

  // One forward move at most: the first the machine offers. Anything after
  // it is still offered, in the menu.
  const lead = allowed.find(({ next }) => FORWARD.includes(next))
  const shown =
    part === 'all'
      ? allowed
      : part === 'forward'
        ? lead
          ? [lead]
          : []
        : allowed.filter((entry) => entry !== lead)

  if (shown.length === 0) return null

  return (
    <>
      {shown.map(({ next, move }) => (
        <RecordDialog
          key={next}
          action={setInvoiceStatus}
          icon={move.icon}
          size="sm"
          // The forward move is the header's one primary button.
          variant={part === 'forward' ? 'primary' : move.variant}
          submitIcon={move.icon}
          fields={[
            { kind: 'hidden', name: 'invoiceId', value: invoiceId },
            { kind: 'hidden', name: 'status', value: next },
            {
              kind: 'note',
              text: t(`confirm.${next}` as 'confirm.issued'),
              tone: move.grave ? 'caution' : 'info',
            },
          ]}
          labels={{
            /*
              A verb, not the status it leads to. The button read "Issued"
              on a draft — which looks like a label saying it already is,
              and nobody clicks a label. `moveOpen` says what pressing it
              does; the status name stays on the pill.
            */
            open: t(`moveOpen.${next}` as 'moveOpen.issued'),
            title: t(`moveTitle.${next}` as 'moveTitle.issued'),
            description: t(`moveDescription.${next}` as 'moveDescription.issued'),
            submit: t(`moveSubmit.${next}` as 'moveSubmit.issued'),
            submitting: tc('saving'),
            cancel: tc('cancel'),
            success: t(`moveDone.${next}` as 'moveDone.issued'),
          }}
        />
      ))}
    </>
  )
}

/**
 * Add a charge line. Draft invoices only.
 *
 * The caller decides whether to render this, which is why there is no status
 * check here — but the action re-reads the invoice and the totals are
 * recomputed from the lines, so a line added to something that stopped being a
 * draft mid-dialog still cannot leave the header inconsistent.
 */
export async function InvoiceLineDialog({ invoiceId }: { readonly invoiceId: string }) {
  const session = await requireSession()
  if (!can(session, 'invoice.approve')) return null

  const [options, t, tc] = await Promise.all([
    getLocale().then((locale) => loadOptions(session.actor, locale === 'ar' ? 'ar' : 'en')),
    getTranslations('invoiceDetail'),
    getTranslations('common'),
  ])

  return (
    <RecordDialog
      action={addInvoiceLine}
      icon="plus"
      size="md"
      variant="secondary"
      submitIcon="plus"
      fields={[
        { kind: 'hidden', name: 'invoiceId', value: invoiceId },
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
          name: 'descriptionEn',
          label: t('description'),
          span: 12,
          required: true,
          hint: t('descriptionHint'),
        },
        { kind: 'text', name: 'quantity', label: t('quantity'), span: 6, defaultValue: '1' },
        { kind: 'text', name: 'unitPrice', label: t('unitPrice'), span: 6, required: true },
        {
          kind: 'switch',
          name: 'isTaxable',
          label: t('taxable'),
          span: 12,
          hint: t('taxableHint'),
          defaultChecked: true,
        },
      ]}
      labels={{
        open: t('addLine'),
        title: t('addLineTitle'),
        description: t('addLineDescription'),
        submit: t('addLineSubmit'),
        submitting: tc('saving'),
        cancel: tc('cancel'),
      }}
    />
  )
}

/**
 * Change a draft's document language.
 *
 * A draft from the unbilled register took a language nobody chose and could
 * not be changed, so a customer who reads Arabic was issued English. Offered
 * on a draft only, to whoever may edit invoices in its branch; the action
 * re-checks both.
 */
export async function InvoiceLanguageDialog({
  invoiceId,
  branchId,
  status,
  language,
}: {
  readonly invoiceId: string
  readonly branchId: string
  readonly status: string
  readonly language: string
}) {
  if (status !== 'draft') return null
  const session = await requireSession()
  if (!canIn(session, 'invoice.approve', branchId)) return null

  const [t, tc] = await Promise.all([getTranslations('invoiceDetail'), getTranslations('common')])

  return (
    <RecordDialog
      action={setInvoiceLanguage}
      icon="globe"
      size="sm"
      variant="secondary"
      submitIcon="check"
      fields={[
        { kind: 'hidden', name: 'invoiceId', value: invoiceId },
        {
          kind: 'select',
          name: 'language',
          label: t('language'),
          span: 12,
          required: true,
          defaultValue: language,
          options: [
            { value: 'en', label: t('languages.en') },
            { value: 'ar', label: t('languages.ar') },
          ],
        },
      ]}
      labels={{
        open: t('languageChange.open'),
        title: t('languageChange.title'),
        description: t('languageChange.description'),
        submit: t('languageChange.submit'),
        submitting: tc('saving'),
        cancel: tc('cancel'),
        success: t('languageChange.done'),
      }}
    />
  )
}

/**
 * Credit part of an issued or part-paid invoice — F9.
 *
 * Beside "Credit note raised", which credits everything still owed, rather
 * than instead of it: the whole-invoice correction is the common case and
 * should stay one confirmation. This one asks for the amount, opens on the
 * most it can be, and says that figure in words so a clerk crediting a
 * disputed line can see the ceiling before the server refuses past it.
 *
 * Rendered only where the action would accept it: the right state, not a
 * credit note itself, and `invoice.credit` in the invoice's own branch.
 */
export async function CreditNoteDialog({
  invoiceId,
  branchId,
  status,
  isCreditNote,
  currency,
  creditable,
}: {
  readonly invoiceId: string
  readonly branchId: string
  readonly status: string
  readonly isCreditNote: boolean
  readonly currency: string
  /** What is still owed, as a decimal string — the ceiling. */
  readonly creditable: string
}) {
  if (isCreditNote || !['issued', 'part_paid'].includes(status)) return null
  const session = await requireSession()
  if (!canIn(session, 'invoice.credit', branchId)) return null

  const [t, tc, locale] = await Promise.all([
    getTranslations('invoiceDetail'),
    getTranslations('common'),
    getLocale(),
  ])
  const ceiling = formatMoney({ amount: creditable, currency }, locale === 'ar' ? 'ar' : 'en')

  return (
    <RecordDialog
      action={creditInvoice}
      icon="close"
      size="md"
      variant="secondary"
      submitIcon="check"
      fields={[
        { kind: 'hidden', name: 'invoiceId', value: invoiceId },
        { kind: 'note', text: t('partialCredit.note', { ceiling }), tone: 'caution' },
        {
          kind: 'text',
          name: 'amount',
          label: t('partialCredit.amount'),
          span: 12,
          required: true,
          mono: true,
          suffix: currency,
          defaultValue: creditable,
          hint: t('partialCredit.amountHint'),
        },
        {
          kind: 'textarea',
          name: 'notes',
          label: t('partialCredit.reason'),
          span: 12,
          rows: 2,
          hint: t('partialCredit.reasonHint'),
        },
      ]}
      labels={{
        open: t('partialCredit.open'),
        title: t('partialCredit.title'),
        description: t('partialCredit.description'),
        submit: t('partialCredit.submit'),
        submitting: tc('saving'),
        cancel: tc('cancel'),
        success: t('partialCredit.done'),
      }}
    />
  )
}
