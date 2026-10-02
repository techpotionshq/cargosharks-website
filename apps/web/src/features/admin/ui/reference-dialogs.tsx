/**
 * The configuration forms the four-column reference dialog cannot hold.
 *
 * Separate from `dialogs.tsx` because these are a different kind of thing: a
 * charge type is a name and a code, and these three carry the rules the
 * engines read — what steps a job gets, which days are working days, and what
 * a tariff line charges. Each was named in `CLAUDE.md` as an administrator's
 * edit and each was seed-only until now.
 */

import { getLocale, getTranslations } from 'next-intl/server'
import { todayIn } from '@qabandi/core'
import { requireSession } from '@/lib/session'
import { can } from '@/lib/permissions'
import { loadOptions } from '@/lib/options'
import { RecordDialog, type FieldSpec } from '@/ui/record-dialog'
import {
  saveChargeableRule,
  saveDutyRate,
  saveFreeTimeRule,
  saveFxRate,
  saveHoliday,
  saveMilestoneTemplate,
  saveWorkingCalendar,
} from '../reference-actions'

const MODES = ['sea_fcl', 'sea_lcl', 'air', 'land', 'courier'] as const
const DIRECTIONS = ['import', 'export', 'cross_trade'] as const

export interface MilestoneDefaults {
  readonly id?: string
  readonly mode?: string
  readonly direction?: string
  readonly seq?: number
  readonly code?: string
  readonly nameEn?: string
  readonly nameAr?: string
  readonly ownerRole?: string | null
  readonly plannedOffsetDays?: number | null
  readonly customerVisible?: boolean
  readonly isActive?: boolean
}

