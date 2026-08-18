/**
 * The two forms a document needs behind it.
 *
 * Neither existed, and neither is exotic: a bill of lading names a shipper and
 * a consignee, and a packing list lists what is in each carton. What made them
 * missing was the assumption that `jobs.customer_id` answered the first and
 * `commodities` the second. Neither does — the shipper is frequently not our
 * customer, and a commodity code classifies cargo rather than describing it.
 *
 * Both are deliberately plain. The party form is an address block because an
 * address is a block; the cargo form puts marks and numbers in a textarea
 * because the line breaks in them match what is stencilled on the carton.
 */

import { getTranslations } from 'next-intl/server'
import { requireSession } from '@/lib/session'
import { can } from '@/lib/permissions'
import { RecordDialog, type FieldSpec } from '@/ui/record-dialog'
import { saveCargoLine, saveJobParty } from '../form-actions'

const ROLES = [
  'shipper',
  'consignee',
  'notify',
  'second_notify',
  'delivery_agent',
  'forwarding_agent',
] as const

export interface PartyDefaults {
  readonly id?: string
  readonly role?: string
  readonly nameEn?: string
  readonly nameAr?: string | null
  readonly address?: string | null
  readonly city?: string | null
  readonly country?: string | null
  readonly contactName?: string | null
  readonly phone?: string | null
  readonly email?: string | null
  readonly taxId?: string | null
}

export async function PartyDialog({
  jobId,
  defaults,
  variant = 'secondary',
  iconOnly = false,
}: {
  readonly jobId: string
  readonly defaults?: PartyDefaults
  readonly variant?: 'primary' | 'secondary' | 'ghost'
  readonly iconOnly?: boolean
}) {
  const session = await requireSession()
  if (!can(session, 'job.update')) return null

  const [t, tc] = await Promise.all([getTranslations('parties'), getTranslations('common')])
  const editing = Boolean(defaults?.id)

  const fields: FieldSpec[] = [
    { kind: 'hidden', name: 'jobId', value: jobId },
    ...(editing ? [{ kind: 'hidden' as const, name: 'partyId', value: defaults!.id! }] : []),
    {
      kind: 'choices',
      name: 'role',
      label: t('role'),
      span: 12,
      required: true,
      options: ROLES.map((role) => ({ value: role, label: t(`roles.${role}` as 'roles.shipper') })),
      defaultValue: defaults?.role ?? 'shipper',
    },
    {
      kind: 'text',
      name: 'nameEn',
      label: t('name'),
      span: 6,
      required: true,
      hint: t('nameHint'),
      defaultValue: defaults?.nameEn,
    },
    {
      kind: 'text',
      name: 'nameAr',
      label: t('nameAr'),
      span: 6,
      defaultValue: defaults?.nameAr,
    },
    {
      kind: 'textarea',
      name: 'address',
      label: t('address'),
      span: 12,
      rows: 3,
      hint: t('addressHint'),
      defaultValue: defaults?.address,
    },
    { kind: 'text', name: 'city', label: t('city'), span: 6, defaultValue: defaults?.city },
    {
      kind: 'text',
      name: 'country',
      label: t('country'),
      span: 6,
      maxLength: 2,
      mono: true,
      hint: t('countryHint'),
      defaultValue: defaults?.country,
    },
    {
      kind: 'text',
      name: 'contactName',
      label: t('contact'),
      span: 4,
      defaultValue: defaults?.contactName,
    },
    { kind: 'tel', name: 'phone', label: t('phone'), span: 4, defaultValue: defaults?.phone },
    { kind: 'email', name: 'email', label: t('email'), span: 4, defaultValue: defaults?.email },
    {
      kind: 'text',
      name: 'taxId',
      label: t('taxId'),
      span: 6,
      mono: true,
      hint: t('taxIdHint'),
      defaultValue: defaults?.taxId,
    },
  ]

  return (
    <RecordDialog
      action={saveJobParty}
      fields={fields}
      icon="partners"
      variant={variant}
      iconOnly={iconOnly}
      labels={{
        open: editing ? tc('edit') : t('add'),
        title: editing ? t('editTitle') : t('addTitle'),
        description: t('description'),
        submit: tc('save'),
        submitting: tc('saving'),
        cancel: tc('cancel'),
      }}
    />
  )
}

