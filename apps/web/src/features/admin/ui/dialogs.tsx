/**
 * Administration dialogs — people, branches, reference data.
 *
 * The user dialog deliberately has **no password field**. An administrator
 * invites someone by creating their identity and their branch roles; the
 * credential is set by the person who owns it. An administrator who can type a
 * colleague's password can sign in as them, and the audit log would record it
 * as the colleague — which quietly destroys the value of having an audit log.
 */

import { getLocale, getTranslations } from 'next-intl/server'
import { brandMailDomain, getBrand } from '@/lib/brand'
import { requireSession } from '@/lib/session'
import { branchesWhere, can } from '@/lib/permissions'
import { loadOptions } from '@/lib/options'
import { RecordDialog, type FieldSpec } from '@/ui/record-dialog'
import {
  saveBranch,
  saveNotificationTemplate,
  saveReferenceRecord,
  saveUser,
  setUserActive,
} from '../form-actions'

const REFERENCE_TABLES = ['commodity', 'charge_type', 'document_type', 'exception_code'] as const
const BASES = ['flat', 'per_unit', 'per_kg', 'per_container', 'per_day', 'percent'] as const
const SEVERITIES = ['low', 'medium', 'high', 'critical'] as const

export interface UserDefaults {
  readonly id?: string
  readonly nameEn?: string
  readonly nameAr?: string | null
  readonly email?: string
  readonly phone?: string | null
  readonly locale?: string
  readonly roleId?: string | null
  readonly branchIds?: readonly string[]
  /** The role held in each branch — what the edit form pre-selects. */
  readonly grants?: readonly { readonly branchId: string; readonly roleId: string }[]
  readonly isActive?: boolean
}

