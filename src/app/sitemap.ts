import type { MetadataRoute } from 'next'
import { comparisons } from '@/content/comparisons'
import { solutionNav, solutionPath } from '@/content/solution-nav'
import { SITE_URL } from '@/components/StructuredData'

/**
 * The sitemap, generated from the same lists the pages are.
 *
 * `output: 'export'` writes this to `out/sitemap.xml` at build time, so there is
 * no route to keep alive — the same deal as every other page here.
 *
 * **It is derived, not typed out.** A hand-maintained sitemap is a second list
 * of routes, and the failure is silent in the worst way: the page is live, the
 * sitemap does not mention it, and nobody finds out because nothing is broken.
 * The comparison pages come from `comparisons.ts`, which is the same array the
 * routes and the mega menu read, so a fifth comparison is one row and it appears
 * in all three.
 *
 * The landing pages come from `solution-nav.ts` on the same principle: the
 * list the header panel is built from is the list submitted here.
 *
 * The seven remaining routes are written down because they genuinely are a
 * hand-made list — Next's own route table is not readable at build time from
 * here, and inventing a filesystem walk to avoid seven strings would be more
 * machinery than the strings.
 *
 * `/not-found/` and `/server-error/` are deliberately absent: `postbuild.mjs`
 * copies them to `404.html` and `500.html`, and a sitemap that submits an error
 * page is asking a crawler to index a dead end.
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

/**
 * The build date, to the day.
 *
 * `lastModified` is a hint rather than a fact, and a per-page git timestamp
 * would be a better one — but it would need the build to shell out to git,
 * which it does not otherwise do, and a crawler treats a whole-site date as
 * weakly as it deserves. To the day rather than the second so that two builds
 * on the same afternoon do not look like two edits.
 */
const BUILT = new Date().toISOString().slice(0, 10)

export default function sitemap(): MetadataRoute.Sitemap {
  const home = {
    url: `${SITE_URL}/`,
    lastModified: BUILT,
    changeFrequency: 'weekly' as const,
    priority: 1,
    // The one page with an Arabic twin. `languages` emits `hreflang`
    // alternates, which is what stops a search engine treating `/` and `/ar/`
    // as two pages competing for the same query.
    alternates: { languages: { en: `${SITE_URL}/`, ar: `${SITE_URL}/ar/` } },
  }

  const pages = ['/what-we-do/', '/compare/', '/privacy/', '/terms/', '/dpa/'].map((path) => ({
    url: `${SITE_URL}${path}`,
    lastModified: BUILT,
    changeFrequency: 'monthly' as const,
    // `/what-we-do/` and `/compare/` are the two pages a stranger arrives on
    // from search; the three legal documents are linked, not marketed.
    priority: path === '/privacy/' || path === '/terms/' || path === '/dpa/' ? 0.3 : 0.8,
  }))

  const compare = comparisons.map((item) => ({
    url: `${SITE_URL}/compare/${item.slug}/`,
    lastModified: BUILT,
    changeFrequency: 'monthly' as const,
    priority: 0.7,
  }))

  // The landing pages, both languages. Each entry carries the pair as
  // `hreflang` alternates, the same arrangement as the home page, so `/x/` and
  // `/ar/x/` are one page in two languages rather than two pages competing.
  const landing = solutionNav.flatMap((item) => {
    const languages = {
      en: `${SITE_URL}${solutionPath(item.slug, 'en')}`,
      ar: `${SITE_URL}${solutionPath(item.slug, 'ar')}`,
    }
    return (['en', 'ar'] as const).map((lang) => ({
      url: languages[lang],
      lastModified: BUILT,
      changeFrequency: 'monthly' as const,
      priority: 0.7,
      alternates: { languages },
    }))
  })

  return [home, ...pages, ...compare, ...landing]
}
