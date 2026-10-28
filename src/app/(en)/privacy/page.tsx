import type { Metadata } from 'next'
import { pageOpenGraph } from '@/lib/og'
import { DocPage } from '@/components/DocPage'
import { PrivacyContent } from '@/content/pages/privacy'

/**
 * `noindex` until counsel has signed the document off. The text no longer
 * carries draft warnings, but a legal page that search sends people to should
 * be one a lawyer has read. Take this off the day it is signed off.
 */
const title = 'Privacy policy — CargoSharks'
const description =
  'What personal data CargoSharks holds, where it is hosted, who else touches it, and how long it is kept.'

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
