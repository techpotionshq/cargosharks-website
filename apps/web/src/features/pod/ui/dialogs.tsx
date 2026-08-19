/**
 * The capture form, in a modal.
 *
 * A thin server wrapper: it resolves the permission and the labels, and hands
 * the client form its action. The form itself has to be a client component —
 * a canvas, a camera input and a geolocation call are all browser things — and
 * keeping the boundary here means the permission check stays on the server
 * where it cannot be skipped.
 */

import { getTranslations } from 'next-intl/server'
import { requireSession } from '@/lib/session'
import { can } from '@/lib/permissions'
import { Modal } from '@/ui/modal'
import { PodCaptureForm } from './capture'
import { captureProofOfDelivery } from '../form-actions'

export async function PodCaptureDialog({
  jobId,
  equipment,
  supersedesId,
  variant = 'primary',
}: {
  readonly jobId: string
  readonly equipment: readonly { value: string; label: string }[]
  readonly supersedesId?: string
  readonly variant?: 'primary' | 'secondary' | 'ghost'
}) {
  const session = await requireSession()
  if (!can(session, 'job.update')) return null

  const t = await getTranslations('pod')

  return (
    <Modal
      title={supersedesId ? t('correctTitle') : t('captureTitle')}
      description={supersedesId ? t('correctDescription') : t('captureDescription')}
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
          {supersedesId ? t('correct') : t('capture')}
        </button>
      )}
    >
      <PodCaptureForm
        action={captureProofOfDelivery}
        jobId={jobId}
        equipment={equipment}
        supersedesId={supersedesId}
      />
    </Modal>
  )
}
