import type { Metadata } from 'next'
import { ArrowRight } from '@phosphor-icons/react/dist/ssr'
import { EmailLink } from '@/components/Email'
import { Footer } from '@/components/Footer'
import { Header } from '@/components/Header'
import { Wordmark } from '@/components/Wordmark'
import { Button } from '@/components/ui/button'
import { Section } from '@/components/ui/section'
import type { Lang } from '@/content/copy'

/**
 * `noindex` and no canonical: the group layout's metadata would otherwise give
 * every mistyped URL on the domain the home page's title and description, and
 * a search engine that indexes a 404 under the home page's name is a problem
 * that outlives whoever made the bad link.
 */
export const metadata: Metadata = {
  title: 'Not found — CargoSharks',
  description: 'The address was wrong, or what was here has moved.',
  robots: { index: false, follow: true },
  alternates: {},
}

/** The ways on, in each language, to that language's own pages. */
const WAYS: Record<Lang, { heading: string; links: { href: string; label: string }[] }> = {
  en: {
    heading: 'Where to go from here',
    links: [
      { href: '/', label: 'The home page' },
      {
        href: '/freight-forwarding-software-kuwait/',
        label: 'Freight forwarding software for Kuwait',
      },
      {
        href: '/freight-forwarding-software-uae/',
        label: 'Freight forwarding software for the UAE',
      },
      {
        href: '/freight-forwarding-software-saudi-arabia/',
        label: 'Freight forwarding software for Saudi Arabia',
      },
      { href: '/blog/', label: 'The blog' },
    ],
  },
  ar: {
    heading: 'إلى أين من هنا',
    links: [
      { href: '/ar/', label: 'الصفحة الرئيسية' },
      { href: '/ar/freight-forwarding-software-kuwait/', label: 'برنامج الشحن للكويت' },
      { href: '/ar/freight-forwarding-software-uae/', label: 'برنامج الشحن للإمارات' },
      { href: '/ar/freight-forwarding-software-saudi-arabia/', label: 'برنامج الشحن للسعودية' },
      { href: '/ar/blog/', label: 'المدونة' },
    ],
  },
}

/**
 * The 404, in both languages at once.
 *
 * Every other page on this site picks a language and commits to it, because a
 * visitor arrived on one or the other. Nobody arrives *here* on purpose: the
 * link that brought them was wrong, and it is as likely to have been an Arabic
 * link as an English one. Showing both is the only answer that does not guess,
 * and on the site whose argument is that Arabic is not an afterthought it is
 * also the only one that would not be embarrassing.
 *
 * **Why this is a route and not `not-found.tsx`.** Next's global not-found has
 * to sit at `app/not-found.tsx`, directly under a root layout — and this app
 * has no root layout, deliberately: the English and Arabic route groups each
 * carry their own so that `lang` and `dir` are real attributes on the document
 * rather than something JavaScript patches on after hydration. A
 * `not-found.tsx` inside one of those groups only ever answers for that group,
 * and the static export kept writing Next's built-in black-and-white 404 to
 * `out/404.html` instead.
 *
 * So it is an ordinary page, which `src/app/global-not-found.tsx` renders for
 * every URL that matches nothing. The route is
 * `/not-found/` rather than `/404/` because Next reserves the latter: a folder
 * named `404` is silently dropped from the route table and the built-in page
 * is emitted in its place, which looks exactly like this working until you
 * open the file.
 *
 * It wears the market pages' masthead and the shared bar and footer, so a
 * visitor who lands here has not visibly left the site.
 */
export default function NotFound() {
  return (
    <>
      <Header lang="en" alternate="/ar/" mark={<Wordmark tone="onDark" height={24} />} />
      <main id="top">
        <section className="bg-void pt-32 pb-16 text-on-void lg:pt-36 lg:pb-20">
          <div className="shell grid grid-cols-1 gap-8 lg:grid-cols-2 lg:gap-16">
            <div>
              <h1 className="max-w-[20ch] text-balance font-display text-display font-extrabold">
                This page is not here.
              </h1>
              <p className="mt-6 max-w-[48ch] text-lede text-on-void-dim">
                The address was wrong, or what was here has moved. Nothing on this site is deleted
                without a redirect, so a link that used to work still does.
              </p>
            </div>
            <div lang="ar" dir="rtl" className="arabic">
              <p className="max-w-[20ch] text-balance font-display text-h2 font-bold leading-[1.35]">
                هذه الصفحة غير موجودة.
              </p>
              <p className="mt-6 max-w-[48ch] text-lede leading-[1.9] text-on-void-dim">
                العنوان غير صحيح، أو أن ما كان هنا قد انتقل. ولا يُحذف من هذا الموقع شيء دون تحويل،
                فالرابط الذي كان يعمل ما زال يعمل.
              </p>
            </div>
          </div>
          <div className="shell mt-10 flex flex-wrap gap-3">
            <Button asChild size="lg">
              <a href="/#demo">Book a demo</a>
            </Button>
            <Button asChild size="lg" variant="onDark">
              <a href="/ar/#demo" lang="ar" className="arabic">
                احجزوا عرضاً تعريفياً
              </a>
            </Button>
          </div>
        </section>

        <Section space="tight">
          <div className="shell grid grid-cols-1 gap-10 md:grid-cols-2 md:gap-16">
            {(['en', 'ar'] as const).map((lang) => (
              <nav
                key={lang}
                aria-label={WAYS[lang].heading}
                lang={lang}
                dir={lang === 'ar' ? 'rtl' : 'ltr'}
                className={lang === 'ar' ? 'arabic min-w-0' : 'min-w-0'}
              >
                <h2 className="font-display text-h3 font-bold text-heading">
                  {WAYS[lang].heading}
                </h2>
                <ul className="mt-5 divide-y divide-line border-y border-line">
                  {WAYS[lang].links.map((link) => (
                    <li key={link.href}>
                      <a
                        href={link.href}
                        className="group flex min-h-12 items-center justify-between gap-4 py-3 text-body font-semibold text-ink transition-colors hover:text-blue-ink"
                      >
                        {link.label}
                        <ArrowRight
                          weight="bold"
                          className="size-4 shrink-0 text-ink-faint group-hover:text-blue-ink rtl:-scale-x-100"
                        />
                      </a>
                    </li>
                  ))}
                </ul>
              </nav>
            ))}
          </div>
          <p className="shell mt-10 text-small text-ink-dim">
            Certain the address was right? Tell us at{' '}
            <EmailLink className="text-blue-ink hover:underline" />.
          </p>
        </Section>
      </main>
      <Footer lang="en" alternate="/ar/" mark={<Wordmark tone="onDark" height={26} />} />
    </>
  )
}
