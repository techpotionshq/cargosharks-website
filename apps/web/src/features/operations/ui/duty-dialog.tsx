/**
 * The landed-cost question, answered before the goods ship.
 *
 * CIF is the whole point of the form: goods, freight and insurance are three
 * fields because the GCC assesses duty on all three, and leaving the freight
 * out is the single most common way an estimate comes in low.
 *
 * The general-rate switch is off by default and stays that way. Applying 5% to
 * a code the tariff has no row for produces a number that looks researched and
 * is a guess — the operator has to choose it, and the estimate records that
 * they did.
 */

import { getLocale, getTranslations } from 'next-intl/server'
import { requireSession } from '@/lib/session'
import { can } from '@/lib/permissions'
import { loadOptions } from '@/lib/options'
import { RecordDialog, type FieldSpec } from '@/ui/record-dialog'
import { estimateJobDuty } from '../duty-actions'

export async function DutyEstimateDialog({
  jobId,
  variant = 'secondary',
}: {
  readonly jobId: string
  readonly variant?: 'primary' | 'secondary' | 'ghost'
}) {
  const session = await requireSession()
  if (!can(session, 'customs.update')) return null

  const [options, t, tc] = await Promise.all([
    getLocale().then((locale) => loadOptions(session.actor, locale === 'ar' ? 'ar' : 'en')),
    getTranslations('duty'),
    getTranslations('common'),
  ])

  const fields: FieldSpec[] = [
    { kind: 'hidden', name: 'jobId', value: jobId },
    {
      kind: 'text',
      name: 'goodsValue',
      label: t('goods'),
      span: 6,
      required: true,
      mono: true,
      hint: t('goodsHint'),
    },
    {
      kind: 'select',
      name: 'currency',
      label: tc('currency'),
      span: 6,
      required: true,
      options: options.currencies,
      defaultValue: 'KWD',
    },
    {
      kind: 'text',
      name: 'freightValue',
      label: t('freight'),
      span: 6,
      mono: true,
      hint: t('freightHint'),
    },
    { kind: 'text', name: 'insuranceValue', label: t('insurance'), span: 6, mono: true },
    {
      kind: 'switch',
      name: 'useGeneralRate',
      label: t('generalRate'),
      span: 12,
      hint: t('generalRateHint'),
    },
    { kind: 'note', text: t('note'), tone: 'info' },
  ]

  return (
    <RecordDialog
      action={estimateJobDuty}
      fields={fields}
      icon="customs"
      variant={variant}
      labels={{
        open: t('open'),
        title: t('title'),
        description: t('description'),
        submit: t('estimate'),
        submitting: tc('saving'),
        cancel: tc('cancel'),
      }}
    />
  )
}
