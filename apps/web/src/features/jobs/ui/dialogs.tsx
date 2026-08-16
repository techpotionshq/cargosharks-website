/**
 * The shipment dialog.
 *
 * The longest form in the product, and the only one worth splitting into
 * sections: who and where, the carrier's numbers, the dates, and the cargo.
 * Ordered the way a booking confirmation is read, so someone copying one into
 * the system works top to bottom rather than hunting.
 *
 * Only six fields are required — branch, customer, mode, direction, origin,
 * destination. Everything else arrives later: a shipment is opened the moment
 * it is booked, and the bill number does not exist yet at that point.
 */

import { getTranslations } from 'next-intl/server'
import { requireSession } from '@/lib/session'
import { can } from '@/lib/permissions'
import { loadOptions } from '@/lib/options'
import { RecordDialog, type FieldSpec } from '@/ui/record-dialog'
import { saveJob } from '../form-actions'

const MODES = ['sea_fcl', 'sea_lcl', 'air', 'land', 'courier'] as const
const DIRECTIONS = ['import', 'export', 'cross_trade'] as const
const STATUSES = [
  'draft', 'booked', 'in_transit', 'arrived', 'customs',
  'delivered', 'completed', 'closed', 'on_hold',
] as const

const MODE_ICON = {
  sea_fcl: 'container',
  sea_lcl: 'ship',
  air: 'plane',
  land: 'truck',
  courier: 'courier',
} as const

export interface JobDefaults {
  readonly id?: string
  readonly branchId?: string
  readonly customerId?: string
  readonly quoteId?: string | null
  readonly mode?: string
  readonly tradeDirection?: string
  readonly status?: string
  readonly ownerId?: string | null
  readonly originId?: string | null
  readonly destinationId?: string | null
  readonly commodityId?: string | null
  readonly incoterm?: string | null
  readonly masterBillNumber?: string | null
  readonly houseBillNumber?: string | null
  readonly bookingNumber?: string | null
  readonly vesselName?: string | null
  readonly voyageNumber?: string | null
  readonly flightNumber?: string | null
  readonly customerReference?: string | null
  readonly etd?: string | null
  readonly eta?: string | null
  readonly grossWeightKg?: string | null
  readonly volumeCbm?: string | null
  readonly pieces?: number | null
}

