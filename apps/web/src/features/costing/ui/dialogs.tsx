/**
 * Entering a charge by hand.
 *
 * Most lines in the ledger are written by something — the free-time accrual
 * worker, the consolidation allocator, the duty estimator. This form is for
 * the ones that are not: a haulier's call-out, an inspection nobody predicted,
 * a correction before the line has been billed or matched.
 *
 * The rate and the quantity are separate fields and the amount is not a field
 * at all. It is `quantity × rate`, rounded to the currency, computed in the
 * action — because a form that lets somebody type all three eventually has all
 * three disagreeing, and the one that gets believed is whichever the invoice
 * builder happens to read.
 */

import { getLocale, getTranslations } from 'next-intl/server'
import { amountInput } from '@/lib/format'
import { requireSession } from '@/lib/session'
import { can } from '@/lib/permissions'
import { loadOptions } from '@/lib/options'
import { RecordDialog, type FieldSpec } from '@/ui/record-dialog'
import { saveChargeLine } from '../form-actions'

const BASES = [
  'flat',
  'per_unit',
  'per_kg',
  'per_cbm',
  'per_wm',
  'per_container',
  'per_day',
  'percent',
] as const

export interface ChargeLineDefaults {
  readonly id?: string
  readonly direction?: string
  readonly chargeTypeId?: string
  readonly description?: string | null
  readonly basis?: string
  readonly quantity?: string | null
  readonly rate?: string | null
  readonly currency?: string
  readonly fxRate?: string | null
  readonly counterpartyPartnerId?: string | null
}

export async function ChargeLineDialog({
  jobId,
  defaults,
  variant = 'primary',
  iconOnly = false,
}: {
  readonly jobId: string
  readonly defaults?: ChargeLineDefaults
  readonly variant?: 'primary' | 'secondary' | 'ghost'
  readonly iconOnly?: boolean
}) {
  const session = await requireSession()
  if (!can(session, 'job.update')) return null

  /*
    The six bases are named once, in `quote`, and read from there.

    They are the same six `core/rating.ts` calculates on, and a second copy
    under `chargeForm` would be six strings to translate twice and eventually
    two vocabularies for one concept on two screens.
  */
  const [options, t, tc, tBasis] = await Promise.all([
    getLocale().then((locale) => loadOptions(session.actor, locale === 'ar' ? 'ar' : 'en')),
    getTranslations('chargeForm'),
    getTranslations('common'),
    getTranslations('quote'),
  ])

  const editing = Boolean(defaults?.id)

  const fields: FieldSpec[] = [
    { kind: 'hidden', name: 'jobId', value: jobId },
    ...(editing ? [{ kind: 'hidden' as const, name: 'chargeLineId', value: defaults!.id! }] : []),
    {
      kind: 'section',
      title: t('sections.what'),
      fields: [
        {
          kind: 'choices',
          name: 'direction',
          label: t('direction'),
          span: 12,
          required: true,
          hint: t('directionHint'),
          options: [
            { value: 'cost', label: t('cost'), icon: 'payments' },
            { value: 'revenue', label: t('revenue'), icon: 'invoices' },
          ],
          defaultValue: defaults?.direction ?? 'cost',
        },
        {
          kind: 'select',
          name: 'chargeTypeId',
          label: t('chargeType'),
          span: 6,
          required: true,
          options: options.chargeTypes,
          defaultValue: defaults?.chargeTypeId,
        },
        {
          kind: 'select',
          name: 'basis',
          label: t('basis'),
          span: 6,
          required: true,
          options: BASES.map((basis) => ({ value: basis, label: tBasis(`bases.${basis}`) })),
          defaultValue: defaults?.basis ?? 'flat',
        },
        {
          kind: 'text',
          name: 'description',
          label: t('description'),
          span: 12,
          maxLength: 300,
          placeholder: t('descriptionHint'),
          defaultValue: defaults?.description,
        },
      ],
    },
    {
      kind: 'section',
      title: t('sections.howMuch'),
      hint: t('sections.howMuchHint'),
      fields: [
        {
          kind: 'text',
          name: 'quantity',
          label: t('quantity'),
          span: 4,
          required: true,
          mono: true,
          defaultValue: defaults?.quantity ?? '1',
        },
        {
          kind: 'text',
          name: 'rate',
          label: t('rate'),
          span: 4,
          required: true,
          mono: true,
          defaultValue: amountInput(defaults?.rate, defaults?.currency),
        },
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
          span: 6,
          mono: true,
          /*
            Typed, not looked up, and stored on the row.

            FR-RT-06: the rate a cost was taken at is a property of the cost,
            not of today. A line revalued later disagrees with the journal that
            posted it, and the disagreement surfaces months afterwards as a
            payables balance nobody can reconcile.
          */
          hint: t('fxRateHint'),
          // Blank, not 1: a blank rate is looked up from `fx_rates`, and a
          // default of 1 booked every foreign cost at face value in base.
          defaultValue: defaults?.fxRate,
        },
        {
          kind: 'select',
          name: 'counterpartyPartnerId',
          label: t('counterparty'),
          span: 6,
          hint: t('counterpartyHint'),
          options: options.partners,
          placeholder: tc('none'),
          defaultValue: defaults?.counterpartyPartnerId,
        },
      ],
    },
  ]

  // `lg`, not the default: the currency picker sits in a span-4 column, and
  // at `md` that is narrow enough to render "KWD — Kuwaiti D" and stop.
  return (
    <RecordDialog
      size="lg"
      action={saveChargeLine}
      fields={fields}
      icon="finance"
      iconOnly={iconOnly}
      variant={variant}
      labels={{
        open: editing ? tc('edit') : t('add'),
        title: editing ? t('editTitle') : t('addTitle'),
        description: t('formHint'),
        submit: tc('save'),
        submitting: tc('saving'),
        cancel: tc('cancel'),
      }}
    />
  )
}
