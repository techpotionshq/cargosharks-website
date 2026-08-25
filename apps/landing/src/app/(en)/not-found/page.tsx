import type { Metadata } from 'next'
import { Wordmark } from '@/components/Wordmark'
import { CONTACT_EMAIL, navLinks } from '@/content/copy'

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
 * So it is an ordinary page, and `scripts/postbuild.mjs` copies its output over
 * `out/404.html`, the filename every static host looks for. The route is
 * `/not-found/` rather than `/404/` because Next reserves the latter: a folder
 * named `404` is silently dropped from the route table and the built-in page
 * is emitted in its place, which looks exactly like this working until you
 * open the file.
 */
export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col justify-between py-10">
      <div className="shell">
        <a href="/" aria-label="CargoSharks">
          <Wordmark />
        </a>
      </div>

      <div className="shell">
        <p className="tracked text-[0.62rem] text-blue-ink">404</p>

        <h1 className="mt-6 font-display text-[clamp(2rem,4.4vw,3.2rem)] font-medium leading-[1.12] tracking-[-0.02em]">
          This page is not here.
        </h1>
        <div className="arabic-block mt-4">
          <h2
            lang="ar"
            dir="rtl"
            className="arabic text-[clamp(1.5rem,3vw,2.1rem)] font-medium leading-[1.4] text-ink-dim"
          >
            هذه الصفحة غير موجودة.
          </h2>
        </div>

        <p className="mt-8 max-w-[46ch] text-[1.0625rem] leading-[1.7] text-ink-dim">
          The address was wrong, or what was here has moved. Nothing on this site is deleted
          without a redirect, so a link that used to work still does.
        </p>
        <div className="arabic-block mt-4">
          <p lang="ar" dir="rtl" className="arabic text-[1.0625rem] leading-[1.9] text-ink-faint">
            العنوان غير صحيح، أو أن ما كان هنا قد انتقل. ولا يُحذف من هذا الموقع شيء دون تحويل،
            فالرابط الذي كان يعمل ما زال يعمل.
          </p>
        </div>

        <nav className="mt-10 flex flex-wrap items-center gap-x-8 gap-y-3">
          <a
            href="/"
            className="tracked rounded-lg bg-blue px-6 py-4 text-[0.66rem] leading-none text-on-brand transition-opacity hover:opacity-90"
          >
            The home page
          </a>
          {navLinks.map((item) => (
            <a
              key={item.href}
              href={item.href}
              className="text-[0.95rem] text-ink-dim underline-offset-4 transition-colors hover:text-ink hover:underline"
            >
              {item.label.en}
            </a>
          ))}
          <a
            href="/ar/"
            hrefLang="ar"
            lang="ar"
            className="arabic text-[0.95rem] text-ink-dim underline-offset-4 transition-colors hover:text-ink hover:underline"
          >
            العربية
          </a>
        </nav>
      </div>

      <div className="shell">
        <p className="text-[0.8125rem] text-ink-faint">
          Certain the address was right?{' '}
          <a href={`mailto:${CONTACT_EMAIL}`} className="font-mono text-blue-ink hover:underline">
            {CONTACT_EMAIL}
          </a>
        </p>
      </div>
    </main>
  )
}