export async function JobDialog({
  defaults,
  variant = 'primary',
  iconOnly = false,
}: {
  readonly defaults?: JobDefaults
  readonly variant?: 'primary' | 'secondary' | 'ghost'
  readonly iconOnly?: boolean
}) {
  const session = await requireSession()
  const editing = Boolean(defaults?.id)
  if (!can(session, editing ? 'job.update' : 'job.book')) return null

  const [options, t, tc, tMode, tDirection, tJob] = await Promise.all([
    loadOptions(session.actor),
    getTranslations('jobForm'),
    getTranslations('common'),
    getTranslations('mode'),
    getTranslations('direction'),
    getTranslations('job'),
  ])

  const defaultBranch = defaults?.branchId ?? [...session.branchRoles.keys()][0]

  const fields: FieldSpec[] = [
    ...(editing ? [{ kind: 'hidden' as const, name: 'jobId', value: defaults!.id! }] : []),

    {
      kind: 'section',
      title: t('sections.who'),
      hint: t('sections.whoHint'),
      fields: [
        {
          kind: 'select',
          name: 'branchId',
          label: t('branch'),
          span: 4,
          required: true,
          options: options.branches,
          defaultValue: defaultBranch,
        },
        {
          kind: 'select',
          name: 'customerId',
          label: t('customer'),
          span: 4,
          required: true,
          options: options.customers,
          placeholder: tc('choose'),
          defaultValue: defaults?.customerId,
        },
        {
          kind: 'select',
          name: 'ownerId',
          label: t('owner'),
          span: 4,
          hint: t('ownerHint'),
          options: options.people,
          placeholder: tc('choose'),
          defaultValue: defaults?.ownerId,
        },
        {
          kind: 'text',
          name: 'customerReference',
          label: t('customerReference'),
          span: 6,
          hint: t('customerReferenceHint'),
          mono: true,
          defaultValue: defaults?.customerReference,
        },
        {
          kind: 'select',
          name: 'status',
          label: tc('status'),
          span: 6,
          required: true,
          hint: t('statusHint'),
          options: STATUSES.map((key) => ({
            value: key,
            label: tJob(`statuses.${key}` as 'statuses.booked'),
          })),
          defaultValue: defaults?.status ?? 'booked',
        },
      ],
    },

    {
      kind: 'section',
      title: t('sections.what'),
      fields: [
        {
          kind: 'choices',
          name: 'mode',
          label: t('mode'),
          span: 12,
          required: true,
          options: MODES.map((mode) => ({
            value: mode,
            label: tMode(mode),
            icon: MODE_ICON[mode],
          })),
          defaultValue: defaults?.mode ?? 'sea_fcl',
        },
        {
          kind: 'choices',
          name: 'tradeDirection',
          label: t('direction'),
          span: 12,
          required: true,
          options: DIRECTIONS.map((key) => ({ value: key, label: tDirection(key) })),
          defaultValue: defaults?.tradeDirection ?? 'import',
        },
        {
          kind: 'select',
          name: 'originId',
          label: t('origin'),
          span: 4,
          required: true,
          options: options.locations,
          placeholder: tc('choose'),
          defaultValue: defaults?.originId,
        },
        {
          kind: 'select',
          name: 'destinationId',
          label: t('destination'),
          span: 4,
          required: true,
          options: options.locations,
          placeholder: tc('choose'),
          defaultValue: defaults?.destinationId,
        },
        {
          kind: 'select',
          name: 'commodityId',
          label: t('commodity'),
          span: 4,
          options: options.commodities,
          placeholder: tc('choose'),
          defaultValue: defaults?.commodityId,
        },
        {
          kind: 'select',
          name: 'incoterm',
          label: t('incoterm'),
          span: 4,
          hint: t('incotermHint'),
          options: options.incoterms,
          placeholder: tc('choose'),
          defaultValue: defaults?.incoterm,
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
          name: 'bookingNumber',
          label: t('bookingNumber'),
          span: 4,
          mono: true,
          defaultValue: defaults?.bookingNumber,
        },
        {
          kind: 'text',
          name: 'masterBillNumber',
          label: t('masterBill'),
          span: 4,
          mono: true,
          hint: t('masterBillHint'),
          defaultValue: defaults?.masterBillNumber,
        },
        {
          kind: 'text',
          name: 'houseBillNumber',
          label: t('houseBill'),
          span: 4,
          mono: true,
          hint: t('houseBillHint'),
          defaultValue: defaults?.houseBillNumber,
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
          hint: t('flightHint'),
          defaultValue: defaults?.flightNumber,
        },
        {
          kind: 'datetime-local',
          name: 'etd',
          label: t('etd'),
          span: 6,
          hint: t('etdHint'),
          defaultValue: defaults?.etd,
        },
        {
          kind: 'datetime-local',
          name: 'eta',
          label: t('eta'),
          span: 6,
          hint: t('etaHint'),
          defaultValue: defaults?.eta,
        },
      ],
    },

    {
      kind: 'section',
      title: t('sections.cargo'),
      fields: [
        {
          kind: 'number',
          name: 'grossWeightKg',
          label: t('weight'),
          span: 4,
          min: 0,
          step: '0.001',
          suffix: 'kg',
          defaultValue: defaults?.grossWeightKg,
        },
        {
          kind: 'number',
          name: 'volumeCbm',
          label: t('volume'),
          span: 4,
          min: 0,
          step: '0.001',
          suffix: 'cbm',
          defaultValue: defaults?.volumeCbm,
        },
        {
          kind: 'number',
          name: 'pieces',
          label: t('pieces'),
          span: 4,
          min: 0,
          defaultValue: defaults?.pieces,
        },
      ],
    },

    ...(editing
      ? []
      : [{ kind: 'note' as const, text: t('milestoneNote') }]),
  ]

  return (
    <RecordDialog
      action={saveJob}
      fields={fields}
      icon="jobs"
      size="xl"
      variant={variant}
      iconOnly={iconOnly}
      submitIcon={editing ? 'check' : 'plus'}
      labels={{
        open: editing ? tc('edit') : t('open'),
        title: editing ? t('editTitle') : t('title'),
        description: editing ? t('editDescription') : t('description'),
        submit: editing ? tc('save') : t('submit'),
        submitting: tc('saving'),
        cancel: tc('cancel'),
      }}
    />
  )
}
