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
import { can } from '@/lib/permissions'
import { loadOptions } from '@/lib/options'
import { RecordDialog } from '@/ui/record-dialog'
import { addInvoiceLine, setInvoiceStatus } from '../form-actions'

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

export async function InvoiceStatusActions({
  invoiceId,
  status,
}: {
  readonly invoiceId: string
  readonly status: string
}) {
  const session = await requireSession()
  const [t, tc, ti] = await Promise.all([
    getTranslations('invoiceDetail'),
    getTranslations('common'),
    getTranslations('invoices'),
  ])

  const allowed = nextStates(invoiceMachine, status as InvoiceStatus)
    .map((next) => ({ next, move: MOVES[next] }))
    .filter(
      (entry): entry is { next: InvoiceStatus; move: NonNullable<(typeof MOVES)[InvoiceStatus]> } =>
        Boolean(entry.move) && can(session, entry.move!.permission),
    )

  if (allowed.length === 0) return null

  return (
    <>
      {allowed.map(({ next, move }) => (
        <RecordDialog
          key={next}
          action={setInvoiceStatus}
          icon={move.icon}
          size="sm"
          variant={move.variant}
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
            open: ti(`statuses.${next}` as 'statuses.issued'),
            title: t(`moveTitle.${next}` as 'moveTitle.issued'),
            description: t(`moveDescription.${next}` as 'moveDescription.issued'),
            submit: t(`moveSubmit.${next}` as 'moveSubmit.issued'),
            submitting: tc('saving'),
            cancel: tc('cancel'),
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
