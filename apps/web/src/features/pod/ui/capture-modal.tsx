'use client'

/**
 * The capture dialog's client half.
 *
 * Split from the server wrapper for one hard reason: `Modal` takes its trigger
 * as a render prop, and a function cannot cross the server/client boundary. An
 * async server component that passes one throws while React serialises the
 * flight stream, and because this dialog is rendered into the job file's header
 * the whole job page falls to the error boundary — for `job.update` holders
 * only, since nobody else renders the trigger at all. The closure is therefore
 * born here, and the server side keeps the one thing only it can do.
 *
 * Being on the client is also what lets the dialog close itself on success.
 * `useDialog()` only resolves inside the modal's children, which is why the
 * form is wrapped one level deeper instead of rendered here directly.
 */

import { useTranslations } from 'next-intl'
import { Modal, useDialog } from '@/ui/modal'
import { PodCaptureForm } from './capture'
import { captureProofOfDelivery } from '../form-actions'

export interface PodCaptureModalProps {
  readonly jobId: string
  readonly equipment: readonly { value: string; label: string }[]
  /** Set when this capture replaces an earlier record. */
  readonly supersedesId?: string
  readonly variant?: 'primary' | 'secondary' | 'ghost'
}

export function PodCaptureModal({
  jobId,
  equipment,
  supersedesId,
  variant = 'primary',
}: PodCaptureModalProps) {
  const t = useTranslations('pod')
  const correcting = supersedesId !== undefined

  return (
    <Modal
      title={correcting ? t('correctTitle') : t('captureTitle')}
      description={correcting ? t('correctDescription') : t('captureDescription')}
      icon="check"
      size="lg"
      closeLabel={t('close')}
      trigger={({ onClick }) => (
        <button
          type="button"
          onClick={onClick}
          className={[
            'inline-flex h-9 items-center gap-1.5 rounded-sm px-3.5 text-[0.875rem] font-medium transition-colors',
            variant === 'primary'
              ? 'bg-brand text-on-brand hover:bg-brand-hover'
              : 'border border-line bg-surface text-ink hover:bg-surface-sunken',
          ].join(' ')}
        >
          {correcting ? t('correct') : t('capture')}
        </button>
      )}
    >
      <CaptureForm jobId={jobId} equipment={equipment} supersedesId={supersedesId} />
    </Modal>
  )
}

/**
 * A capture that succeeded should put you back on the job file, not leave you
 * looking at the form you just submitted. This sits inside the modal's children
 * so `useDialog()` finds the real `close()`; the action has already revalidated
 * `/jobs/:id` by the time it runs, so the new record is behind the dialog.
 */
function CaptureForm({ jobId, equipment, supersedesId }: Omit<PodCaptureModalProps, 'variant'>) {
  const { close } = useDialog()

  return (
    <PodCaptureForm
      action={captureProofOfDelivery}
      jobId={jobId}
      equipment={equipment}
      supersedesId={supersedesId}
      onDone={close}
    />
  )
}
