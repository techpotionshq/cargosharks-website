/**
 * The consolidation forms.
 *
 * Three, and the third is the one that matters. Building a master records
 * facts a booking confirmation already states; adding a cost records what we
 * were charged. Choosing how that cost divides is the decision — it is what
 * makes house eleven's margin true or fictional — so the basis is a field on
 * the cost, chosen when it is entered, rather than a question asked later by
 * whoever happens to click allocate.
 */

import { getLocale, getTranslations } from 'next-intl/server'
import { requireSession } from '@/lib/session'
import { can } from '@/lib/permissions'
import { loadOptions } from '@/lib/options'
import { RecordDialog, type FieldSpec } from '@/ui/record-dialog'
import { addConsolCharge, saveConsolidation } from '../form-actions'

const MODES = ['sea_lcl', 'air', 'sea_fcl', 'land', 'courier'] as const
const DIRECTIONS = ['import', 'export', 'cross_trade'] as const
const BASES = [
  'volume',
  'chargeable_weight',
  'gross_weight',
  'packages',
  'equal',
  'manual',
] as const

export interface ConsolidationDefaults {
  readonly id?: string
  readonly branchId?: string
  readonly mode?: string
  readonly tradeDirection?: string
  readonly masterBillNumber?: string | null
  readonly bookingNumber?: string | null
  readonly vesselName?: string | null
  readonly voyageNumber?: string | null
  readonly flightNumber?: string | null
  readonly notes?: string | null
}

