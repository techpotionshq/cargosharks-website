/**
 * The two ways a job's vessel identity changes: typed, or a suggestion
 * confirmed. Both are permission-gated here, so a caller can place them
 * without checking `job.update` itself.
 */

import { getTranslations } from 'next-intl/server'
import { requireSession } from '@/lib/session'
import { can } from '@/lib/permissions'
import { RecordDialog } from '@/ui/record-dialog'
import { confirmVesselSuggestion, saveVesselIdentity } from '../form-actions'

export async function VesselIdentityDialog({
  jobId,
  imo,
  mmsi,
}: {
  readonly jobId: string
  readonly imo: string | null
  readonly mmsi: string | null
}) {
  const session = await requireSession()
  if (!can(session, 'job.update')) return null
  const [t, tc] = await Promise.all([getTranslations('vesselPosition'), getTranslations('common')])

  return (
    <RecordDialog
      action={saveVesselIdentity}
      icon="edit"
      size="sm"
      variant="ghost"
      submitIcon="check"
      fields={[
        { kind: 'hidden', name: 'jobId', value: jobId },
        {
          kind: 'text',
          name: 'mmsi',
          label: t('mmsi'),
          span: 6,
          mono: true,
          maxLength: 12,
          hint: t('mmsiHint'),
          defaultValue: mmsi,
        },
        {
          kind: 'text',
          name: 'imo',
          label: t('imo'),
          span: 6,
          mono: true,
          maxLength: 12,
          hint: t('imoHint'),
          defaultValue: imo,
        },
      ]}
      labels={{
        open: t('edit'),
        title: t('editTitle'),
        description: t('editDescription'),
        submit: tc('save'),
        submitting: tc('saving'),
        cancel: tc('cancel'),
      }}
    />
  )
}

/**
 * Confirming a suggestion is a dialog, not a one-click button, on purpose:
 * the person sees the MMSI and IMO they are about to attach, and can correct
 * either before saving. A name match is weak evidence, and the second look is
 * the safeguard.
 */
export async function VesselSuggestionConfirm({
  jobId,
  mmsi,
  imo,
}: {
  readonly jobId: string
  readonly mmsi: string
  readonly imo: string | null
}) {
  const session = await requireSession()
  if (!can(session, 'job.update')) return null
  const [t, tc] = await Promise.all([getTranslations('vesselPosition'), getTranslations('common')])

  return (
    <RecordDialog
      action={confirmVesselSuggestion}
      icon="check"
      size="sm"
      variant="secondary"
      submitIcon="check"
      fields={[
        { kind: 'hidden', name: 'jobId', value: jobId },
        {
          kind: 'text',
          name: 'mmsi',
          label: t('mmsi'),
          span: 6,
          mono: true,
          required: true,
          maxLength: 12,
          hint: t('mmsiHint'),
          defaultValue: mmsi,
        },
        {
          kind: 'text',
          name: 'imo',
          label: t('imo'),
          span: 6,
          mono: true,
          maxLength: 12,
          hint: t('imoHint'),
          defaultValue: imo,
        },
      ]}
      labels={{
        open: t('confirm'),
        title: t('suggestionTitle'),
        description: t('editDescription'),
        submit: t('confirm'),
        submitting: tc('saving'),
        cancel: tc('cancel'),
      }}
    />
  )
}
