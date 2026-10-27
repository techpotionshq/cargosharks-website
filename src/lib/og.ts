import type { Metadata } from 'next'
import type { Lang } from '@/content/copy'

/**
 * A page's own Open Graph block.
 *
 * Next merges `metadata` per top-level key, so a page that sets a title but no
 * `openGraph` inherits the layout's whole block — the home page's title,
 * description and URL. `/compare/` and `/what-we-do/` were previewing as the
 * home page when shared. Every page that is not the home page calls this.
 */
export function pageOpenGraph({
  path,
  title,
  description,
  lang = 'en',
  type = 'website',
}: {
  path: string
  title: string
  description: string
  lang?: Lang
  type?: 'website' | 'article'
}): NonNullable<Metadata['openGraph']> {
  return {
    type,
    locale: lang,
    siteName: 'CargoSharks',
    title,
    description,
    url: path,
    images: [
      {
        url:
          lang === 'ar' ? '/pic/screens/app-dashboard-ar.webp' : '/pic/screens/app-dashboard.webp',
        width: 2360,
        height: 1476,
      },
    ],
  }
}
