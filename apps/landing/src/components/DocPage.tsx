import type { ReactNode } from 'react'
import { Footer } from '@/components/Footer'
import { Header } from '@/components/Header'
import { ToTop } from '@/components/ToTop'
import { Wordmark } from '@/components/Wordmark'
import type { Lang } from '@/content/copy'
import '@/app/pages.css'

/**
 * The frame around the five imported pages.
 *
 * They arrived as standalone HTML documents with their own header, their own
 * footer and their own copy of the scroll behaviour. All three are components
 * now, and the same components the home page uses — which is the point of
 * moving them in. Every one of the differences that used to have to be kept in
 * step by hand is gone: the nav labels, the lockup, the bar height, the shell
 * width, the language switch.
 *
 * `doc-page` is a scope, not a style. `pages.css` is the imported stylesheet
 * with every one of its selectors nested under it, so the two stylesheets on
 * this site cannot reach into each other — `globals.css` owns the app's own
 * routes and this one owns the imported markup, and both define `.shell`.
 */
export function DocPage({ lang, children }: { lang: Lang; children: ReactNode }) {
  return (
    <>
      {/* The same bar as the home page, and the same lockup. `Site` passes the
          identical pair; the two callers must agree, because it is one bar. */}
      <Header lang={lang} mark={<Wordmark tone="onDark" height={24} />} />
      <main id="top" className="doc-page">
        {children}
      </main>
      <Footer lang={lang} mark={<Wordmark tone="onDark" height={26} />} />
      <ToTop />
    </>
  )
}
