import type { Metadata } from 'next'
import { DocPage } from '@/components/DocPage'
import { ComparisonContent } from '@/content/pages/comparison'
import { comparisons } from '@/content/comparisons'
import { Breadcrumbs } from '@/components/StructuredData'

/**
 * `/compare/cargowise/`.
 *
 * The page itself is `ComparisonContent` driven by a row in
 * `comparisons.ts` — see that file for why these four are data rather than
 * four hand-written documents, and for the editorial rule they follow.
 */
const item = comparisons.find((entry) => entry.slug === 'cargowise')!

export const metadata: Metadata = {
  title: 'CargoSharks vs CargoWise — an honest comparison for Gulf forwarders',
  description:
    'What CargoWise says about itself, where it is the better answer, where a Kuwait-built bilingual system is, and the five questions worth asking both vendors. No tick-and-cross grid.',
  alternates: { canonical: '/compare/cargowise/' },
  openGraph: {
    type: 'article',
    title: 'CargoSharks vs CargoWise — an honest comparison for Gulf forwarders',
    description: 'What CargoWise says about itself, where it is the better answer, where a Kuwait-built bilingual system is, and the five questions worth asking both vendors. No tick-and-cross grid.',
    url: '/compare/cargowise/',
  },
}

export default function Page() {
  return (
    <DocPage lang="en">
      <Breadcrumbs
        trail={[
          { name: 'How we compare', path: '/compare/' },
          { name: item.name, path: '/compare/cargowise/' },
        ]}
      />
      <ComparisonContent item={item} lang="en" />
    </DocPage>
  )
}
