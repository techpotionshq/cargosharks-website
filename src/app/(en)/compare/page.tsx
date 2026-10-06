import type { Metadata } from 'next'
import { DocPage } from '@/components/DocPage'
import { CompareContent } from '@/content/pages/compare'

export const metadata: Metadata = {
  title: 'How CargoSharks compares — and who it is not for',
  description:
    'Three ways to run a forwarding operation, what each costs, and the half of this we are honest about. No claims are made about anyone else’s product.',
  alternates: { canonical: '/compare/' },
}

export default function Page() {
  return (
    <DocPage lang="en">
      <CompareContent />
    </DocPage>
  )
}
