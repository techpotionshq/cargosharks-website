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
  // The 404 for unmatched URLs (`src/app/global-not-found.tsx`): this app has
  // two root layouts and no `app/layout.tsx` to put a `not-found.tsx` under.
  experimental: { globalNotFound: true },
  // Read with `fs` at runtime, so invisible to the build's file tracer: the
  // generator's product facts, and the two covers the seed migration uploads.
  outputFileTracingIncludes: {
    '/**': ['./scripts/blog/product-facts.md', './public/blog/*.webp'],
  },
  async redirects() {
    // `/privacy.html` and the other hand-written pages in `public/` are real
    // files and are served as such; only the old index address redirects.
    return [{ source: '/index.html', destination: '/', permanent: true }]
  },
}

export default withPayload(config)
