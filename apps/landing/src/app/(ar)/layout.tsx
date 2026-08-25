import type { Metadata, Viewport } from 'next'
import type { ReactNode } from 'react'
import { Document } from '@/components/Document'

/**
 * The Arabic root layout. Its description is written rather than translated —
 * it leads with the two words an Arabic-speaking forwarder searches for.
 */

export const metadata: Metadata = {
  metadataBase: new URL('https://cargosharks.com'),
  title: 'CargoSharks — نظام لشركات الشحن والتخليص في الخليج',
  description:
    'من الاستفسار إلى الفاتورة المسدَّدة في سجل واحد، لشركات الشحن والتخليص في الكويت والخليج. بحري وجوي وبري وسككي وبريد سريع، بالعربية والإنجليزية.',
  alternates: { canonical: '/ar/', languages: { en: '/' } },
  openGraph: {
    type: 'website',
    locale: 'ar',
    alternateLocale: 'en',
    siteName: 'CargoSharks',
    title: 'CargoSharks — نظام لشركات الشحن والتخليص في الخليج',
    description:
      'عرض السعر والترسية والمراحل والتخليص والمستندات والتكاليف والفاتورة على سجل واحد.',
    images: [{ url: '/pic/screens/app-dashboard-ar.webp', width: 2360, height: 1476 }],
  },
  robots: { index: true, follow: true },
}

export const viewport: Viewport = { width: 'device-width', initialScale: 1 }

export default function ArabicLayout({ children }: { children: ReactNode }) {
  return <Document lang="ar">{children}</Document>
}
