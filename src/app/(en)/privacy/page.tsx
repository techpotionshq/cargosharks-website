import type { Metadata } from 'next'
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
export const metadata: Metadata = {
  title: 'Privacy policy — CargoSharks',
  description:
    'What personal data CargoSharks holds, where it is hosted, who else touches it, and what has not been decided yet. An unreviewed draft, written from the source code.',
  alternates: { canonical: '/privacy/' },
  robots: { index: false, follow: true },
}

export default function Page() {
  return (
    <DocPage lang="en">
      <PrivacyContent />
    </DocPage>
  )
}
