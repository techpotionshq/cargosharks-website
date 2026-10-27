import type { Metadata } from 'next'
import { pageOpenGraph } from '@/lib/og'
import { DocPage } from '@/components/DocPage'
import { PrivacyContent } from '@/content/pages/privacy'

/**
 * `noindex` while it is a draft.
 *
 * The page says three times over that it has not been reviewed by counsel, and
 * a search engine that indexes it puts a page carrying fifty-three open
 * decisions in front of somebody who arrived looking for the finished one. Take
 * this off the day it is signed off, and not before.
 */
const title = 'Privacy policy — CargoSharks'
const description =
  'What personal data CargoSharks holds, where it is hosted, who else touches it, and what has not been decided yet. An unreviewed draft, written from the source code.'

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: '/privacy/' },
  openGraph: pageOpenGraph({ path: '/privacy/', title, description }),
  robots: { index: false, follow: true },
}

export default function Page() {
  return (
    <DocPage lang="en">
      <PrivacyContent />
    </DocPage>
  )
}
