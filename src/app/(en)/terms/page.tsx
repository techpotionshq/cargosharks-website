import type { Metadata } from 'next'
import { DocPage } from '@/components/DocPage'
import { TermsContent } from '@/content/pages/terms'

/**
 * `noindex` while it is a draft.
 *
 * The page says three times over that it has not been reviewed by counsel, and
 * a search engine that indexes it puts a page carrying fifty-three open
 * decisions in front of somebody who arrived looking for the finished one. Take
 * this off the day it is signed off, and not before.
 */
export const metadata: Metadata = {
  title: 'Terms of service — CargoSharks',
  description:
    'The terms the pilot and the service run under. An unreviewed draft, written from the source code, with every open decision marked.',
  alternates: { canonical: '/terms/' },
  robots: { index: false, follow: true },
}

export default function Page() {
  return (
    <DocPage lang="en">
      <TermsContent />
    </DocPage>
  )
}