export interface CargoDefaults {
  readonly id?: string
  readonly marksAndNumbers?: string | null
  readonly packageCount?: number | null
  readonly packageType?: string | null
  readonly descriptionEn?: string
  readonly descriptionAr?: string | null
  readonly hsCode?: string | null
  readonly grossWeightKg?: string | null
  readonly netWeightKg?: string | null
  readonly volumeCbm?: string | null
  readonly equipmentId?: string | null
}

export async function CargoDialog({
  jobId,
  containers = [],
  defaults,
  variant = 'secondary',
  iconOnly = false,
}: {
  readonly jobId: string
  readonly containers?: readonly { value: string; label: string }[]
  readonly defaults?: CargoDefaults
  readonly variant?: 'primary' | 'secondary' | 'ghost'
  readonly iconOnly?: boolean
}) {
  const session = await requireSession()
  if (!can(session, 'job.update')) return null

  const [t, tc] = await Promise.all([getTranslations('cargo'), getTranslations('common')])
  const editing = Boolean(defaults?.id)

  const fields: FieldSpec[] = [
    { kind: 'hidden', name: 'jobId', value: jobId },
    ...(editing ? [{ kind: 'hidden' as const, name: 'cargoId', value: defaults!.id! }] : []),
    {
      kind: 'textarea',
      name: 'descriptionEn',
      label: t('description'),
      span: 12,
      rows: 2,
      required: true,
      hint: t('descriptionHint'),
      defaultValue: defaults?.descriptionEn,
    },
    {
      kind: 'textarea',
      name: 'descriptionAr',
      label: t('descriptionAr'),
      span: 12,
      rows: 2,
      defaultValue: defaults?.descriptionAr,
    },
    {
      kind: 'textarea',
      name: 'marksAndNumbers',
      label: t('marks'),
      span: 12,
      rows: 3,
      hint: t('marksHint'),
      defaultValue: defaults?.marksAndNumbers,
    },
    {
      kind: 'number',
      name: 'packageCount',
      label: t('packages'),
      span: 4,
      min: 1,
      defaultValue: defaults?.packageCount,
    },
    {
      kind: 'text',
      name: 'packageType',
      label: t('packageType'),
      span: 4,
      hint: t('packageTypeHint'),
      defaultValue: defaults?.packageType,
    },
    {
      kind: 'text',
      name: 'hsCode',
      label: t('hsCode'),
      span: 4,
      mono: true,
      hint: t('hsCodeHint'),
      defaultValue: defaults?.hsCode,
    },
    {
      kind: 'text',
      name: 'grossWeightKg',
      label: t('gross'),
      span: 4,
      mono: true,
      suffix: 'kg',
      defaultValue: defaults?.grossWeightKg,
    },
    {
      kind: 'text',
      name: 'netWeightKg',
      label: t('net'),
      span: 4,
      mono: true,
      suffix: 'kg',
      hint: t('netHint'),
      defaultValue: defaults?.netWeightKg,
    },
    {
      kind: 'text',
      name: 'volumeCbm',
      label: t('volume'),
      span: 4,
      mono: true,
      suffix: 'cbm',
      defaultValue: defaults?.volumeCbm,
    },
    ...(containers.length > 0
      ? ([
          {
            kind: 'select',
            name: 'equipmentId',
            label: t('container'),
            span: 12,
            options: containers,
            placeholder: t('containerNone'),
            hint: t('containerHint'),
            defaultValue: defaults?.equipmentId,
          },
        ] satisfies FieldSpec[])
      : []),
  ]

  return (
    <RecordDialog
      action={saveCargoLine}
      fields={fields}
      icon="container"
      variant={variant}
      iconOnly={iconOnly}
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
