import type { ReactNode } from 'react'
import { Footer } from '@/components/Footer'
import { Header } from '@/components/Header'
import { Wordmark } from '@/components/Wordmark'
import type { Lang } from '@/content/copy'

/**
 * The frame around a blog page: the shared bar and footer, and nothing of
 * `DocPage`.
 *
 * The blog used to sit inside `DocPage`, which scopes `pages.css` around its
 * children, so a post read in that stylesheet's older type and spacing while
 * the market pages beside it had moved to the design system. It renders the
 * header and footer directly now, the way `SolutionPage` does, and its own
 * prose styles live beside it in `post-body.css`.
 */
export function BlogFrame({
  lang,
  alternate,
  children,
}: {
  lang: Lang
  alternate: string
  children: ReactNode
}) {
  return (
    <>
      <Header lang={lang} alternate={alternate} mark={<Wordmark tone="onDark" height={24} />} />
      <main id="top" dir={lang === 'ar' ? 'rtl' : 'ltr'} className="bg-paper text-ink">
        {children}
      </main>
      <Footer lang={lang} alternate={alternate} mark={<Wordmark tone="onDark" height={26} />} />
    </>
  )
}

/**
 * The dark title block every blog page opens with, the same proportions as the
 * market pages' masthead so the header bar sits on its own colour.
 */
export function BlogMasthead({
  title,
  lede,
  before,
  after,
}: {
  title: string
  lede: string
  /** A line above the heading: the way back to the index on a post. */
  before?: ReactNode
  /** A line under the lede: the date and reading time on a post. */
  after?: ReactNode
}) {
  return (
    <section className="bg-void pt-32 pb-16 text-on-void lg:pt-36 lg:pb-20">
      <div className="shell">
        {before}
        <h1 className="max-w-[24ch] text-balance font-display text-display font-extrabold">
          {title}
        </h1>
        <p className="mt-6 max-w-[62ch] text-pretty text-lede text-on-void-dim">{lede}</p>
        {after}
      </div>
    </section>
  )
}
