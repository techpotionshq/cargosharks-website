import type { Metadata } from 'next'
import { DocPage } from '@/components/DocPage'
import { ComparisonContent } from '@/content/pages/comparison'
import { comparisons } from '@/content/comparisons'
import { Breadcrumbs } from '@/components/StructuredData'

/**
 * `/compare/spreadsheets/`.
 *
 * The page itself is `ComparisonContent` driven by a row in
 * `comparisons.ts` — see that file for why these four are data rather than
 * four hand-written documents, and for the editorial rule they follow.
 */
const item = comparisons.find((entry) => entry.slug === 'spreadsheets')!

export const metadata: Metadata = {
  title: 'CargoSharks vs spreadsheets — the three places Excel breaks',
  description:
    'The real incumbent in Gulf freight forwarding. When a spreadsheet is still the right answer, and the three specific places it stops being one: the clock nobody starts, overlapping rate cards, and no history.',
  alternates: { canonical: '/compare/spreadsheets/' },
  openGraph: {
    type: 'article',
    title: 'CargoSharks vs spreadsheets — the three places Excel breaks',
    description:
      'The real incumbent in Gulf freight forwarding. When a spreadsheet is still the right answer, and the three specific places it stops being one: the clock nobody starts, overlapping rate cards, and no history.',
    url: '/compare/spreadsheets/',
    images: [{ url: '/pic/screens/app-dashboard.webp', width: 2360, height: 1476 }],
  },
}

export default function Page() {
  return (
    <DocPage lang="en">
      <Breadcrumbs
        trail={[
          { name: 'How we compare', path: '/compare/' },
          { name: item.name, path: '/compare/spreadsheets/' },
        ]}
      />
      <ComparisonContent item={item} lang="en" />
    </DocPage>
  )
}