export async function MilestoneTemplateDialog({
  defaults,
  variant = 'secondary',
}: {
  readonly defaults?: MilestoneDefaults
  readonly variant?: 'primary' | 'secondary' | 'ghost'
}) {
  const session = await requireSession()
  if (!can(session, 'admin.reference.write')) return null

  const [t, tc, tMode] = await Promise.all([
    getTranslations('milestoneForm'),
    getTranslations('common'),
    getTranslations('mode'),
  ])

  const fields: FieldSpec[] = [
    ...(defaults?.id ? [{ kind: 'hidden' as const, name: 'templateId', value: defaults.id }] : []),
    {
      kind: 'select',
      name: 'mode',
      label: t('mode'),
      span: 4,
      required: true,
      options: MODES.map((m) => ({ value: m, label: tMode(m as 'air') })),
      defaultValue: defaults?.mode ?? 'sea_fcl',
    },
    {
      kind: 'select',
      name: 'direction',
      label: t('direction'),
      span: 4,
      required: true,
      options: DIRECTIONS.map((d) => ({
        value: d,
        label: t(`directions.${d}` as 'directions.import'),
      })),
      defaultValue: defaults?.direction ?? 'import',
    },
    {
      kind: 'number',
      name: 'seq',
      label: t('seq'),
      span: 4,
      required: true,
      hint: t('seqHint'),
      defaultValue: defaults?.seq?.toString(),
    },
    {
      kind: 'text',
      name: 'code',
      label: t('code'),
      span: 4,
      required: true,
      mono: true,
      hint: t('codeHint'),
      defaultValue: defaults?.code,
    },
    {
      kind: 'text',
      name: 'nameEn',
      label: t('nameEn'),
      span: 4,
      required: true,
      defaultValue: defaults?.nameEn,
    },
    {
      kind: 'text',
      name: 'nameAr',
      label: t('nameAr'),
      span: 4,
      required: true,
      hint: t('nameArHint'),
      defaultValue: defaults?.nameAr,
    },
    {
      kind: 'text',
      name: 'ownerRole',
      label: t('ownerRole'),
      span: 6,
      hint: t('ownerRoleHint'),
      defaultValue: defaults?.ownerRole ?? undefined,
    },
    {
      kind: 'number',
      name: 'plannedOffsetDays',
      label: t('offsetDays'),
      span: 6,
      hint: t('offsetDaysHint'),
      defaultValue: defaults?.plannedOffsetDays?.toString(),
    },
    {
      kind: 'switch',
      name: 'customerVisible',
      label: t('customerVisible'),
      span: 6,
      hint: t('customerVisibleHint'),
      defaultChecked: defaults?.customerVisible ?? true,
    },
    {
      kind: 'switch',
      name: 'isActive',
      label: tc('active'),
      span: 6,
      defaultChecked: defaults?.isActive ?? true,
    },
    // Editing changes what the *next* job gets — see the action.
    { kind: 'note', text: t('appliesToNew'), tone: 'info' },
  ]

  return (
    <RecordDialog
      action={saveMilestoneTemplate}
      fields={fields}
      icon="tracking"
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

export interface CalendarDefaults {
  readonly id?: string
  readonly key?: string
  readonly nameEn?: string
  readonly nameAr?: string
  readonly timeZone?: string
  readonly weekend?: number[]
  readonly dayStartMinute?: number
  readonly dayEndMinute?: number
  readonly isActive?: boolean
}

export async function WorkingCalendarDialog({
  defaults,
  variant = 'secondary',
}: {
  readonly defaults?: CalendarDefaults
  readonly variant?: 'primary' | 'secondary' | 'ghost'
}) {
  const session = await requireSession()
  if (!can(session, 'admin.reference.write')) return null

  const [t, tc] = await Promise.all([getTranslations('calendarForm'), getTranslations('common')])

  const fields: FieldSpec[] = [
    ...(defaults?.id ? [{ kind: 'hidden' as const, name: 'calendarId', value: defaults.id }] : []),
    {
      kind: 'text',
      name: 'key',
      label: t('key'),
      span: 4,
      required: true,
      mono: true,
      defaultValue: defaults?.key,
    },
    {
      kind: 'text',
      name: 'nameEn',
      label: t('nameEn'),
      span: 4,
      required: true,
      defaultValue: defaults?.nameEn,
    },
    {
      kind: 'text',
      name: 'nameAr',
      label: t('nameAr'),
      span: 4,
      required: true,
      defaultValue: defaults?.nameAr,
    },
    {
      kind: 'text',
      name: 'timeZone',
      label: t('timeZone'),
      span: 6,
      required: true,
      mono: true,
      hint: t('timeZoneHint'),
      defaultValue: defaults?.timeZone ?? 'Asia/Kuwait',
    },
    {
      kind: 'text',
      name: 'weekend',
      label: t('weekend'),
      span: 6,
      required: true,
      mono: true,
      // Numbers rather than names: the column is `int[]`, and a picker over
      // seven checkboxes for a field edited once a year is a worse trade.
      hint: t('weekendHint'),
      defaultValue: (defaults?.weekend ?? [5, 6]).join(','),
    },
    {
      kind: 'number',
      name: 'dayStartMinute',
      label: t('dayStart'),
      span: 6,
      required: true,
      hint: t('minutesHint'),
      defaultValue: (defaults?.dayStartMinute ?? 480).toString(),
    },
    {
      kind: 'number',
      name: 'dayEndMinute',
      label: t('dayEnd'),
      span: 6,
      required: true,
      defaultValue: (defaults?.dayEndMinute ?? 1020).toString(),
    },
    {
      kind: 'switch',
      name: 'isActive',
      label: tc('active'),
      span: 12,
      defaultChecked: defaults?.isActive ?? true,
    },
  ]

  return (
    <RecordDialog
      action={saveWorkingCalendar}
      fields={fields}
      icon="calendar"
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

/** A dated closure. Eid moves; a recurrence rule would be a lunar calendar. */
export async function HolidayDialog({
  calendars,
  variant = 'ghost',
}: {
  readonly calendars: readonly { value: string; label: string }[]
  readonly variant?: 'primary' | 'secondary' | 'ghost'
}) {
  const session = await requireSession()
  if (!can(session, 'admin.reference.write')) return null

  const [t, tc] = await Promise.all([getTranslations('holidayForm'), getTranslations('common')])

  const fields: FieldSpec[] = [
    {
      kind: 'select',
      name: 'calendarId',
      label: t('calendar'),
      span: 12,
      required: true,
      options: calendars,
      placeholder: tc('choose'),
    },
    { kind: 'date', name: 'onDate', label: t('onDate'), span: 6, required: true },
    { kind: 'text', name: 'nameEn', label: t('nameEn'), span: 6, required: true },
    { kind: 'text', name: 'nameAr', label: t('nameAr'), span: 12 },
    { kind: 'note', text: t('note'), tone: 'info' },
  ]

  return (
    <RecordDialog
      action={saveHoliday}
      fields={fields}
      icon="calendar"
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

export interface DutyRateDefaults {
  readonly id?: string
  readonly country?: string
  readonly hsPrefix?: string
  readonly ratePercent?: string
  readonly descriptionEn?: string
  readonly descriptionAr?: string | null
  readonly effectiveFrom?: string
  readonly effectiveTo?: string | null
  readonly notes?: string | null
  readonly isActive?: boolean
}

export async function DutyRateDialog({
  defaults,
  variant = 'secondary',
}: {
  readonly defaults?: DutyRateDefaults
  readonly variant?: 'primary' | 'secondary' | 'ghost'
}) {
  const session = await requireSession()
  if (!can(session, 'admin.reference.write')) return null

  const [options, t, tc] = await Promise.all([
    getLocale().then((locale) => loadOptions(session.actor, locale === 'ar' ? 'ar' : 'en')),
    getTranslations('dutyRateForm'),
    getTranslations('common'),
  ])

  const fields: FieldSpec[] = [
    ...(defaults?.id ? [{ kind: 'hidden' as const, name: 'rateId', value: defaults.id }] : []),
    {
      kind: 'select',
      name: 'country',
      label: t('country'),
      span: 4,
      required: true,
      options: options.countries,
      placeholder: tc('choose'),
      defaultValue: defaults?.country ?? 'KW',
    },
    {
      kind: 'text',
      name: 'hsPrefix',
      label: t('hsPrefix'),
      span: 4,
      required: true,
      mono: true,
      // Prefix, not a full code: `findRate` takes the longest matching prefix,
      // so `8703` and `87` are both legitimate rows.
      hint: t('hsPrefixHint'),
      defaultValue: defaults?.hsPrefix,
    },
    {
      kind: 'text',
      name: 'ratePercent',
      label: t('ratePercent'),
      span: 4,
      required: true,
      mono: true,
      hint: t('ratePercentHint'),
      defaultValue: defaults?.ratePercent,
    },
    {
      kind: 'text',
      name: 'descriptionEn',
      label: t('descriptionEn'),
      span: 6,
      required: true,
      defaultValue: defaults?.descriptionEn,
    },
    {
      kind: 'text',
      name: 'descriptionAr',
      label: t('descriptionAr'),
      span: 6,
      defaultValue: defaults?.descriptionAr ?? undefined,
    },
    {
      kind: 'date',
      name: 'effectiveFrom',
      label: t('effectiveFrom'),
      span: 6,
      required: true,
      hint: t('effectiveFromHint'),
      defaultValue: defaults?.effectiveFrom,
    },
    {
      kind: 'date',
      name: 'effectiveTo',
      label: t('effectiveTo'),
      span: 6,
      hint: t('effectiveToHint'),
      defaultValue: defaults?.effectiveTo ?? undefined,
    },
    {
      kind: 'text',
      name: 'notes',
      label: t('notes'),
      span: 12,
      defaultValue: defaults?.notes ?? undefined,
    },
    {
      kind: 'switch',
      name: 'isActive',
      label: tc('active'),
      span: 12,
      defaultChecked: defaults?.isActive ?? true,
    },
  ]

  return (
    <RecordDialog
      action={saveDutyRate}
      fields={fields}
      icon="customs"
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

/**
 * An exchange rate, by hand — S12.
 *
 * Pricing converts every card into the branch's base currency and refuses
 * without a rate; on an instance with no FX feed this is the only way one
 * arrives. One unit of the first currency in the second: USD → KWD 0.307.
 */
export async function FxRateDialog({
  defaults,
  variant = 'secondary',
}: {
  readonly defaults?: { fromCurrency?: string; toCurrency?: string; rate?: string }
  readonly variant?: 'primary' | 'secondary' | 'ghost'
}) {
  const session = await requireSession()
  if (!can(session, 'admin.reference.write')) return null

  const [options, t, tc] = await Promise.all([
    getLocale().then((locale) => loadOptions(session.actor, locale === 'ar' ? 'ar' : 'en')),
    getTranslations('fxRateForm'),
    getTranslations('common'),
  ])

  const fields: FieldSpec[] = [
    {
      kind: 'select',
      name: 'fromCurrency',
      label: t('from'),
      span: 6,
      required: true,
      options: options.currencies,
      placeholder: tc('choose'),
      defaultValue: defaults?.fromCurrency,
    },
    {
      kind: 'select',
      name: 'toCurrency',
      label: t('to'),
      span: 6,
      required: true,
      options: options.currencies,
      placeholder: tc('choose'),
      hint: t('toHint'),
      defaultValue: defaults?.toCurrency,
    },
    {
      kind: 'text',
      name: 'rate',
      label: t('rate'),
      span: 6,
      required: true,
      mono: true,
      hint: t('rateHint'),
      defaultValue: defaults?.rate,
    },
    {
      kind: 'date',
      name: 'effectiveOn',
      label: t('effectiveOn'),
      span: 6,
      required: true,
      hint: t('effectiveOnHint'),
      defaultValue: todayIn(),
    },
  ]

  return (
    <RecordDialog
      action={saveFxRate}
      fields={fields}
      icon="finance"
      variant={variant}
      iconOnly={Boolean(defaults)}
      labels={{
        open: defaults ? tc('edit') : t('open'),
        title: t('title'),
        description: t('description'),
        submit: tc('save'),
        submitting: tc('saving'),
        cancel: tc('cancel'),
      }}
    />
  )
}

/** The divisor a mode is billed on — air 6000, courier 5000, sea LCL 1000. */
export async function ChargeableRuleDialog({
  defaults,
  variant = 'secondary',
}: {
  readonly defaults?: {
    readonly id?: string
    readonly mode?: string
    readonly branchId?: string | null
    readonly divisorCm3PerKg?: string | null
    readonly roundUpToKg?: string
    readonly minimumKg?: string
    readonly isActive?: boolean
  }
  readonly variant?: 'primary' | 'secondary' | 'ghost'
}) {
  const session = await requireSession()
  if (!can(session, 'admin.reference.write')) return null

  const [options, t, tc, tMode] = await Promise.all([
    getLocale().then((locale) => loadOptions(session.actor, locale === 'ar' ? 'ar' : 'en')),
    getTranslations('chargeableForm'),
    getTranslations('common'),
    getTranslations('mode'),
  ])

  const fields: FieldSpec[] = [
    ...(defaults?.id ? [{ kind: 'hidden' as const, name: 'ruleId', value: defaults.id }] : []),
    {
      kind: 'select',
      name: 'mode',
      label: t('mode'),
      span: 6,
      required: true,
      options: MODES.map((m) => ({ value: m, label: tMode(m as 'air') })),
      defaultValue: defaults?.mode ?? 'air',
    },
    {
      kind: 'select',
      name: 'branchId',
      label: t('branch'),
      span: 6,
      options: options.branches,
      // A branch that negotiated its own divisor is a row, not a release.
      placeholder: t('everyBranch'),
      hint: t('branchHint'),
      defaultValue: defaults?.branchId ?? undefined,
    },
    {
      kind: 'text',
      name: 'divisorCm3PerKg',
      label: t('divisor'),
      span: 4,
      mono: true,
      hint: t('divisorHint'),
      defaultValue: defaults?.divisorCm3PerKg ?? undefined,
    },
    {
      kind: 'text',
      name: 'roundUpToKg',
      label: t('roundUp'),
      span: 4,
      required: true,
      mono: true,
      hint: t('roundUpHint'),
      defaultValue: defaults?.roundUpToKg ?? '0.5',
    },
    {
      kind: 'text',
      name: 'minimumKg',
      label: t('minimum'),
      span: 4,
      required: true,
      mono: true,
      hint: t('minimumHint'),
      defaultValue: defaults?.minimumKg ?? '0',
    },
    {
      kind: 'switch',
      name: 'isActive',
      label: tc('active'),
      span: 12,
      defaultChecked: defaults?.isActive ?? true,
    },
  ]

  return (
    <RecordDialog
      action={saveChargeableRule}
      fields={fields}
      icon="rates"
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

/** The days a branch grants before demurrage starts, and the rate after. */
export async function FreeTimeRuleDialog({
  defaults,
  variant = 'secondary',
}: {
  readonly defaults?: {
    readonly id?: string
    readonly kind?: string
    readonly branchId?: string | null
    readonly mode?: string | null
    readonly containerType?: string | null
    readonly freeDays?: number
    readonly perDiem?: string
    readonly currency?: string
    readonly dayBasis?: string
    readonly isActive?: boolean
  }
  readonly variant?: 'primary' | 'secondary' | 'ghost'
}) {
  const session = await requireSession()
  if (!can(session, 'admin.reference.write')) return null

  const [options, t, tc, tMode] = await Promise.all([
    getLocale().then((locale) => loadOptions(session.actor, locale === 'ar' ? 'ar' : 'en')),
    getTranslations('freeTimeRuleForm'),
    getTranslations('common'),
    getTranslations('mode'),
  ])

  const fields: FieldSpec[] = [
    ...(defaults?.id ? [{ kind: 'hidden' as const, name: 'ruleId', value: defaults.id }] : []),
    {
      kind: 'select',
      name: 'kind',
      label: t('kind'),
      span: 6,
      required: true,
      options: (['demurrage', 'detention', 'storage'] as const).map((k) => ({
        value: k,
        label: t(`kinds.${k}`),
      })),
      defaultValue: defaults?.kind ?? 'demurrage',
    },
    {
      kind: 'select',
      name: 'branchId',
      label: t('branch'),
      span: 6,
      options: options.branches,
      placeholder: t('everyBranch'),
      defaultValue: defaults?.branchId ?? undefined,
    },
    {
      kind: 'select',
      name: 'mode',
      label: t('mode'),
      span: 6,
      options: MODES.map((m) => ({ value: m, label: tMode(m as 'air') })),
      // Absence is how a rule widens: no mode means every mode.
      placeholder: t('everyMode'),
      hint: t('narrowHint'),
      defaultValue: defaults?.mode ?? undefined,
    },
    {
      kind: 'select',
      name: 'containerType',
      label: t('containerType'),
      span: 6,
      options: options.containerTypes,
      placeholder: t('everyContainer'),
      defaultValue: defaults?.containerType ?? undefined,
    },
    {
      kind: 'number',
      name: 'freeDays',
      label: t('freeDays'),
      span: 4,
      required: true,
      defaultValue: (defaults?.freeDays ?? 5).toString(),
    },
    {
      kind: 'text',
      name: 'perDiem',
      label: t('perDiem'),
      span: 4,
      required: true,
      mono: true,
      defaultValue: defaults?.perDiem,
    },
    {
      kind: 'text',
      name: 'currency',
      label: t('currency'),
      span: 4,
      required: true,
      mono: true,
      defaultValue: defaults?.currency ?? 'KWD',
    },
    {
      kind: 'select',
      name: 'dayBasis',
      label: t('dayBasis'),
      span: 6,
      required: true,
      options: [
        { value: 'calendar', label: t('calendar') },
        { value: 'working', label: t('working') },
      ],
      hint: t('dayBasisHint'),
      defaultValue: defaults?.dayBasis ?? 'calendar',
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
      action={saveFreeTimeRule}
      fields={fields}
      icon="clock"
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
