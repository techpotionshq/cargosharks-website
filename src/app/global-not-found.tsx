import type { Metadata } from 'next'
import { Document } from '@/components/Document'
import NotFound, { metadata as notFound } from './(en)/not-found/page'

/**
 * Every URL that matches no route: the bilingual 404 in `(en)/not-found/`,
 * inside a full document.
 *
 * A static export wrote that page to `404.html` for the host to serve
 * (`scripts/postbuild.mjs`, gone with the export). A server needs Next's
 * global not-found instead, the one meant for apps with several root layouts
 * and no root `app/layout.tsx`, which is this one. It skips the layouts, so
 * the document is built here.
 */
export const metadata: Metadata = {
  ...notFound,
  metadataBase: new URL('https://cargosharks.com'),
}

export default function GlobalNotFound() {
  return (
    <Document lang="en">
      <NotFound />
    </Document>
  )
}
