/**
 * Every register under `(ops)` while its query runs — see `ui/skeleton.tsx`.
 *
 * One file at the group's root rather than one per register: a nested segment
 * without a `loading.tsx` of its own inherits this boundary, and the twelve
 * registers share one shape. Detail pages override it with the record shape.
 */

import { getTranslations } from 'next-intl/server'
import { RegisterSkeleton } from '@/ui/skeleton'

export default async function Loading() {
  const t = await getTranslations('common')
  return <RegisterSkeleton label={t('loading')} />
}
