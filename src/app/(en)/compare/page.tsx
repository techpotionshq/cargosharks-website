import type { Metadata } from 'next'
import { pageOpenGraph } from '@/lib/og'
import { CompareContent, compareMeta } from '@/content/pages/compare'

const { title, description } = compareMeta

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: '/compare/' },
  openGraph: pageOpenGraph({ path: '/compare/', title, description }),
}

export default function Page() {
  return <CompareContent />
}
