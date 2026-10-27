import type { Metadata } from 'next'
import { pageOpenGraph } from '@/lib/og'
import { DocPage } from '@/components/DocPage'
import { DpaContent } from '@/content/pages/dpa'

/**
 * `noindex` while it is a draft.
 *
 * The page says three times over that it has not been reviewed by counsel, and
 * a search engine that indexes it puts a page carrying fifty-three open
 * decisions in front of somebody who arrived looking for the finished one. Take
 * this off the day it is signed off, and not before.
 */
const title = 'Data-processing addendum — CargoSharks'
const description =
  'Roles, instructions, sub-processors, transfers, deletion and audit. An unreviewed draft, written from the source code, with every open decision marked.'

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: '/dpa/' },
  openGraph: pageOpenGraph({ path: '/dpa/', title, description }),
  robots: { index: false, follow: true },
}

export default function Page() {
  return (
    <DocPage lang="en">
      <DpaContent />
    </DocPage>
  )
}
