import type { ReactNode } from 'react'
import { resolveBrand } from '@/brand'
import { footer, hrefFor, type Lang, languageSwitch } from '@/content/copy'
import { solutionNav, solutionPath } from '@/content/solution-nav'
import { EmailLink } from './Email'

/**
 * The footer.
 *
 * **It is the one place every landing page is linked from every page.** The
 * header's panels list the market and job pages, but a panel only renders on
 * hover, so the server HTML of the home page linked to none of the eleven
 * pages written to rank; they sat three clicks deep, reachable only from each
 * other and from blog posts. Two columns built from `solutionNav` fix that for
 * every page at once, in the reader's language.
 *
 * Legal and the language switch moved to the bottom bar: they are found by
 * people looking for them and do not need a column's worth of attention.
 *
 * Dark, because a light footer under a dark band reads as a second page
 * beginning.
 */
const SOLUTION_HEADINGS = {
  market: { en: 'By market', ar: 'حسب السوق' },
  job: { en: 'By job', ar: 'حسب المهمة' },
} as const

export function Footer({
  lang,
  mark,
  alternate,
}: {
  lang: Lang
  mark: ReactNode
  /** This page's twin in the other language; the other home page when absent. */
  alternate?: string
}) {
  const brand = resolveBrand()
  const other = { ...languageSwitch[lang], ...(alternate ? { href: alternate } : {}) }
  const year = brand.identity.established
  const [product, compare, legal] = footer.columns

  const heading = 'text-label font-medium text-on-void'
  const linkClass = 'text-small text-on-void-dim transition-colors hover:text-on-void'

  return (
    <footer className="border-t border-void-line bg-void-lift pt-14 pb-8">
      <div className="shell grid gap-x-8 gap-y-10 sm:grid-cols-2 lg:grid-cols-12">
        <div className="sm:col-span-2 lg:col-span-3">
          {mark}
          <p className="mt-5 max-w-[32ch] text-small text-on-void-faint">{footer.note[lang]}</p>
          <EmailLink className="mt-4 inline-block text-small text-blue-lit hover:underline" />
        </div>

        {(['market', 'job'] as const).map((group) => (
          <nav
            key={group}
            aria-label={SOLUTION_HEADINGS[group][lang]}
            className={group === 'job' ? 'lg:col-span-3' : 'lg:col-span-2'}
          >
            <p className={heading}>{SOLUTION_HEADINGS[group][lang]}</p>
            <ul className="mt-4 space-y-2.5">
              {solutionNav
                .filter((item) => item.group === group)
                .map((item) => (
                  <li key={item.slug}>
                    <a href={solutionPath(item.slug, lang)} className={linkClass}>
                      {item.label[lang]}
                    </a>
                  </li>
                ))}
            </ul>
          </nav>
        ))}

        {[product, compare].map((column) =>
          column ? (
            <nav
              key={column.heading.en}
              aria-label={column.heading[lang]}
              className="lg:col-span-2"
            >
              <p className={heading}>{column.heading[lang]}</p>
              <ul className="mt-4 space-y-2.5">
                {column.links.map((link) => (
                  <li key={link.label.en}>
                    <a href={hrefFor(link, lang)} className={linkClass}>
                      {link.label[lang]}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
          ) : null,
        )}
      </div>

      <div className="shell mt-12">
        <div className="flex flex-col gap-4 border-t border-void-line pt-6 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-label text-on-void-faint">
            © {year} {brand.identity.legalNameEn}. {footer.rights[lang]}
          </p>
          <ul className="flex flex-wrap items-center gap-x-5 gap-y-2">
            {legal?.links.map((link) => (
              <li key={link.label.en}>
                <a
                  href={hrefFor(link, lang)}
                  className="text-label text-on-void-faint transition-colors hover:text-on-void"
                >
                  {link.label[lang]}
                </a>
              </li>
            ))}
            <li>
              <a
                href={other.href}
                hrefLang={other.hrefLang}
                lang={other.hrefLang}
                className="text-label text-on-void-dim transition-colors hover:text-on-void"
              >
                {other.label}
              </a>
            </li>
          </ul>
        </div>
      </div>
    </footer>
  )
}
