import type { Metadata, Viewport } from 'next'
import type { ReactNode } from 'react'
import { Document } from '@/components/Document'

/**
 * The English root layout.
 *
 * Next permits one root layout per route group and this site has two — see
 * `src/components/Document.tsx` for why the split exists rather than a `lang`
 * prop threaded through a single one.
 */

export const metadata: Metadata = {
  metadataBase: new URL('https://cargosharks.com'),
  title: 'CargoSharks — freight software for Gulf forwarders',
  description:
    'One system from enquiry to paid invoice for freight forwarders and customs brokers in Kuwait and the Gulf. Sea, air, road, rail and courier, in Arabic and English.',
  alternates: { canonical: '/', languages: { ar: '/ar/', 'x-default': '/' } },
  openGraph: {
    type: 'website',
    locale: 'en',
    alternateLocale: 'ar',
    siteName: 'CargoSharks',
    // The home page's own URL. Every other page sets its own `openGraph`
    // (`src/lib/og.ts`), so none of them inherits this one.
    url: '/',
    title: 'CargoSharks — freight software for Gulf forwarders',
    description:
      'Quote, award, milestones, customs, documents, costs and invoice on one file. Built bilingual, not translated.',
    images: [{ url: '/pic/screens/app-dashboard.webp', width: 2360, height: 1476 }],
  },
  // No Twitter card image of its own: it would be the same capture at the same
  // size, and a second copy is one more thing to forget when the screens change.
  robots: { index: true, follow: true },
}

export const viewport: Viewport = { width: 'device-width', initialScale: 1 }

export default function EnglishLayout({ children }: { children: ReactNode }) {
  return <Document lang="en">{children}</Document>
}
