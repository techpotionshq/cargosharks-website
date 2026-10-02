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

import { getLocale, getTranslations } from 'next-intl/server'
import { requireSession } from '@/lib/session'
import { can } from '@/lib/permissions'
import { loadOptions } from '@/lib/options'
import { RecordDialog, type FieldSpec } from '@/ui/record-dialog'
import {
  saveLocation,
  savePartner,
  savePartnerCompliance,
  savePartnerContact,
  savePartnerCoverage,
  setNetworkActive,
} from '../form-actions'

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
    getLocale().then((locale) => loadOptions(session.actor, locale === 'ar' ? 'ar' : 'en')),
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
    getLocale().then((locale) => loadOptions(session.actor, locale === 'ar' ? 'ar' : 'en')),
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

/**
 * Retiring a partner or a location, and bringing one back.
 *
 * A dialog rather than a toggle, because the two directions are not
 * symmetrical: reactivating restores a row somebody expects to see, and
 * retiring removes a name from every picker in the product. A stray click on
 * a table row should not do the second one.
 *
 * This is what `is_active` is *for*. `DELETE` is revoked from `app_user` and a
 * partner has settlements and a location has jobs pointing at it, so there is
 * no version of "remove it" that is not this (§5.5). The list still shows the
 * row, marked, which is the behaviour an operator wanting it back depends on.
 */
export async function RetireNetworkDialog({
  kind,
  id,
  name,
  isActive,
}: {
  readonly kind: 'partner' | 'location'
  readonly id: string
  readonly name: string
  /** Current state. The dialog offers the opposite of it. */
  readonly isActive: boolean
}) {
  const session = await requireSession()
  if (!can(session, kind === 'partner' ? 'partner.write' : 'admin.reference.write')) return null

  const [t, tc] = await Promise.all([getTranslations('network'), getTranslations('common')])

  const fields: FieldSpec[] = [
    { kind: 'hidden', name: 'kind', value: kind },
    { kind: 'hidden', name: 'id', value: id },
    /*
      Presence is the signal, not the value — `setNetworkActive` reads
      `form.get('isActive') !== null`, the checkbox convention every form in
      this application follows. Reactivating sends the field; retiring omits
      it entirely.
    */
    ...(isActive ? [] : [{ kind: 'hidden' as const, name: 'isActive', value: 'true' }]),
    {
      kind: 'note',
      text: isActive ? t('retireWarning') : t('restoreNote'),
      tone: isActive ? 'caution' : 'info',
    },
  ]

  return (
    <RecordDialog
      action={setNetworkActive}
      fields={fields}
      icon={isActive ? 'hold' : 'check'}
      variant="ghost"
      iconOnly
      submitIcon={isActive ? 'hold' : 'check'}
      labels={{
        open: isActive ? t('retire') : t('restore'),
        title: isActive ? t('retireTitle', { name }) : t('restoreTitle', { name }),
        description: isActive ? t('retireDescription') : t('restoreDescription'),
        submit: isActive ? t('retire') : t('restore'),
        submitting: tc('saving'),
        cancel: tc('cancel'),
      }}
    />
  )
}

/** A person at the agent — FR-MD-04. */
export async function PartnerContactDialog({
  partnerId,
  defaults,
  variant = 'ghost',
}: {
  readonly partnerId: string
  readonly defaults?: {
    readonly id?: string
    readonly nameEn?: string
    readonly nameAr?: string | null
    readonly email?: string | null
    readonly phone?: string | null
    readonly role?: string | null
    readonly isPrimary?: boolean
    readonly isActive?: boolean
  }
  readonly variant?: 'primary' | 'secondary' | 'ghost'
}) {
  const session = await requireSession()
  if (!can(session, 'partner.write')) return null

  const [t, tc] = await Promise.all([
    getTranslations('partnerContactForm'),
    getTranslations('common'),
  ])

  const fields: FieldSpec[] = [
    { kind: 'hidden', name: 'partnerId', value: partnerId },
    ...(defaults?.id ? [{ kind: 'hidden' as const, name: 'contactId', value: defaults.id }] : []),
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
      defaultValue: defaults?.nameAr ?? undefined,
    },
    {
      kind: 'text',
      name: 'role',
      label: t('role'),
      span: 12,
      hint: t('roleHint'),
      defaultValue: defaults?.role ?? undefined,
    },
    {
      kind: 'email',
      name: 'email',
      label: t('email'),
      span: 6,
      defaultValue: defaults?.email ?? undefined,
    },
    {
      kind: 'tel',
      name: 'phone',
      label: t('phone'),
      span: 6,
      mono: true,
      defaultValue: defaults?.phone ?? undefined,
    },
    {
      kind: 'switch',
      name: 'isPrimary',
      label: t('isPrimary'),
      span: 6,
      // Setting it demotes whoever held it — see the action.
      hint: t('isPrimaryHint'),
      defaultChecked: defaults?.isPrimary ?? false,
    },
    {
      kind: 'switch',
      name: 'isActive',
      label: tc('active'),
      span: 6,
      defaultChecked: defaults?.isActive ?? true,
    },
  ]

  return (
    <RecordDialog
      action={savePartnerContact}
      fields={fields}
      icon="users"
      variant={variant}
      iconOnly={Boolean(defaults?.id)}
      labels={{
        open: defaults?.id ? tc('edit') : t('open'),
        title: t('title'),
        description: t('description'),
        submit: tc('save'),
        submitting: tc('saving'),
        cancel: tc('cancel'),
      }}
    />
  )
}

