import type { Metadata } from 'next'
import { pageOpenGraph } from '@/lib/og'
import { DocPage } from '@/components/DocPage'
import { DpaContent } from '@/content/pages/dpa'

/**
 * `noindex` until counsel has signed the document off. The text no longer
 * carries draft warnings, but a legal page that search sends people to should
 * be one a lawyer has read. Take this off the day it is signed off.
 */
const title = 'Data-processing addendum — CargoSharks'
const description =
  'How CargoSharks processes personal data for its customers: roles, instructions, sub-processors, transfers, deletion and audit.'

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