export async function ConsolidationDialog({
  defaults,
  variant = 'primary',
}: {
  readonly defaults?: ConsolidationDefaults
  readonly variant?: 'primary' | 'secondary' | 'ghost'
}) {
  const session = await requireSession()
  if (!can(session, 'consol.write')) return null

  const [options, t, tc, tMode, tDirection] = await Promise.all([
    getLocale().then((locale) => loadOptions(session.actor, locale === 'ar' ? 'ar' : 'en')),
    getTranslations('consolidations'),
    getTranslations('common'),
    getTranslations('mode'),
    getTranslations('direction'),
  ])

  const editing = Boolean(defaults?.id)

  const fields: FieldSpec[] = [
    ...(editing
      ? [{ kind: 'hidden' as const, name: 'consolidationId', value: defaults!.id! }]
      : []),
    {
      kind: 'section',
      title: t('sections.what'),
      fields: [
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
          name: 'tradeDirection',
          label: t('direction'),
          span: 6,
          required: true,
          options: DIRECTIONS.map((key) => ({ value: key, label: tDirection(key) })),
          defaultValue: defaults?.tradeDirection ?? 'import',
        },
        {
          kind: 'choices',
          name: 'mode',
          label: t('mode'),
          span: 12,
          required: true,
          hint: t('modeHint'),
          options: MODES.map((mode) => ({ value: mode, label: tMode(mode) })),
          defaultValue: defaults?.mode ?? 'sea_lcl',
        },
      ],
    },
    {
      kind: 'section',
      title: t('sections.carrier'),
      hint: t('sections.carrierHint'),
      fields: [
        {
          kind: 'text',
          name: 'masterBillNumber',
          label: t('masterBill'),
          span: 6,
          mono: true,
          defaultValue: defaults?.masterBillNumber,
        },
        {
          kind: 'text',
          name: 'bookingNumber',
          label: t('booking'),
          span: 6,
          mono: true,
          defaultValue: defaults?.bookingNumber,
        },
        {
          kind: 'select',
          name: 'carrierPartnerId',
          label: t('carrier'),
          span: 6,
          options: options.partners,
          placeholder: tc('choose'),
        },
        {
          kind: 'select',
          name: 'coloadPartnerId',
          label: t('coloader'),
          span: 6,
          hint: t('coloaderHint'),
          options: options.partners,
          placeholder: tc('choose'),
        },
        {
          kind: 'text',
          name: 'vesselName',
          label: t('vessel'),
          span: 4,
          defaultValue: defaults?.vesselName,
        },
        {
          kind: 'text',
          name: 'voyageNumber',
          label: t('voyage'),
          span: 4,
          mono: true,
          defaultValue: defaults?.voyageNumber,
        },
        {
          kind: 'text',
          name: 'flightNumber',
          label: t('flight'),
          span: 4,
          mono: true,
          defaultValue: defaults?.flightNumber,
        },
      ],
    },
    {
      kind: 'section',
      title: t('sections.route'),
      fields: [
        {
          kind: 'select',
          name: 'originId',
          label: t('origin'),
          span: 6,
          options: options.locations,
          placeholder: tc('choose'),
        },
        {
          kind: 'select',
          name: 'destinationId',
          label: t('destination'),
          span: 6,
          options: options.locations,
          placeholder: tc('choose'),
        },
        { kind: 'datetime-local', name: 'etd', label: t('etd'), span: 6 },
        { kind: 'datetime-local', name: 'eta', label: t('eta'), span: 6 },
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

  return (
    <RecordDialog
      action={saveConsolidation}
      fields={fields}
      icon="ship"
      size="lg"
      variant={variant}
      labels={{
        open: editing ? tc('edit') : t('add'),
        title: editing ? t('editTitle') : t('addTitle'),
        description: t('dialogDescription'),
        submit: tc('save'),
        submitting: tc('saving'),
        cancel: tc('cancel'),
      }}
    />
  )
}

export async function ConsolChargeDialog({
  consolidationId,
}: {
  readonly consolidationId: string
}) {
  const session = await requireSession()
  if (!can(session, 'consol.write')) return null

  const [options, t, tc] = await Promise.all([
    getLocale().then((locale) => loadOptions(session.actor, locale === 'ar' ? 'ar' : 'en')),
    getTranslations('consolidations'),
    getTranslations('common'),
  ])

  const fields: FieldSpec[] = [
    { kind: 'hidden', name: 'consolidationId', value: consolidationId },
    {
      kind: 'choices',
      name: 'direction',
      label: t('chargeDirection'),
      span: 12,
      required: true,
      hint: t('chargeDirectionHint'),
      options: [
        { value: 'cost', label: t('cost') },
        { value: 'revenue', label: t('revenue') },
      ],
      defaultValue: 'cost',
    },
    {
      kind: 'select',
      name: 'chargeTypeId',
      label: t('chargeType'),
      span: 6,
      required: true,
      options: options.chargeTypes,
      placeholder: tc('choose'),
    },
    {
      kind: 'select',
      name: 'counterpartyPartnerId',
      label: t('counterparty'),
      span: 6,
      options: options.partners,
      placeholder: tc('choose'),
    },
    { kind: 'text', name: 'amount', label: t('amount'), span: 4, required: true, mono: true },
    {
      kind: 'select',
      name: 'currency',
      label: tc('currency'),
      span: 4,
      required: true,
      options: options.currencies,
      defaultValue: 'KWD',
    },
    {
      kind: 'text',
      name: 'fxRate',
      label: t('fxRate'),
      span: 4,
      mono: true,
      hint: t('fxRateHint'),
      defaultValue: '1',
    },
    {
      kind: 'select',
      name: 'allocationBasis',
      label: t('basis'),
      span: 12,
      required: true,
      hint: t('basisHint'),
      options: BASES.map((basis) => ({
        value: basis,
        label: t(`bases.${basis}` as 'bases.volume'),
      })),
      defaultValue: 'volume',
    },
    { kind: 'text', name: 'description', label: tc('description'), span: 12 },
  ]

  // `lg`, not the default: the currency picker sits in a span-4 column, and
  // at `md` that is narrow enough to render "KWD — Kuwaiti D" and stop.
  return (
    <RecordDialog
      size="lg"
      action={addConsolCharge}
      fields={fields}
      icon="finance"
      variant="ghost"
      labels={{
        open: t('addCharge'),
        title: t('addChargeTitle'),
        description: t('addChargeDescription'),
        submit: tc('save'),
        submitting: tc('saving'),
        cancel: tc('cancel'),
      }}
    />
  )
}
