import type { MetadataRoute } from 'next'
import { comparisons } from '@/content/comparisons'
import { solutionNav, solutionPath } from '@/content/solution-nav'
import { SITE_URL } from '@/components/StructuredData'
import { allPosts, blogIndexAlternates, blogPath } from '@/lib/blog'

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
 * `/not-found/` and `/server-error/` are deliberately absent: a sitemap that
 * submits an error page is asking a crawler to index a dead end.
 */

/**
 * Per request, from the CMS's cached reads, so a published post is in the
 * sitemap at once. Next's own route-level revalidate is not used here: a
 * cached sitemap is how techpotions.com ended up submitting a stale one.
 */
export const dynamic = 'force-dynamic'

/**
 * The server's start date, to the day (it was the build date).
 *
 * `lastModified` is a hint rather than a fact, and a per-page git timestamp
 * would be a better one — but it would need the build to shell out to git,
 * which it does not otherwise do, and a crawler treats a whole-site date as
 * weakly as it deserves. To the day rather than the second so that two builds
 * on the same afternoon do not look like two edits.
 */
const BUILT = new Date().toISOString().slice(0, 10)

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const all = await allPosts()
  const blogLanguages = await blogIndexAlternates(SITE_URL)
  const postsIn = (lang: 'en' | 'ar') => all.filter((post) => post[lang])
  const home = {
    url: `${SITE_URL}/`,
    lastModified: BUILT,
    changeFrequency: 'weekly' as const,
    priority: 1,
    // The one page with an Arabic twin. `languages` emits `hreflang`
    // alternates, which is what stops a search engine treating `/` and `/ar/`
    // as two pages competing for the same query.
    alternates: {
      languages: { en: `${SITE_URL}/`, ar: `${SITE_URL}/ar/`, 'x-default': `${SITE_URL}/` },
    },
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
      alternates: { languages: { ...languages, 'x-default': languages.en } },
    }))
  })

  // The blog: the two indexes, then each post in every language it is written
  // in. A post in one language only gets no alternates — an hreflang pointing
  // at a page that does not exist is worse than none. Each index waits for its
  // language's first post: an empty listing is a thin page, and it is noindex
  // until then (`blogIndexMetadata`).
  const blogIndex = (['en', 'ar'] as const)
    .filter((lang) => postsIn(lang).length)
    .map((lang) => ({
      url: `${SITE_URL}${blogPath(lang)}`,
      lastModified: postsIn(lang)[0]?.publishedAt ?? BUILT,
      changeFrequency: 'weekly' as const,
      priority: 0.6,
      alternates: { languages: blogLanguages },
    }))

  const posts = all.flatMap((post) => {
    const langs = (['en', 'ar'] as const).filter((lang) => post[lang])
    const url = (lang: 'en' | 'ar') => `${SITE_URL}${blogPath(lang, post.slug)}`
    const languages = Object.fromEntries(langs.map((lang) => [lang, url(lang)]))
    return langs.map((lang) => ({
      url: url(lang),
      lastModified: post.updatedAt ?? post.publishedAt,
      changeFrequency: 'monthly' as const,
      priority: 0.6,
      ...(langs.length > 1
        ? { alternates: { languages: { ...languages, 'x-default': url('en') } } }
        : {}),
    }))
  })

  return [home, ...pages, ...compare, ...landing, ...blogIndex, ...posts]
}
