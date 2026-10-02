/** The record's shape while it loads — see `ui/skeleton.tsx`. */

import { getTranslations } from 'next-intl/server'
import { DetailSkeleton } from '@/ui/skeleton'

export default async function Loading() {
  const t = await getTranslations('common')
  return <DetailSkeleton label={t('loading')} />
}
