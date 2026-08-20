/**
 * The capture form, in a modal.
 *
 * A thin server wrapper, and now genuinely thin: it resolves the permission and
 * nothing else. Keeping the boundary here means the permission check stays on
 * the server where it cannot be skipped.
 *
 * Everything below this line is client work — the dialog needs a trigger
 * closure, and the form needs a canvas, a camera input and a geolocation call.
 * The labels went with it: `PodCaptureModal` reads the same `pod` namespace
 * through `useTranslations`, which is what the form inside it already did.
 */

import { requireSession } from '@/lib/session'
import { can } from '@/lib/permissions'
import { PodCaptureModal } from './capture-modal'

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

  return (
    <PodCaptureModal
      jobId={jobId}
      equipment={equipment}
      supersedesId={supersedesId}
      variant={variant}
    />
  )
}
