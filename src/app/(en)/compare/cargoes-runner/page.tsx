import type { Metadata } from 'next'
import { DocPage } from '@/components/DocPage'
import { ComparisonContent } from '@/content/pages/comparison'
import { comparisons } from '@/content/comparisons'
import { Breadcrumbs } from '@/components/StructuredData'

/**
 * `/compare/cargoes-runner/`.
 *
 * The page itself is `ComparisonContent` driven by a row in
 * `comparisons.ts` — see that file for why these four are data rather than
 * four hand-written documents, and for the editorial rule they follow.
 */
const item = comparisons.find((entry) => entry.slug === 'cargoes-runner')!

export const metadata: Metadata = {
  title: 'CargoSharks vs CARGOES Runner — DP World’s platform, compared honestly',
  description:
    'What CARGOES Runner is, when the backing of a group that size is the reason to choose it, and where a smaller independent system built in Kuwait fits instead.',
  alternates: { canonical: '/compare/cargoes-runner/' },
  openGraph: {
    type: 'article',
    title: 'CargoSharks vs CARGOES Runner — DP World’s platform, compared honestly',
    description:
      'What CARGOES Runner is, when the backing of a group that size is the reason to choose it, and where a smaller independent system built in Kuwait fits instead.',
    url: '/compare/cargoes-runner/',
    images: [{ url: '/pic/screens/app-dashboard.webp', width: 2360, height: 1476 }],
  },
}

export default function Page() {
  return (
    <DocPage lang="en">
      <Breadcrumbs
        trail={[
          { name: 'How we compare', path: '/compare/' },
          { name: item.name, path: '/compare/cargoes-runner/' },
        ]}
      />
      <ComparisonContent item={item} lang="en" />
    </DocPage>
  )
}
