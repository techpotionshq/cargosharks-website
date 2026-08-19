/**
 * Network dialogs — partners and places.
 *
 * Server components that build a `FieldSpec[]` and hand it to `RecordDialog`.
 * The options, the permission check and the translations all live on the
 * server, where they already are; what crosses to the browser is plain JSON.
 *
 * The permission gate is here rather than inside the dialog on purpose: an
 * operator who cannot create a partner should not be shown a button that fails
 * when they press it. The server action re-checks it regardless — a hidden
 * control is a courtesy, never a boundary.
 */

import { getTranslations } from 'next-intl/server'
import { requireSession } from '@/lib/session'
import { can } from '@/lib/permissions'
import { loadOptions } from '@/lib/options'
import { RecordDialog, type FieldSpec } from '@/ui/record-dialog'
import { savePartner, saveLocation } from '../form-actions'

const PARTNER_TYPES = ['carrier', 'agent', 'broker', 'haulier', 'terminal'] as const
const PLACE_KINDS = ['seaport', 'airport', 'inland', 'border', 'depot', 'warehouse'] as const

export interface PartnerDefaults {
  readonly id?: string
  readonly code?: string
  readonly type?: string
  readonly legalNameEn?: string
  readonly legalNameAr?: string | null
  readonly countryCode?: string | null
  readonly currency?: string | null
  readonly paymentTermsDays?: number | null
  readonly scac?: string | null
  readonly isActive?: boolean
}

export async function PartnerDialog({
  defaults,
  variant = 'primary',
  iconOnly = false,
}: {
  readonly defaults?: PartnerDefaults
  readonly variant?: 'primary' | 'secondary' | 'ghost'
  readonly iconOnly?: boolean
}) {
  const session = await requireSession()
  if (!can(session, 'partner.write')) return null

  const [options, t, tc] = await Promise.all([
    loadOptions(session.actor),
    getTranslations('partnerForm'),
    getTranslations('common'),
  ])

  const editing = Boolean(defaults?.id)

  const fields: FieldSpec[] = [
    ...(editing ? [{ kind: 'hidden' as const, name: 'partnerId', value: defaults!.id! }] : []),
    {
      kind: 'text',
      name: 'code',
      label: t('code'),
      span: 4,
      required: true,
      hint: t('codeHint'),
      mono: true,
      maxLength: 16,
      defaultValue: defaults?.code,
    },
    {
      kind: 'select',
      name: 'type',
      label: t('type'),
      span: 4,
      required: true,
      hint: t('typeHint'),
      options: PARTNER_TYPES.map((type) => ({ value: type, label: t(`types.${type}`) })),
      defaultValue: defaults?.type ?? 'carrier',
    },
    {
      kind: 'select',
      name: 'countryCode',
      label: t('country'),
      span: 4,
      options: options.countries,
      placeholder: tc('none'),
      defaultValue: defaults?.countryCode,
    },
    {
      kind: 'text',
      name: 'legalNameEn',
      label: t('legalNameEn'),
      span: 6,
      required: true,
      defaultValue: defaults?.legalNameEn,
    },
    {
      kind: 'text',
      name: 'legalNameAr',
      label: t('legalNameAr'),
      span: 6,
      hint: t('legalNameArHint'),
      defaultValue: defaults?.legalNameAr,
    },
    {
      kind: 'select',
      name: 'currency',
      label: t('currency'),
      span: 4,
      hint: t('currencyHint'),
      options: options.currencies,
      placeholder: tc('none'),
      defaultValue: defaults?.currency,
    },
    {
      kind: 'number',
      name: 'paymentTermsDays',
      label: t('paymentTerms'),
      span: 4,
      min: 0,
      max: 365,
      suffix: t('days'),
      hint: t('paymentTermsHint'),
      defaultValue: defaults?.paymentTermsDays,
    },
    /*
      Shown for every partner type rather than only for carriers.

      A form field that appears and disappears as the type select changes is a
      field an operator learns not to trust, and a freight forwarder that is
      also an NVOCC holds its own SCAC. Blank is the honest default and costs
      nothing.
    */
    {
      kind: 'text',
      name: 'scac',
      label: t('scac'),
      span: 4,
      mono: true,
      maxLength: 4,
      hint: t('scacHint'),
      defaultValue: defaults?.scac,
    },
    {
      kind: 'switch',
      name: 'isActive',
      label: t('active'),
      span: 12,
      hint: t('activeHint'),
      defaultChecked: defaults?.isActive ?? true,
    },
  ]

  return (
    <RecordDialog
      action={savePartner}
      fields={fields}
      icon="partners"
      size="lg"
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

export interface LocationDefaults {
  readonly id?: string
  readonly unlocode?: string | null
  readonly nameEn?: string
  readonly nameAr?: string | null
  readonly countryCode?: string | null
  readonly kind?: string
  readonly isActive?: boolean
}

export async function LocationDialog({
  defaults,
  variant = 'primary',
  iconOnly = false,
}: {
  readonly defaults?: LocationDefaults
  readonly variant?: 'primary' | 'secondary' | 'ghost'
  readonly iconOnly?: boolean
}) {
  const session = await requireSession()
  if (!can(session, 'admin.reference.write')) return null

  const [options, t, tc] = await Promise.all([
    loadOptions(session.actor),
    getTranslations('locationForm'),
    getTranslations('common'),
  ])

  const editing = Boolean(defaults?.id)

  const fields: FieldSpec[] = [
    ...(editing ? [{ kind: 'hidden' as const, name: 'locationId', value: defaults!.id! }] : []),
    {
      kind: 'text',
      name: 'unlocode',
      label: t('unlocode'),
      span: 4,
      hint: t('unlocodeHint'),
      mono: true,
      maxLength: 5,
      placeholder: 'KWSWK',
      defaultValue: defaults?.unlocode,
    },
    {
      kind: 'select',
      name: 'kind',
      label: t('kind'),
      span: 4,
      required: true,
      options: PLACE_KINDS.map((kind) => ({ value: kind, label: t(`kinds.${kind}`) })),
      defaultValue: defaults?.kind ?? 'seaport',
    },
    {
      kind: 'select',
      name: 'countryCode',
      label: t('country'),
      span: 4,
      required: true,
      options: options.countries,
      placeholder: tc('choose'),
      defaultValue: defaults?.countryCode,
    },
    {
      kind: 'text',
      name: 'nameEn',
      label: t('nameEn'),
      span: 6,
      required: true,
      defaultValue: defaults?.nameEn,
    },
    {
      kind: 'text',
      name: 'nameAr',
      label: t('nameAr'),
      span: 6,
      hint: t('nameArHint'),
      defaultValue: defaults?.nameAr,
    },
    {
      kind: 'switch',
      name: 'isActive',
      label: t('active'),
      span: 12,
      hint: t('activeHint'),
      defaultChecked: defaults?.isActive ?? true,
    },
  ]

  return (
    <RecordDialog
      action={saveLocation}
      fields={fields}
      icon="locations"
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
