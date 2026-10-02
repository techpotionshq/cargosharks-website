import type { Metadata } from 'next'
import { DocPage } from '@/components/DocPage'
import { ServerErrorContent } from '@/content/pages/500'

/** An error page has nothing to index and a canonical would be a lie. */
export const metadata: Metadata = {
  title: 'Server error — CargoSharks',
  description: 'The request arrived and we failed to answer it.',
  robots: { index: false, follow: true },
}

export default function Page() {
  return (
    <DocPage lang="en">
      <ServerErrorContent />
    </DocPage>
  )
}
