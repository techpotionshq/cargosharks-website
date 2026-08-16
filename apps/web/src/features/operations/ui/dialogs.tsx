/**
 * Operations dialogs — raising and clearing exceptions, and moving customs on.
 *
 * These are the writes a coordinator makes twenty times a day, so they are
 * short forms with sensible defaults rather than complete records of
 * everything the schema can hold. An exception form that asks for a cost
 * impact before it will accept "the container is stuck" is a form nobody uses,
 * and the exception ends up in a WhatsApp message instead.
 */

import { getTranslations } from 'next-intl/server'
import { requireSession } from '@/lib/session'
import { can } from '@/lib/permissions'
import { loadOptions } from '@/lib/options'
import { RecordDialog, type FieldSpec } from '@/ui/record-dialog'
import { closeException, raiseException, saveCustomsStage } from '../form-actions'

const SEVERITIES = ['low', 'medium', 'high', 'critical'] as const

const CUSTOMS_STATUSES = [
  'not_started', 'documents_pending', 'declaration_filed', 'assessed',
  'duty_paid', 'inspection', 'released', 'held',
] as const

/** Raise an exception. `jobId` is fixed when opened from a shipment. */
export async function RaiseExceptionDialog({
  jobId,
  variant = 'primary',
}: {
  readonly jobId?: string
  readonly variant?: 'primary' | 'secondary' | 'ghost'
}) {
  const session = await requireSession()
  if (!can(session, 'job.update')) return null

  const [options, t, tc] = await Promise.all([
    loadOptions(session.actor),
    getTranslations('exceptionForm'),
    getTranslations('common'),
  ])

  // Opened from a shipment the job is known; opened from the register it has
  // to be chosen, and the list of open shipments is the only sensible source.
  const shipments = await loadOpenShipments(session)

  const fields: FieldSpec[] = [
    ...(jobId
      ? [{ kind: 'hidden' as const, name: 'jobId', value: jobId }]
      : [
          {
            kind: 'select' as const,
            name: 'jobId',
            label: t('shipment'),
            span: 12 as const,
            required: true,
            options: shipments,
            placeholder: tc('choose'),
          },
        ]),
    {
      kind: 'select',
      name: 'exceptionCodeId',
      label: t('what'),
      span: 8,
      required: true,
      hint: t('whatHint'),
      options: options.exceptionCodes,
      placeholder: tc('choose'),
    },
    {
      kind: 'select',
      name: 'severity',
      label: t('severity'),
      span: 4,
      required: true,
      options: SEVERITIES.map((key) => ({ value: key, label: t(`severities.${key}`) })),
      defaultValue: 'medium',
    },
    {
      kind: 'textarea',
      name: 'description',
      label: t('description'),
      span: 12,
      rows: 3,
      hint: t('descriptionHint'),
      placeholder: t('descriptionPlaceholder'),
    },
    {
      kind: 'select',
      name: 'ownerId',
      label: t('owner'),
      span: 6,
      hint: t('ownerHint'),
      options: options.people,
      placeholder: tc('none'),
    },
    {
      kind: 'datetime-local',
      name: 'dueAt',
      label: t('dueAt'),
      span: 6,
      hint: t('dueAtHint'),
    },
    {
      kind: 'text',
      name: 'costImpact',
      label: t('cost'),
      span: 6,
      hint: t('costHint'),
    },
    {
      kind: 'select',
      name: 'costCurrency',
      label: t('costCurrency'),
      span: 6,
      options: options.currencies,
      placeholder: tc('none'),
    },
    {
      kind: 'switch',
      name: 'customerVisible',
      label: t('customerVisible'),
      span: 12,
      hint: t('customerVisibleHint'),
      defaultChecked: true,
    },
  ]

  return (
    <RecordDialog
      action={raiseException}
      fields={fields}
      icon="alert"
      size="lg"
      variant={variant}
      submitIcon="plus"
      labels={{
        open: t('open'),
        title: t('title'),
        description: t('description_'),
        submit: t('submit'),
        submitting: tc('saving'),
        cancel: tc('cancel'),
      }}
    />
  )
}

