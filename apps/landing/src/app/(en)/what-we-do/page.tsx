import type { Metadata } from 'next'
import { DocPage } from '@/components/DocPage'
import { WhatWeDoContent } from '@/content/pages/what-we-do'

export const metadata: Metadata = {
  title: 'What CargoSharks does — one forwarding job, one record',
  description:
    'The commercial and operational software a freight forwarder runs its day on: enquiry, quote, award, execution, documents, invoice, without any of it being typed into a second system.',
  alternates: { canonical: '/what-we-do/' },
}

export default function Page() {
  return (
    <DocPage lang="en">
      <WhatWeDoContent />
    </DocPage>
  )
}
