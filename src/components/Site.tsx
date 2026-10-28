import { Bilingual } from '@/components/Bilingual'
import { Calculator } from '@/components/Calculator'
import { Capabilities } from '@/components/Capabilities'
import { EInvoicing } from '@/components/EInvoicing'
import { Enquiry } from '@/components/Enquiry'
import { Footer } from '@/components/Footer'
import { Header } from '@/components/Header'
import { SiteSchema } from '@/components/StructuredData'
import { Hero } from '@/components/Hero'
import { Leak } from '@/components/Leak'
import { Markets } from '@/components/Markets'
import { Modes } from '@/components/Modes'
import { Work } from '@/components/Work'
import { Wordmark } from '@/components/Wordmark'
import type { Lang } from '@/content/copy'

/**
 * Ten blocks, in this order, in both languages.
 *
 * The order is an argument: what it is (Hero), one checkable fact (Modes), the
 * question every Gulf buyer now asks first (EInvoicing), how it works (Work),
 * what is inside it (Capabilities), what it is worth in your own numbers
 * (Calculator), what that looks like as a document (Leak), the objection an
 * Arabic-speaking buyer arrives with (Bilingual), where it is set up for
 * (Markets), and the one thing to do (Enquiry).
 *
 * E-invoicing sits second because it is what the market is shopping for:
 * ZATCA Phase 2 in Saudi Arabia and the UAE's mandate are why forwarders are
 * replacing systems this year, and a reader who has to scroll to the sixth
 * section to learn it is covered has usually left by the third.
 *
 * Sections are separated by hairlines and 64 to 96px of padding rather than
 * 224px of air, and two dark bands carry photographs where the argument
 * changes register. `Markets` is there for readers and for crawlers both: it
 * is the home page's only server-rendered link to the market and job pages.
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
        <Modes lang={lang} />
        <EInvoicing lang={lang} />
        <Work lang={lang} shotSuffix={suffix} />
        <Capabilities lang={lang} />
        <Calculator lang={lang} />
        <Leak lang={lang} />
        <Bilingual lang={lang} />
        <Markets lang={lang} />
        <Enquiry lang={lang} />
      </main>
      <Footer lang={lang} mark={<Wordmark tone="onDark" height={26} />} />
    </>
  )
}
