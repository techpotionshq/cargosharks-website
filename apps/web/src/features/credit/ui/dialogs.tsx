/**
 * The credit override form.
 *
 * One form, and its shape is the argument. The figures are shown as a note
 * above the reason field rather than as editable inputs, because the manager
 * is not entering data — they are agreeing to a number the system has already
 * worked out, and an editable exposure would be an invitation to disagree with
 * the ledger in a text box.
 *
 * The expiry field is offered before the reason, deliberately. The first
 * decision is *what kind* of exception this is — this shipment, or this
 * customer for a while — and it changes what the reason needs to say.
 */

import { getTranslations } from 'next-intl/server'
import { requireSession } from '@/lib/session'
import { can } from '@/lib/permissions'
import { RecordDialog, type FieldSpec } from '@/ui/record-dialog'
import { recordCreditOverride } from '../form-actions'

export interface CreditOverrideDefaults {
  readonly customerId: string
  readonly branchId: string
  /** Set where the override is raised from a blocked shipment or invoice. */
  readonly jobId?: string
  readonly invoiceId?: string
  readonly exposure: string
  readonly limit: string
  readonly currency: string
}

export async function CreditOverrideDialog({
  defaults,
  variant = 'secondary',
}: {
  readonly defaults: CreditOverrideDefaults
  readonly variant?: 'primary' | 'secondary' | 'ghost'
}) {
  const session = await requireSession()
  if (!can(session, 'credit.override')) return null

  const [t, tc] = await Promise.all([getTranslations('creditForm'), getTranslations('common')])

  const fields: FieldSpec[] = [
    { kind: 'hidden', name: 'customerId', value: defaults.customerId },
    { kind: 'hidden', name: 'branchId', value: defaults.branchId },
    ...(defaults.jobId ? [{ kind: 'hidden' as const, name: 'jobId', value: defaults.jobId }] : []),
    ...(defaults.invoiceId
      ? [{ kind: 'hidden' as const, name: 'invoiceId', value: defaults.invoiceId }]
      : []),
    {
      kind: 'note',
      tone: 'caution',
      text: t('standing', {
        exposure: `${defaults.exposure} ${defaults.currency}`,
        limit: `${defaults.limit} ${defaults.currency}`,
      }),
    },
    {
      kind: 'date',
      name: 'expiresOn',
      label: t('expiresOn'),
      span: 6,
      hint: defaults.jobId || defaults.invoiceId ? t('expiresOnHintOneShot') : t('expiresOnHint'),
    },
    {
      kind: 'textarea',
      name: 'reason',
      label: t('reason'),
      rows: 3,
      required: true,
      hint: t('reasonHint'),
    },
  ]

  return (
    <RecordDialog
      action={recordCreditOverride}
      fields={fields}
      icon="hold"
      variant={variant}
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