/** A lane this partner covers — what RFQ routing reads (FR-RT-10). */
export async function PartnerCoverageDialog({
  partnerId,
  variant = 'ghost',
}: {
  readonly partnerId: string
  readonly variant?: 'primary' | 'secondary' | 'ghost'
}) {
  const session = await requireSession()
  if (!can(session, 'partner.write')) return null

  const [options, t, tc, tMode] = await Promise.all([
    getLocale().then((locale) => loadOptions(session.actor, locale === 'ar' ? 'ar' : 'en')),
    getTranslations('partnerCoverageForm'),
    getTranslations('common'),
    getTranslations('mode'),
  ])

  const fields: FieldSpec[] = [
    { kind: 'hidden', name: 'partnerId', value: partnerId },
    {
      kind: 'select',
      name: 'mode',
      label: t('mode'),
      span: 6,
      required: true,
      options: (['sea_fcl', 'sea_lcl', 'air', 'land', 'courier'] as const).map((m) => ({
        value: m,
        label: tMode(m as 'air'),
      })),
      defaultValue: 'sea_fcl',
    },
    {
      kind: 'number',
      name: 'transitDays',
      label: t('transitDays'),
      span: 6,
      hint: t('transitDaysHint'),
    },
    /*
      A port where they name one, a country where they do not.

      An agent who says "anywhere in India" is a country row; one who quotes
      Nhava Sheva only is a port row. Both ends may be either, and the action
      refuses a row that names neither — that would route every enquiry in the
      system to this agent.
    */
    {
      kind: 'select',
      name: 'originId',
      label: t('originPort'),
      span: 6,
      options: options.locations,
      placeholder: t('anyPort'),
    },
    {
      kind: 'select',
      name: 'destinationId',
      label: t('destinationPort'),
      span: 6,
      options: options.locations,
      placeholder: t('anyPort'),
    },
    {
      kind: 'text',
      name: 'originCountry',
      label: t('originCountry'),
      span: 6,
      mono: true,
      hint: t('countryHint'),
    },
    {
      kind: 'text',
      name: 'destinationCountry',
      label: t('destinationCountry'),
      span: 6,
      mono: true,
    },
    { kind: 'switch', name: 'isActive', label: tc('active'), span: 12, defaultChecked: true },
  ]

  return (
    <RecordDialog
      action={savePartnerCoverage}
      fields={fields}
      icon="globe"
      variant={variant}
      labels={{
        open: t('open'),
        title: t('title'),
        description: t('description'),
        submit: tc('save'),
        submitting: tc('saving'),
        cancel: tc('cancel'),
      }}
    />
  )
}

/** A licence or certificate, with the date it lapses — FR-MD-05. */
export async function PartnerComplianceDialog({
  partnerId,
  supersedes,
  variant = 'ghost',
}: {
  readonly partnerId: string
  /** Offered when renewing: the old row points forward and stays (§5.5). */
  readonly supersedes?: readonly { value: string; label: string }[]
  readonly variant?: 'primary' | 'secondary' | 'ghost'
}) {
  const session = await requireSession()
  if (!can(session, 'partner.write')) return null

  const [options, t, tc] = await Promise.all([
    getLocale().then((locale) => loadOptions(session.actor, locale === 'ar' ? 'ar' : 'en')),
    getTranslations('partnerComplianceForm'),
    getTranslations('common'),
  ])

  const fields: FieldSpec[] = [
    { kind: 'hidden', name: 'partnerId', value: partnerId },
    {
      kind: 'select',
      name: 'documentTypeId',
      label: t('documentType'),
      span: 12,
      required: true,
      options: options.documentTypes,
      placeholder: tc('choose'),
    },
    { kind: 'text', name: 'reference', label: t('reference'), span: 12, mono: true },
    { kind: 'date', name: 'issuedOn', label: t('issuedOn'), span: 6 },
    {
      kind: 'date',
      name: 'expiresOn',
      label: t('expiresOn'),
      span: 6,
      hint: t('expiresOnHint'),
    },
    ...(supersedes && supersedes.length > 0
      ? [
          {
            kind: 'select' as const,
            name: 'supersedesId',
            label: t('supersedes'),
            span: 12 as const,
            options: supersedes,
            placeholder: t('newDocument'),
            hint: t('supersedesHint'),
          },
        ]
      : []),
  ]

  return (
    <RecordDialog
      action={savePartnerCompliance}
      fields={fields}
      icon="document"
      variant={variant}
      labels={{
        open: t('open'),
        title: t('title'),
        description: t('description'),
        submit: tc('save'),
        submitting: tc('saving'),
        cancel: tc('cancel'),
      }}
    />
  )
}
