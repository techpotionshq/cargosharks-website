import { Bilingual } from '@/components/Bilingual'
import { Calculator } from '@/components/Calculator'
import { Capabilities } from '@/components/Capabilities'
import { Cta } from '@/components/Cta'
import { Footer } from '@/components/Footer'
import { Header } from '@/components/Header'
import { Hero } from '@/components/Hero'
import { Leak } from '@/components/Leak'
import { Modes } from '@/components/Modes'
import { Work } from '@/components/Work'
import { Wordmark } from '@/components/Wordmark'
import type { Lang } from '@/content/copy'

/**
 * Eight blocks, in this order, in both languages.
 *
 * The order is an argument: what it is (Hero), who it is for and one checkable
 * fact (Modes), how it works (Work), what is inside it (Capabilities), what it
 * is worth in your own numbers (Calculator), what that looks like as a document
 * (Leak), the objection an Arabic-speaking buyer arrives with (Bilingual), and
 * the one thing to do (Cta).
 *
 * **The rhythm is light, light, light, dark, light, dark.** That is a
 * composition decision rather than a styling one, and it is the one the rebuild
 * turned on: the page was near-black end to end, which left it with no way to
 * say *this part is different* — every section had to shout to be distinguished
 * from the one above it, and the shouting is what made it read as generated.
 * Three dark bands on paper, each one carrying a photograph and each one placed
 * where the argument changes register, do the same job silently.
 *
 * `Calculator` is the only section a reader operates, and it is deliberately at
 * the middle: it is the point where somebody who is still reading stops being
 * an audience.
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
      {/* The header floats over a dark hero and a dark footer alike and carries
          its own dark surface everywhere in between, so the lockup is the
          light-on-dark artwork at every scroll position. */}
      <Header lang={lang} mark={<Wordmark tone="onDark" height={24} />} />
      <main>
        <Hero lang={lang} shot={`app-dashboard${suffix}`} />
        <Modes lang={lang} />
        <Work lang={lang} shotSuffix={suffix} />
        <Capabilities lang={lang} />
        <Calculator lang={lang} />
        <Leak lang={lang} />
        <Bilingual lang={lang} />
        <Cta lang={lang} />
      </main>
      <Footer lang={lang} mark={<Wordmark tone="onDark" height={26} />} />
    </>
  )
}
