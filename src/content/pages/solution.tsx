import type { Metadata } from 'next'
import { comparisons } from '@/content/comparisons'
import type { Bi, Lang } from '@/content/copy'
import { solution, solutionPath } from '@/content/solutions'

/**
 * Helpers for the landing pages in `solutions.ts`. The pages themselves render
 * through `components/SolutionPage.tsx`; what is left here is shared with the
 * routes: the metadata each route exports, and how a related link resolves.
 */

/** A related link resolves to a card: a solution row, a comparison row, or one of the overview pages. */
export function relatedCard(target: string, lang: Lang): { href: string; label: string; blurb: string } {
  if (!target.startsWith('/')) {
    const row = solution(target)
    return {
      href: solutionPath(row.slug, lang),
      label: row.nav.label[lang],
      blurb: row.nav.blurb[lang],
    }
  }

  const compared = comparisons.find((item) => `/compare/${item.slug}/` === target)
  if (compared) {
    return {
      href: target,
      label: lang === 'ar' ? `مقابل ${compared.name}` : `vs ${compared.name}`,
      blurb: compared.title[lang],
    }
  }

  // The overview pages have no Arabic twin; an Arabic reader is sent to the
  // English page, labelled in Arabic, which is what the header already does.
  const overview: Record<string, { label: Bi; blurb: Bi }> = {
    '/what-we-do/': {
      label: { en: 'What we do', ar: 'ماذا نفعل' },
      blurb: {
        en: 'The whole product, explained from the beginning',
        ar: 'المنتج كاملاً، مشروحاً من البداية (بالإنجليزية)',
      },
    },
    '/compare/': {
      label: { en: 'How we compare', ar: 'كيف نقارن' },
      blurb: {
        en: 'Three ways to run an operation, and who we are not for',
        ar: 'ثلاث طرق لإدارة العمل، ومن لسنا لهم (بالإنجليزية)',
      },
    },
  }
  const page = overview[target]
  if (!page) throw new Error(`Related link "${target}" is not a known page`)
  return { href: target, label: page.label[lang], blurb: page.blurb[lang] }
}

/**
 * Metadata for one landing page in one language, derived from its row.
 *
 * The comparison routes write theirs out as literals, which is fine for four
 * pages in one language. Twenty routes would be twenty copies of a title that
 * also lives in `solutions.ts`, and the copy in the `<head>` is the one nobody
 * looks at when the heading changes. So the route asks for it instead.
 *
 * Every page declares both languages under `alternates.languages`, which is
 * what emits the `hreflang` pair and stops `/x/` and `/ar/x/` competing for the
 * same query. `openGraph` is set in full because Next merges metadata
 * shallowly: a page that sets none inherits the layout's, and the layout's is
 * the home page's title.
 */
export function solutionMetadata(slug: string, lang: Lang): Metadata {
  const item = solution(slug)
  const path = solutionPath(slug, lang)
  const shot = item.shot
    ? `/pic/screens/${item.shot.file}${lang === 'ar' && !item.shot.noAr ? '-ar' : ''}.webp`
    : lang === 'ar'
      ? '/pic/screens/app-dashboard-ar.webp'
      : '/pic/screens/app-dashboard.webp'

  return {
    title: item.meta.title[lang],
    description: item.meta.description[lang],
    alternates: {
      canonical: path,
      languages: {
        en: solutionPath(slug, 'en'),
        ar: solutionPath(slug, 'ar'),
        'x-default': solutionPath(slug, 'en'),
      },
    },
    openGraph: {
      type: 'article',
      locale: lang,
      alternateLocale: lang === 'ar' ? 'en' : 'ar',
      siteName: 'CargoSharks',
      title: item.meta.title[lang],
      description: item.meta.description[lang],
      url: path,
      images: [{ url: shot }],
    },
  }
}
