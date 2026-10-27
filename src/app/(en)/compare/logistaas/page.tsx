import type { Metadata } from 'next'
import { DocPage } from '@/components/DocPage'
import { ComparisonContent } from '@/content/pages/comparison'
import { comparisons } from '@/content/comparisons'
import { Breadcrumbs } from '@/components/StructuredData'

/**
 * `/compare/logistaas/`.
 *
 * The page itself is `ComparisonContent` driven by a row in
 * `comparisons.ts` — see that file for why these four are data rather than
 * four hand-written documents, and for the editorial rule they follow.
 */
const item = comparisons.find((entry) => entry.slug === 'logistaas')!

export const metadata: Metadata = {
  title: 'CargoSharks vs Logistaas — the closest comparison, written straight',
  description:
    'Two cloud freight systems sold to forwarders the same size in the same region. Where Logistaas is the better answer, where we are, and the questions to put to both.',
  alternates: { canonical: '/compare/logistaas/' },
  openGraph: {
    type: 'article',
    title: 'CargoSharks vs Logistaas — the closest comparison, written straight',
    description:
      'Two cloud freight systems sold to forwarders the same size in the same region. Where Logistaas is the better answer, where we are, and the questions to put to both.',
    url: '/compare/logistaas/',
    images: [{ url: '/pic/screens/app-dashboard.webp', width: 2360, height: 1476 }],
  },
}

export default function Page() {
  return (
    <DocPage lang="en">
      <Breadcrumbs
        trail={[
          { name: 'How we compare', path: '/compare/' },
          { name: item.name, path: '/compare/logistaas/' },
        ]}
      />
      <ComparisonContent item={item} lang="en" />
    </DocPage>
  )
}
