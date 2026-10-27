import type { Metadata } from 'next'
import { pageOpenGraph } from '@/lib/og'
import { DocPage } from '@/components/DocPage'
import { CompareContent } from '@/content/pages/compare'

const title = 'How CargoSharks compares — and who it is not for'
const description =
  'Three ways to run a forwarding operation, what each costs, and the half of this we are honest about. No claims are made about anyone else’s product.'

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: '/compare/' },
  openGraph: pageOpenGraph({ path: '/compare/', title, description }),
}

export default function Page() {
  return (
    <DocPage lang="en">
      <CompareContent />
    </DocPage>
  )
}
