import type { Metadata } from 'next'
import { pageOpenGraph } from '@/lib/og'
import { DocPage } from '@/components/DocPage'
import { WhatWeDoContent } from '@/content/pages/what-we-do'

const title = 'What CargoSharks does — one forwarding job, one record'
const description =
  'The commercial and operational software a freight forwarder runs its day on: enquiry, quote, award, execution, documents, invoice, without any of it being typed into a second system.'

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: '/what-we-do/' },
  openGraph: pageOpenGraph({ path: '/what-we-do/', title, description }),
}

export default function Page() {
  return (
    <DocPage lang="en">
      <WhatWeDoContent />
    </DocPage>
  )
}
