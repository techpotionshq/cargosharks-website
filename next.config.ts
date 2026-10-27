import { withPayload } from '@payloadcms/next/withPayload'
import type { NextConfig } from 'next'

/**
 * A server, not a static export, since the blog moved into a CMS.
 *
 * Every marketing page still prerenders at build time and is served as a file;
 * only the blog, the admin and the routes that list posts read the database,
 * and they cache what they read until a publish says otherwise
 * (`src/lib/blog.ts`). `standalone` traces just what the server needs into
 * `.next/standalone`, which is what the Dockerfile copies.
 *
 * `images.unoptimized` stays: every image is already a WebP encoded at twice
 * its display width, and Payload re-encodes uploads to WebP once.
 */
const config: NextConfig = {
  output: 'standalone',
  reactStrictMode: true,
  poweredByHeader: false,
  images: { unoptimized: true },
  // `/ar/` rather than `/ar`, as the static site always answered.
  trailingSlash: true,
  async redirects() {
    // The legacy `.html` addresses the site had before it was a Next app,
    // which `scripts/preview.mjs` used to 301. `/privacy.html` and the other
    // hand-written pages in `public/` are real files and are served as such.
    return [{ source: '/index.html', destination: '/', permanent: true }]
  },
}

export default withPayload(config)
