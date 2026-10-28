import type { Metadata } from 'next'
import { pageOpenGraph } from '@/lib/og'
import { WhatWeDoPage } from '@/content/pages/what-we-do'

// Led with the search phrase and kept inside DESIGN.md's limits (a title of
// 60 characters, a description of 155).
const title = 'Freight forwarding software, quote to invoice | CargoSharks'
const description =
  'One record per freight job: enquiry, rate cards and quotes, milestones, customs, Arabic and English documents, invoicing with ZATCA and UAE e-invoicing.'

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: '/what-we-do/' },
  openGraph: pageOpenGraph({ path: '/what-we-do/', title, description }),
}

export default function Page() {
  return <WhatWeDoPage />
}
