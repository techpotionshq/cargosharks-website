import type { Metadata } from 'next'
import { pageOpenGraph } from '@/lib/og'
import { DocPage } from '@/components/DocPage'
import { TermsContent } from '@/content/pages/terms'

/**
 * `noindex` until counsel has signed the document off. The text no longer
 * carries draft warnings, but a legal page that search sends people to should
 * be one a lawyer has read. Take this off the day it is signed off.
 */
const title = 'Terms of service — CargoSharks'
const description =
  'The terms CargoSharks is supplied under: what is supplied, your data, accounts and access, support, and exit.'

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: '/terms/' },
  openGraph: pageOpenGraph({ path: '/terms/', title, description }),
  robots: { index: false, follow: true },
}

export default function Page() {
  return (
    <DocPage lang="en">
      <TermsContent />
    </DocPage>
  )
}
