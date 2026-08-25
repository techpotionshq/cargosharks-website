import { Bilingual } from '@/components/Bilingual'
import { Cta } from '@/components/Cta'
import { Footer } from '@/components/Footer'
import { Header } from '@/components/Header'
import { Hero } from '@/components/Hero'
import { Leak } from '@/components/Leak'
import { Proof } from '@/components/Proof'
import { Work } from '@/components/Work'
import { Wordmark } from '@/components/Wordmark'
import type { Lang } from '@/content/copy'

/**
 * Six blocks, in this order, in both languages.
 *
 * The page this replaces had eleven sections and ran to fourteen thousand
 * pixels. The count is the point: a reader deciding whether to book a demo is
 * not reading section nine, so section nine was costing the page attention
 * rather than adding to it. What was cut is not gone — the pain points, the
 * scope table, the security detail and the FAQ moved to `what-we-do.html` and
 * `compare.html`, where somebody who has already decided to keep reading can
 * find them.
 *
 * `Wordmark` is rendered here and passed down rather than imported by `Header`,
 * which is a client component: passing it as a child keeps `@qabandi/brand`
 * out of the client bundle entirely, which is the property that makes a
 * re-skin a rebuild of nothing but the tokens.
 */
export function Site({ lang }: { lang: Lang }) {
  // The Arabic captures are separate files, not the English ones mirrored: the
  // sidebar crop is a logical property and takes its bite out of the wrong edge
  // when a left-to-right capture is shown in a right-to-left document.
  const suffix = lang === 'ar' ? '-ar' : ''

  return (
    <>
      <Header lang={lang} mark={<Wordmark />} />
      <main>
        <Hero lang={lang} shot={`app-dashboard${suffix}`} />
        <Proof lang={lang} />
        <Work lang={lang} shotSuffix={suffix} />
        <Bilingual lang={lang} />
        <Leak lang={lang} />
        <Cta lang={lang} />
      </main>
      <Footer lang={lang} mark={<Wordmark height={26} />} />
    </>
  )
}
