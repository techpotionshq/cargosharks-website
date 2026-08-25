import { Bilingual } from '@/components/Bilingual'
import { Capabilities } from '@/components/Capabilities'
import { Cta } from '@/components/Cta'
import { Footer } from '@/components/Footer'
import { Header } from '@/components/Header'
import { Hero } from '@/components/Hero'
import { Leak } from '@/components/Leak'
import { Modes } from '@/components/Modes'
import { Proof } from '@/components/Proof'
import { Work } from '@/components/Work'
import { Wordmark } from '@/components/Wordmark'
import type { Lang } from '@/content/copy'

/**
 * Eight blocks, in this order, in both languages.
 *
 * It was six, and the count is still the point: the page this all replaces had
 * eleven sections and ran to fourteen thousand pixels, because a reader
 * deciding whether to book a demo is not reading section nine. What was cut
 * then is not gone — the pain points, the scope table, the security detail and
 * the FAQ live on `/what-we-do/` and `/compare/`, where somebody who has
 * already decided to keep reading can find them.
 *
 * Two were added back deliberately and neither is a section of prose.
 * `Modes` is one line naming the five transport modes, immediately under the
 * hero, because "is my mode one of them" is the first question a forwarder has
 * and the page used to answer it with a count in a stat band. `Capabilities`
 * is the grid that answers "does it hold my rate cards, does it print my
 * documents, can my branches see each other" — questions that were only
 * answered on a page nobody opens until after they have decided.
 *
 * The order is an argument: what it is (Hero), who it is for (Modes), whether
 * to believe it (Proof), how it works (Work), what is inside it (Capabilities),
 * what it does for you in money (Leak), the objection an Arabic-speaking buyer
 * arrives with (Bilingual), and the one thing to do (Cta).
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
        <Modes lang={lang} />
        <Proof lang={lang} />
        <Work lang={lang} shotSuffix={suffix} />
        <Capabilities lang={lang} />
        <Leak lang={lang} />
        <Bilingual lang={lang} />
        <Cta lang={lang} />
      </main>
      <Footer lang={lang} mark={<Wordmark height={26} />} />
    </>
  )
}
