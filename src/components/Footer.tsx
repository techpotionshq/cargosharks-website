import type { ReactNode } from 'react'
import { resolveBrand } from '@qabandi/brand'
import { CONTACT_EMAIL, footer, type Lang, languageSwitch } from '@/content/copy'

/**
 * The footer.
 *
 * It used to end with a line naming what the product does not do yet. The
 * reasoning was that a page of nothing but claims reads as marketing, and that
 * naming your own gaps buys the rest of it credit. The reasoning is not wrong,
 * but the placement was: the last thing a visitor read on the home page was a
 * list of missing features, which is a strange note to close a sales page on.
 * That argument now lives where somebody has chosen to go and look for it —
 * `/compare/` §02 "Who this is not for" and `/what-we-do/` §07 "The boundary".
 *
 * Dark, because the close above it is dark and a light footer under a dark
 * close would read as a second page beginning.
 */
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

  return (
    <footer className="border-t border-void-line bg-void-lift py-16">
      <div className="shell grid gap-12 lg:grid-cols-12 lg:gap-x-14">
        <div className="lg:col-span-5">
          {mark}
          <p className="mt-6 max-w-[34ch] text-[0.9375rem] leading-[1.7] text-on-void-faint">
            {footer.note[lang]}
          </p>
          <a
            href={`mailto:${CONTACT_EMAIL}`}
            className="mt-5 inline-block font-mono text-[0.85rem] text-blue-lit hover:underline"
          >
            {CONTACT_EMAIL}
          </a>
        </div>

        {footer.columns.map((column) => (
          <nav key={column.heading.en} className="lg:col-span-2">
            <p className="tracked text-[0.58rem] text-on-void-faint">{column.heading[lang]}</p>
            <ul className="mt-5 space-y-3">
              {column.links.map((link) => (
                <li key={link.href}>
                  <a
                    href={link.href}
                    className="text-[0.9375rem] text-on-void-dim transition-colors hover:text-on-void"
                  >
                    {link.label[lang]}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        ))}

        <div className="lg:col-span-3">
          <p className="tracked text-[0.58rem] text-on-void-faint">
            {lang === 'ar' ? 'اللغة' : 'Language'}
          </p>
          <a
            href={other.href}
            hrefLang={other.hrefLang}
            lang={other.hrefLang}
            className="mt-5 inline-block text-[0.9375rem] text-on-void-dim transition-colors hover:text-on-void"
          >
            {other.label}
          </a>
        </div>
      </div>

      <div className="shell mt-14">
        <div className="rule-dark" />
        <p className="mt-7 font-mono text-[0.75rem] text-on-void-faint">
          © {year} {brand.identity.legalNameEn}. {footer.rights[lang]}
        </p>
      </div>
    </footer>
  )
}
