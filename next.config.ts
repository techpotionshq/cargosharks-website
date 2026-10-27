import type { NextConfig } from 'next'

/**
 * The marketing site is a static export, and that is a deployment decision
 * rather than a technical one.
 *
 * Nothing here reads a database, a session or a request header — the page is
 * the same for everybody — so `output: 'export'` writes plain files to `out/`
 * and any static host serves them with no Node process to keep alive, no
 * runtime to patch and nothing that can be exploited. The seven legal and
 * marketing pages that predate this app stay in `public/` as hand-written
 * HTML and are copied through untouched, so `/privacy.html` resolves exactly
 * as it did before.
 *
 * `images.unoptimized` follows from the same choice: the optimiser is a server
 * route. Every image here is already a WebP encoded at twice its display width
 * by `docs/marketing/capture.mjs`, so there is nothing left for it to do.
 */
const config: NextConfig = {
  output: 'export',
  reactStrictMode: true,
  poweredByHeader: false,
  images: { unoptimized: true },
  // `/ar` rather than `/ar.html` — a directory index per route keeps the two
  // languages symmetrical and matches what the old static pair did with
  // `index.html` and `ar.html`.
  trailingSlash: true,
}

export default config
