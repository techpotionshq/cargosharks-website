import { Bilingual } from '@/components/Bilingual'
import { Calculator } from '@/components/Calculator'
import { Cta } from '@/components/Cta'
import { Desks } from '@/components/Desks'
import { Faq } from '@/components/Faq'
import { Footer } from '@/components/Footer'
import { Header } from '@/components/Header'
import { Hero } from '@/components/Hero'
import { Leak } from '@/components/Leak'
import { Pains } from '@/components/Pains'
import { Pilot } from '@/components/Pilot'
import { SiteSchema } from '@/components/StructuredData'
import { Versus } from '@/components/Versus'
import { Wordmark } from '@/components/Wordmark'
import type { Lang } from '@/content/copy'

/**
 * Ten blocks, in this order, in both languages.
 *
 * The order is a sales conversation: what it is and the two ways to try it
 * (Hero), the problem in the reader's own terms (Pains), how each desk works
 * with its screen beside it (Desks), the same desk before and after (Versus),
 * the one cost every forwarder argues about (Leak) and their own figure for it
 * (Calculator), the objection an Arabic-speaking buyer arrives with
 * (Bilingual), the offer (Pilot), the questions left over (Faq), and the two
 * things to do (Cta).
 *
 * The page it replaced was eight centred blocks of heading and grey paragraph,
 * written as observations about the software rather than as answers to a
 * buyer. Each block was well made and the page still read as one block eight
 * times; alternating layouts, light and dark, is what gives a reader somewhere
 * to land.
 *
 * Dark bands are kept for the three places the page changes register: the
 * opening, the money, and the close.
 *
 * `Wordmark` is rendered here and passed down rather than imported by `Header`,
 * which is a client component: passing it as a child keeps `@qabandi/brand` out
 * of the client bundle entirely, which is the property that makes a re-skin a
 * rebuild of nothing but the tokens.
 */
export function Site({ lang }: { lang: Lang }) {
  // The Arabic captures are separate files, not the English ones mirrored: the
  // sidebar crop is a logical property and takes its bite out of the wrong edge
  // when a left-to-right capture is shown in a right-to-left document.
  const suffix = lang === 'ar' ? '-ar' : ''

  return (
    <>
      <SiteSchema lang={lang} />
      {/* The bar is dark at every scroll position, so it takes the light-on-dark
          lockup and only that one. It is rendered here rather than inside
          `Header` because `Wordmark` calls `resolveBrand()`, and a client
          component importing that would pull `@qabandi/brand` into the browser
          bundle. */}
      <Header lang={lang} mark={<Wordmark tone="onDark" height={24} />} />
      <main>
        <Hero lang={lang} shot={`app-dashboard${suffix}`} />
        <Pains lang={lang} />
        <Desks lang={lang} shotSuffix={suffix} />
        <Versus lang={lang} />
        <Leak lang={lang} />
        <Calculator lang={lang} />
        <Bilingual lang={lang} />
        <Pilot lang={lang} />
        <Faq lang={lang} />
        <Cta lang={lang} />
      </main>
      <Footer lang={lang} mark={<Wordmark tone="onDark" height={26} />} />
    </>
  )
}