/** Close one out. The resolution is the whole point of the form. */
export async function CloseExceptionDialog({ exceptionId }: { readonly exceptionId: string }) {
  const session = await requireSession()
  if (!can(session, 'job.update')) return null

  const [t, tc] = await Promise.all([
    getTranslations('exceptionForm'),
    getTranslations('common'),
  ])

  return (
    <RecordDialog
      action={closeException}
      icon="check"
      size="sm"
      variant="ghost"
      submitIcon="check"
      fields={[
        { kind: 'hidden', name: 'exceptionId', value: exceptionId },
        {
          kind: 'textarea',
          name: 'resolution',
          label: t('resolution'),
          span: 12,
          required: true,
          rows: 4,
          hint: t('resolutionHint'),
          placeholder: t('resolutionPlaceholder'),
        },
      ]}
      labels={{
        open: t('close'),
        title: t('closeTitle'),
        description: t('closeDescription'),
        submit: t('closeSubmit'),
        submitting: tc('saving'),
        cancel: tc('cancel'),
      }}
    />
  )
}

export interface CustomsDefaults {
  readonly status?: string
  readonly declarationType?: string | null
  readonly declarationNo?: string | null
  readonly brokerPartnerId?: string | null
  readonly dutyAmount?: string | null
  readonly dutyCurrency?: string | null
  readonly inspectionRequired?: boolean
  readonly notes?: string | null
}

export async function CustomsDialog({
  jobId,
  defaults,
  variant = 'secondary',
}: {
  readonly jobId: string
  readonly defaults?: CustomsDefaults
  readonly variant?: 'primary' | 'secondary' | 'ghost'
}) {
  const session = await requireSession()
  if (!can(session, 'customs.update')) return null

  const [options, t, tc] = await Promise.all([
    loadOptions(session.actor),
    getTranslations('customsForm'),
    getTranslations('common'),
  ])

  const fields: FieldSpec[] = [
    { kind: 'hidden', name: 'jobId', value: jobId },
    {
      kind: 'select',
      name: 'status',
      label: t('status'),
      span: 6,
      required: true,
      hint: t('statusHint'),
      options: CUSTOMS_STATUSES.map((key) => ({ value: key, label: t(`statuses.${key}`) })),
      defaultValue: defaults?.status ?? 'not_started',
    },
    {
      kind: 'select',
      name: 'brokerPartnerId',
      label: t('broker'),
      span: 6,
      options: options.partners.filter((option) => option.group === 'broker'),
      placeholder: tc('none'),
      defaultValue: defaults?.brokerPartnerId,
    },
    {
      kind: 'text',
      name: 'declarationNo',
      label: t('declarationNo'),
      span: 6,
      mono: true,
      defaultValue: defaults?.declarationNo,
    },
    {
      kind: 'text',
      name: 'declarationType',
      label: t('declarationType'),
      span: 6,
      defaultValue: defaults?.declarationType,
    },
    {
      kind: 'text',
      name: 'dutyAmount',
      label: t('duty'),
      span: 6,
      hint: t('dutyHint'),
      defaultValue: defaults?.dutyAmount,
    },
    {
      kind: 'select',
      name: 'dutyCurrency',
      label: t('dutyCurrency'),
      span: 6,
      options: options.currencies,
      placeholder: tc('none'),
      defaultValue: defaults?.dutyCurrency,
    },
    {
      kind: 'datetime-local',
      name: 'slaDueAt',
      label: t('slaDueAt'),
      span: 6,
      hint: t('slaDueAtHint'),
    },
    {
      kind: 'switch',
      name: 'inspectionRequired',
      label: t('inspection'),
      span: 6,
      hint: t('inspectionHint'),
      defaultChecked: defaults?.inspectionRequired ?? false,
    },
    {
      kind: 'textarea',
      name: 'notes',
      label: t('notes'),
      span: 12,
      rows: 2,
      defaultValue: defaults?.notes,
    },
  ]

  return (
    <RecordDialog
      action={saveCustomsStage}
      fields={fields}
      icon="customs"
      size="lg"
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

/**
 * Open shipments, for the "which one?" select.
 *
 * Kept here rather than in `loadOptions` because it is the only form that
 * needs it and it is not reference data — it changes hourly, and putting it in
 * the shared per-request cache would mean every page paid for it.
 */
async function loadOpenShipments(session: Awaited<ReturnType<typeof requireSession>>) {
  const { withActor, jobs, customers } = await import('@qabandi/db')
  const { and, asc, eq, notInArray } = await import('drizzle-orm')

  return withActor(session.actor, async (tx) => {
    const rows = await tx
      .select({ id: jobs.id, reference: jobs.reference, customer: customers.legalNameEn })
      .from(jobs)
      .leftJoin(customers, eq(customers.id, jobs.customerId))
      .where(and(notInArray(jobs.status, ['closed', 'cancelled', 'completed'])))
      .orderBy(asc(jobs.reference))
      .limit(300)

    return rows.map((row) => ({
      value: row.id,
      label: row.customer ? `${row.reference} — ${row.customer}` : row.reference,
    }))
  })
}