export async function UserDialog({
  defaults,
  variant = 'primary',
  iconOnly = false,
}: {
  readonly defaults?: UserDefaults
  readonly variant?: 'primary' | 'secondary' | 'ghost'
  readonly iconOnly?: boolean
}) {
  const session = await requireSession()
  if (!can(session, 'admin.users.write')) return null

  const [options, t, tc] = await Promise.all([
    getLocale().then((locale) => loadOptions(session.actor, locale === 'ar' ? 'ar' : 'en')),
    getTranslations('userForm'),
    getTranslations('common'),
  ])

  const editing = Boolean(defaults?.id)

  /**
   * Only branches the administrator *administers* — FR-ID-02, A2.
   *
   * Holding any role in a branch used to be enough to be offered it here, and
   * to pass the action's check. The server action refuses a grant outside
   * these anyway, so this is about not offering a choice that will be
   * rejected — but the check on the action is the one that matters, because
   * this list is a hint and that one is a boundary.
   */
  const administered = new Set(branchesWhere(session, 'admin.users.write'))
  const grantable = options.branches.filter((branch) => administered.has(branch.value))

  const nameFields: FieldSpec[] = [
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
      defaultValue: defaults?.nameAr,
    },
  ]
  const localeField: FieldSpec = {
    kind: 'select',
    name: 'locale',
    label: t('locale'),
    span: 6,
    required: true,
    hint: t('localeHint'),
    options: [
      { value: 'en', label: t('locales.en') },
      { value: 'ar', label: t('locales.ar') },
    ],
    defaultValue: defaults?.locale ?? 'en',
  }
  const activeField: FieldSpec = {
    kind: 'switch',
    name: 'isActive',
    label: t('active'),
    span: 12,
    hint: t('activeHint'),
    defaultChecked: defaults?.isActive ?? true,
  }

  const fields: FieldSpec[] = editing
    ? [
        { kind: 'hidden', name: 'principalId', value: defaults!.id! },
        /*
          The address is the login, so it is carried rather than offered: the
          sign-in identity (`auth_user.email`) does not follow an edit here,
          and a principal whose address no longer matches their login is a
          person who cannot sign in.
        */
        { kind: 'hidden', name: 'email', value: defaults?.email ?? '' },
        ...nameFields,
        {
          kind: 'tel',
          name: 'phone',
          label: t('phone'),
          span: 6,
          defaultValue: defaults?.phone,
        },
        localeField,
        /*
          A role per branch, which is what FR-ID-02 says a grant is. The
          invitation offers one role across the branches ticked because that
          is how a new colleague usually starts; changing someone is where
          "finance in Kuwait, read-only in Dubai" actually gets decided.
          Only branches this administrator administers (A2) — grants elsewhere
          are not shown and not touched by the action.
        */
        {
          kind: 'section',
          title: t('access'),
          hint: t('rolesPerBranchHint'),
          fields: grantable.map((branch) => ({
            kind: 'select' as const,
            name: `role:${branch.value}`,
            label: branch.label,
            span: 6 as const,
            options: [{ value: '', label: t('noAccess') }, ...options.roles],
            defaultValue: defaults?.grants?.find((g) => g.branchId === branch.value)?.roleId ?? '',
          })),
        },
        activeField,
      ]
    : [
        ...nameFields,
        {
          kind: 'email',
          name: 'email',
          label: t('email'),
          span: 6,
          required: true,
          hint: t('emailHint'),
          defaultValue: defaults?.email,
        },
        {
          kind: 'tel',
          name: 'phone',
          label: t('phone'),
          span: 6,
          defaultValue: defaults?.phone,
        },
        {
          kind: 'select',
          name: 'roleId',
          label: t('role'),
          span: 6,
          required: true,
          hint: t('roleHint'),
          options: options.roles,
          placeholder: tc('choose'),
          defaultValue: defaults?.roleId,
        },
        localeField,
        /*
          Branch access is a checkbox per branch rather than a multi-select,
          because with two or three branches the whole choice should be visible
          and a multi-select hides it behind a click. `name` repeats and each
          box carries its branch's id, so the form submits an array of ids
          (FR-ID-02). Without `value` every box sent "on" (QA P1-3).
        */
        {
          kind: 'section',
          title: t('access'),
          hint: t('accessHint'),
          fields: grantable.map((branch) => ({
            kind: 'switch' as const,
            name: 'branchIds',
            value: branch.value,
            label: branch.label,
            span: 6 as const,
            defaultChecked: defaults?.branchIds?.includes(branch.value) ?? false,
          })),
        },
        { kind: 'note', text: t('passwordNote') },
        activeField,
      ]

  return (
    <RecordDialog
      action={saveUser}
      fields={fields}
      icon="users"
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

export interface BranchDefaults {
  readonly id?: string
  readonly code?: string
  readonly legalNameEn?: string
  readonly legalNameAr?: string
  readonly baseCurrency?: string
  readonly country?: string
  readonly calendarId?: string
  readonly timeZone?: string
  readonly mailFrom?: string | null
  readonly quietHoursEnabled?: boolean
  readonly quietHoursFromHour?: number
  readonly quietHoursToHour?: number
  readonly invoiceSeries?: string
  readonly taxRegistration?: string | null
  readonly houseBillSeries?: string | null
  readonly arAccountCode?: string | null
  readonly apAccountCode?: string | null
  readonly taxAccountCode?: string | null
  readonly bankAccountCode?: string | null
  readonly fxVarianceAccountCode?: string | null
  readonly roundingAccountCode?: string | null
  readonly tradingConditionsEn?: string | null
  readonly tradingConditionsAr?: string | null
  readonly billOfLadingTermsEn?: string | null
  readonly billOfLadingTermsAr?: string | null
  readonly defaultExclusionsEn?: string | null
  readonly defaultExclusionsAr?: string | null
  readonly isActive?: boolean
}

export async function BranchDialog({
  defaults,
  calendars,
  variant = 'primary',
  iconOnly = false,
}: {
  readonly defaults?: BranchDefaults
  readonly calendars: readonly { value: string; label: string }[]
  readonly variant?: 'primary' | 'secondary' | 'ghost'
  readonly iconOnly?: boolean
}) {
  const session = await requireSession()
  if (!can(session, 'admin.reference.write')) return null

  const [options, t, tc] = await Promise.all([
    getLocale().then((locale) => loadOptions(session.actor, locale === 'ar' ? 'ar' : 'en')),
    getTranslations('branchForm'),
    getTranslations('common'),
  ])

  const editing = Boolean(defaults?.id)

  /*
    Only for the `mailFrom` placeholder below — the shape of the answer, drawn
    from this deployment's own identity rather than from whoever the default
    brand happened to be when the field was written.
  */
  const brand = getBrand()
  const mailFromExample = `${brand.identity.nameEn} <no-reply@${brandMailDomain(brand)}>`

  const fields: FieldSpec[] = [
    ...(editing ? [{ kind: 'hidden' as const, name: 'branchId', value: defaults!.id! }] : []),
    {
      kind: 'text',
      name: 'code',
      label: t('code'),
      span: 4,
      required: true,
      hint: t('codeHint'),
      mono: true,
      maxLength: 8,
      defaultValue: defaults?.code,
    },
    {
      kind: 'select',
      name: 'country',
      label: t('country'),
      span: 4,
      required: true,
      options: options.countries,
      placeholder: tc('choose'),
      defaultValue: defaults?.country,
    },
    {
      kind: 'select',
      name: 'baseCurrency',
      label: t('currency'),
      span: 4,
      required: true,
      hint: t('currencyHint'),
      options: options.currencies,
      placeholder: tc('choose'),
      defaultValue: defaults?.baseCurrency,
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
      required: true,
      hint: t('legalNameArHint'),
      defaultValue: defaults?.legalNameAr,
    },
    {
      kind: 'select',
      name: 'calendarId',
      label: t('calendar'),
      span: 6,
      required: true,
      hint: t('calendarHint'),
      options: calendars,
      placeholder: tc('choose'),
      defaultValue: defaults?.calendarId,
    },
    {
      kind: 'text',
      name: 'timeZone',
      label: t('timeZone'),
      span: 6,
      required: true,
      hint: t('timeZoneHint'),
      defaultValue: defaults?.timeZone ?? 'Asia/Kuwait',
    },
    /*
      Who this entity writes to customers as, and when it stops.

      Both are per legal entity for the same reason `invoice_series` is: five
      entities sending from one address is the same mistake as five numbering
      from one series, and quiet hours were already resolved against this
      branch's `timeZone` — everything about the window was per-branch except
      the two numbers, which were constants in the dispatcher.
    */
    {
      kind: 'text',
      name: 'mailFrom',
      label: t('mailFrom'),
      span: 12,
      hint: t('mailFromHint'),
      /*
        A placeholder and not a default: an entity that has not chosen a
        `From` must fall through to `MAIL_FROM` rather than silently start
        writing to customers as the brand's own address.
      */
      placeholder: mailFromExample,
      defaultValue: defaults?.mailFrom ?? '',
    },
    {
      kind: 'switch',
      name: 'quietHoursEnabled',
      label: t('quietHours'),
      span: 4,
      hint: t('quietHoursHint'),
      defaultChecked: defaults?.quietHoursEnabled ?? true,
    },
    {
      kind: 'number',
      name: 'quietHoursFromHour',
      label: t('quietHoursFrom'),
      span: 4,
      min: 0,
      max: 23,
      hint: t('quietHoursFromHint'),
      defaultValue: defaults?.quietHoursFromHour ?? 21,
    },
    {
      kind: 'number',
      name: 'quietHoursToHour',
      label: t('quietHoursTo'),
      span: 4,
      min: 0,
      max: 23,
      hint: t('quietHoursToHint'),
      defaultValue: defaults?.quietHoursToHour ?? 7,
    },
    {
      kind: 'text',
      name: 'taxRegistration',
      label: t('taxRegistration'),
      span: 6,
      mono: true,
      defaultValue: defaults?.taxRegistration,
    },
    ...(editing
      ? []
      : [
          {
            kind: 'text' as const,
            name: 'invoiceSeries',
            label: t('invoiceSeries'),
            span: 6 as const,
            mono: true,
            hint: t('invoiceSeriesHint'),
          },
        ]),
    {
      kind: 'text',
      name: 'houseBillSeries',
      label: t('houseBillSeries'),
      span: 6,
      mono: true,
      hint: t('houseBillSeriesHint'),
      defaultValue: defaults?.houseBillSeries,
    },
    /*
      The chart of accounts, in its own section.

      Unlike the invoice series it *is* editable after creation: an operator
      re-maps their ledger, and the mapping is a pointer at somebody else's
      system rather than a statutory sequence whose continuity we guarantee.
      Empty is the ordinary state of a new deployment — the export names what
      is missing rather than a form insisting on it up front.
    */
    {
      kind: 'section',
      title: t('accountsSection'),
      hint: t('accountsSectionHint'),
      fields: [
        {
          kind: 'text',
          name: 'arAccountCode',
          label: t('arAccount'),
          span: 4,
          mono: true,
          hint: t('arAccountHint'),
          defaultValue: defaults?.arAccountCode,
        },
        {
          kind: 'text',
          name: 'apAccountCode',
          label: t('apAccount'),
          span: 4,
          mono: true,
          defaultValue: defaults?.apAccountCode,
        },
        {
          kind: 'text',
          name: 'bankAccountCode',
          label: t('bankAccount'),
          span: 4,
          mono: true,
          defaultValue: defaults?.bankAccountCode,
        },
        {
          kind: 'text',
          name: 'taxAccountCode',
          label: t('taxAccount'),
          span: 4,
          mono: true,
          defaultValue: defaults?.taxAccountCode,
        },
        {
          kind: 'text',
          name: 'fxVarianceAccountCode',
          label: t('fxAccount'),
          span: 4,
          mono: true,
          hint: t('fxAccountHint'),
          defaultValue: defaults?.fxVarianceAccountCode,
        },
        {
          kind: 'text',
          name: 'roundingAccountCode',
          label: t('roundingAccount'),
          span: 4,
          mono: true,
          defaultValue: defaults?.roundingAccountCode,
        },
      ],
    },
    /*
      The trading conditions this entity quotes under — FR-EQ-08.

      Its own section and its own language pair, because the Arabic is not a
      translation of the English: a Kuwaiti forwarder's conditions are drafted
      in Arabic and the English is the courtesy copy, which is the opposite of
      how the rest of this form works. Machine-translating one into the other
      produces a term nobody would enforce.

      Both optional. A branch with no conditions issues a quotation without the
      footer rather than being unable to issue one — the same treatment the
      chart of accounts above gets, and for the same reason.
    */
    {
      kind: 'section',
      title: t('tradingSection'),
      hint: t('tradingSectionHint'),
      fields: [
        {
          kind: 'textarea',
          name: 'tradingConditionsEn',
          label: t('tradingConditionsEn'),
          span: 12,
          rows: 6,
          hint: t('tradingConditionsHint'),
          defaultValue: defaults?.tradingConditionsEn,
        },
        {
          kind: 'textarea',
          name: 'tradingConditionsAr',
          label: t('tradingConditionsAr'),
          span: 12,
          rows: 6,
          defaultValue: defaults?.tradingConditionsAr,
        },
        /*
          Exclusions are a list, and print as one beside the charges.

          Separate from the conditions above because the reader treats them
          differently: a paragraph at the foot is a term somebody is deemed to
          have read, and a short list next to the price is one they did. It is
          the line that decides who pays when the container is pulled for
          examination. Inclusions have no field here — they are the charges
          actually on the quotation, derived so they cannot disagree with it.
        */
        {
          kind: 'textarea',
          name: 'defaultExclusionsEn',
          label: t('exclusionsEn'),
          span: 6,
          rows: 4,
          hint: t('exclusionsHint'),
          defaultValue: defaults?.defaultExclusionsEn,
        },
        {
          kind: 'textarea',
          name: 'defaultExclusionsAr',
          label: t('exclusionsAr'),
          span: 6,
          rows: 4,
          defaultValue: defaults?.defaultExclusionsAr,
        },
        /*
          The reverse side of the house bill of lading.

          A different document from the quotation footer above, and a heavier
          one: these are the conditions of *carriage*, the clauses a claim is
          argued under, and which set a forwarder prints is a legal decision
          — a FIATA member prints the FBL conditions, a non-member cannot.
          Blank lines separate clauses and print as paragraphs. Empty prints
          the bill with no back page, and its face stops citing one.
        */
        {
          kind: 'textarea',
          name: 'billOfLadingTermsEn',
          label: t('billTermsEn'),
          span: 12,
          rows: 8,
          hint: t('billTermsHint'),
          defaultValue: defaults?.billOfLadingTermsEn,
        },
        {
          kind: 'textarea',
          name: 'billOfLadingTermsAr',
          label: t('billTermsAr'),
          span: 12,
          rows: 8,
          defaultValue: defaults?.billOfLadingTermsAr,
        },
      ],
    },
    {
      kind: 'switch',
      name: 'isActive',
      label: t('active'),
      span: 12,
      defaultChecked: defaults?.isActive ?? true,
    },
  ]

  return (
    <RecordDialog
      action={saveBranch}
      fields={fields}
      icon="branches"
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

export interface ReferenceDefaults {
  readonly id?: string
  readonly code?: string
  readonly nameEn?: string
  readonly nameAr?: string
  readonly category?: string | null
  readonly defaultBasis?: string
  readonly defaultSeverity?: string
  readonly hsCode?: string | null
  readonly revenueAccountCode?: string | null
  readonly costAccountCode?: string | null
  readonly isActive?: boolean
}

/**
 * The four small catalogues, behind one dialog.
 *
 * These are the tables that make the product *theirs* — a forwarder whose
 * charge list, document set and exception codes match how they actually work.
 * Making them editable in the interface, rather than in a seed file, is the
 * difference between a whitelabel and a fork.
 */
export async function ReferenceDialog({
  table,
  defaults,
  variant = 'primary',
  iconOnly = false,
}: {
  readonly table: (typeof REFERENCE_TABLES)[number]
  readonly defaults?: ReferenceDefaults
  readonly variant?: 'primary' | 'secondary' | 'ghost'
  readonly iconOnly?: boolean
}) {
  const session = await requireSession()
  if (!can(session, 'admin.reference.write')) return null

  const [t, tc] = await Promise.all([getTranslations('referenceForm'), getTranslations('common')])

  const editing = Boolean(defaults?.id)

  const fields: FieldSpec[] = [
    { kind: 'hidden', name: 'table', value: table },
    ...(editing ? [{ kind: 'hidden' as const, name: 'recordId', value: defaults!.id! }] : []),
    {
      kind: 'text',
      name: 'code',
      label: t('code'),
      span: 6,
      required: true,
      hint: t('codeHint'),
      mono: true,
      maxLength: 40,
      defaultValue: defaults?.code,
    },
    ...(table === 'charge_type' || table === 'document_type'
      ? [
          {
            kind: 'text' as const,
            name: 'category',
            label: t('category'),
            span: 6 as const,
            hint: t('categoryHint'),
            defaultValue: defaults?.category,
          },
        ]
      : []),
    ...(table === 'commodity'
      ? [
          {
            kind: 'text' as const,
            name: 'hsCode',
            label: t('hsCode'),
            span: 6 as const,
            hint: t('hsCodeHint'),
            mono: true,
            defaultValue: defaults?.hsCode,
          },
        ]
      : []),
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
      required: true,
      hint: t('nameArHint'),
      defaultValue: defaults?.nameAr,
    },
    ...(table === 'charge_type'
      ? [
          {
            kind: 'select' as const,
            name: 'defaultBasis',
            label: t('basis'),
            span: 6 as const,
            required: true,
            hint: t('basisHint'),
            options: BASES.map((key) => ({ value: key, label: t(`bases.${key}`) })),
            defaultValue: defaults?.defaultBasis ?? 'flat',
          },
          /*
            Where this charge lands in the customer's ledger.

            Two free-text codes rather than a picker, because the chart of
            accounts belongs to the customer's accounting package and we do
            not hold it. Blank is legitimate until somebody closes a period —
            at which point the export names this row.
          */
          {
            kind: 'text' as const,
            name: 'revenueAccountCode',
            label: t('revenueAccount'),
            span: 6 as const,
            mono: true,
            hint: t('revenueAccountHint'),
            defaultValue: defaults?.revenueAccountCode,
          },
          {
            kind: 'text' as const,
            name: 'costAccountCode',
            label: t('costAccount'),
            span: 6 as const,
            mono: true,
            defaultValue: defaults?.costAccountCode,
          },
        ]
      : []),
    ...(table === 'exception_code'
      ? [
          {
            kind: 'select' as const,
            name: 'defaultSeverity',
            label: t('severity'),
            span: 6 as const,
            required: true,
            hint: t('severityHint'),
            options: SEVERITIES.map((key) => ({ value: key, label: t(`severities.${key}`) })),
            defaultValue: defaults?.defaultSeverity ?? 'medium',
          },
        ]
      : []),
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
      action={saveReferenceRecord}
      fields={fields}
      icon="reference"
      variant={variant}
      iconOnly={iconOnly}
      submitIcon={editing ? 'check' : 'plus'}
      labels={{
        open: editing ? tc('edit') : t(`open.${table}`),
        title: editing ? t(`editTitle.${table}`) : t(`title.${table}`),
        description: t(`description.${table}`),
        submit: editing ? tc('save') : tc('save'),
        submitting: tc('saving'),
        cancel: tc('cancel'),
      }}
    />
  )
}

/**
 * Suspending an account, and restoring one.
 *
 * The only way to take somebody's access away through the interface. There is
 * no delete and there should not be: a principal is referenced by every row
 * they ever wrote — `created_by_id`, `posted_by_id`, the audit trail — so
 * removing the row would either fail on a foreign key or orphan the history
 * that makes the audit trail worth keeping (§5.5).
 *
 * `setUserActive` refuses to suspend the caller's own account, because that
 * locks them out with no way back through the interface. This does not try to
 * anticipate that with a disabled button: the action is the boundary, and a
 * check here as well would be a second place for the rule to live.
 */
export async function SuspendUserDialog({
  principalId,
  name,
  isActive,
}: {
  readonly principalId: string
  readonly name: string
  readonly isActive: boolean
}) {
  const session = await requireSession()
  if (!can(session, 'admin.users.write')) return null

  // Their own row offers nothing: the action refuses it, and an control that
  // only ever fails is worse than no control.
  if (isActive && principalId === session.principal.id) return null

  const [t, tc] = await Promise.all([getTranslations('userForm'), getTranslations('common')])

  const fields: FieldSpec[] = [
    { kind: 'hidden', name: 'principalId', value: principalId },
    // Presence is the signal — see `setUserActive`.
    ...(isActive ? [] : [{ kind: 'hidden' as const, name: 'isActive', value: 'true' }]),
    {
      kind: 'note',
      text: isActive ? t('suspendWarning') : t('restoreNote'),
      tone: isActive ? 'caution' : 'info',
    },
  ]

  return (
    <RecordDialog
      action={setUserActive}
      fields={fields}
      icon={isActive ? 'hold' : 'check'}
      variant="ghost"
      iconOnly
      submitIcon={isActive ? 'hold' : 'check'}
      labels={{
        open: isActive ? t('suspend') : t('restore'),
        title: isActive ? t('suspendTitle', { name }) : t('restoreTitle', { name }),
        description: isActive ? t('suspendDescription') : t('restoreDescription'),
        submit: isActive ? t('suspend') : t('restore'),
        submitting: tc('saving'),
        cancel: tc('cancel'),
      }}
    />
  )
}

/**
 * Editing what a notification says — FR-NT-03.
 *
 * The merge fields are listed in the hint rather than left to be remembered,
 * because the failure they guard against is silent: `renderTemplate`
 * substitutes an unknown field with an empty string, so a typo sends "Your
 * shipment  has arrived" successfully, for ever. The action refuses one it
 * does not recognise; this is what stops the administrator having to guess in
 * the first place.
 *
 * Opening it against a branch creates that branch's override and leaves the
 * default alone (§7.4) — which is what makes "Dubai says it differently" a row
 * rather than a release.
 */
export async function NotificationTemplateDialog({
  eventKey,
  locale,
  mergeFields,
  template,
  branches: branchOptions,
  variant = 'ghost',
}: {
  readonly eventKey: string
  readonly locale: 'en' | 'ar'
  readonly mergeFields: readonly string[]
  readonly template?: {
    readonly id?: string
    readonly branchId?: string | null
    readonly subject?: string | null
    readonly body?: string
    readonly isActive?: boolean
  }
  readonly branches: readonly { value: string; label: string }[]
  readonly variant?: 'primary' | 'secondary' | 'ghost'
}) {
  const session = await requireSession()
  if (!can(session, 'admin.reference.write')) return null

  const [t, tc] = await Promise.all([
    getTranslations('notificationTemplates'),
    getTranslations('common'),
  ])

  const fields: FieldSpec[] = [
    { kind: 'hidden', name: 'eventKey', value: eventKey },
    { kind: 'hidden', name: 'locale', value: locale },
    ...(template?.id ? [{ kind: 'hidden' as const, name: 'templateId', value: template.id }] : []),
    {
      kind: 'select',
      name: 'branchId',
      label: t('branch'),
      span: 12,
      options: branchOptions,
      placeholder: t('allBranches'),
      hint: t('branchHint'),
      defaultValue: template?.branchId ?? undefined,
    },
    {
      kind: 'text',
      name: 'subject',
      label: t('subject'),
      span: 12,
      defaultValue: template?.subject ?? undefined,
    },
    {
      kind: 'textarea',
      name: 'body',
      label: t('body'),
      span: 12,
      required: true,
      rows: 10,
      hint: t('fieldsHint', { fields: mergeFields.map((f) => `{{${f}}}`).join(' ') }),
      defaultValue: template?.body,
    },
    {
      kind: 'switch',
      name: 'isActive',
      label: t('active'),
      span: 12,
      hint: t('activeHint'),
      defaultChecked: template?.isActive ?? true,
    },
  ]

  return (
    <RecordDialog
      action={saveNotificationTemplate}
      fields={fields}
      icon="bell"
      variant={variant}
      iconOnly={Boolean(template?.id)}
      labels={{
        open: template?.id ? tc('edit') : t('override'),
        title: t('title', { event: eventKey }),
        description: t('description'),
        submit: tc('save'),
        submitting: tc('saving'),
        cancel: tc('cancel'),
      }}
    />
  )
}
