import type { MetadataRoute } from 'next'
import { SITE_URL } from '@/components/StructuredData'

/**
 * `robots.txt`, and it is short because there is nothing to hide.
 *
 * Every page on this site is a static file meant to be read by anybody. There
 * is no account area, no search results to keep out of an index, and no
 * parameterised URL that would let a crawler generate work for itself — so the
 * honest robots file is "all of it, yes", and the only line that earns its
 * place is the pointer to the sitemap.
 *
 * **The error routes are the one exclusion.** `/not-found/` and
 * `/server-error/` exist as real routes because Next reserves a folder called
 * `404` and drops it from the route table silently; `postbuild.mjs` copies
 * their output over `404.html` and `500.html`. That leaves the originals
 * addressable, and a crawler that indexes `/not-found/` puts a page reading
 * "This page is not here" into results under the site's name. They are also
 * `noindex` in their own metadata — this is the belt to that pair of braces,
 * because the two mechanisms fail differently.
 */
/**
 * `force-static`, and it is required rather than an optimisation.
 *
 * A metadata route is a Route Handler, and Next treats one as dynamic unless it
 * is told otherwise — so under `output: 'export'` the build stops with "export
 * const dynamic = force-static not configured". It is also simply true here:
 * nothing in this file reads a request, and the one value that is not a literal
 * is the build date.
 */
export const dynamic = 'force-static'

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/not-found/', '/server-error/'],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  }
}
