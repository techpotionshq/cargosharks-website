'use client'

import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { DEMO_URL, type Lang, languageSwitch, nav } from '@/content/copy'

/**
 * The header is transparent over the hero and solid past it.
 *
 * It has to be transparent at the top: the hero's screenshot runs up behind it
 * and a bar with its own background would cut the composition in half two
 * hundred pixels from the top of the page. It has to be solid after that, or
 * the mono nav sits unreadably on a white product screenshot.
 */
export function Header({ lang, mark }: { lang: Lang; mark: ReactNode }) {
  const [stuck, setStuck] = useState(false)
  const other = languageSwitch[lang]

  useEffect(() => {
    const onScroll = () => setStuck(window.scrollY > 24)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <header
      className={`fixed inset-x-0 top-0 z-50 transition-colors duration-300 ${
        stuck ? 'border-b border-edge bg-void/85 backdrop-blur-xl' : 'border-b border-transparent'
      }`}
    >
      <div className="shell flex h-[4.5rem] items-center justify-between gap-6">
        <a href={lang === 'ar' ? '/ar/' : '/'} className="text-ink transition-opacity hover:opacity-70">
          {mark}
        </a>

        <div className="flex items-center gap-1 sm:gap-2">
          <nav className="hidden items-center md:flex">
            {nav.map((item) => (
              <a
                key={item.href}
                href={item.href}
                className="tracked px-3 py-2 text-[0.68rem] text-ink-dim transition-colors hover:text-ink"
              >
                {item.label[lang]}
              </a>
            ))}
          </nav>

          <a
            href={other.href}
            hrefLang={other.hrefLang}
            lang={other.hrefLang}
            className={`rounded-full border border-edge-lit px-3.5 py-1.5 text-sm text-ink-dim transition-colors hover:border-ink-faint hover:text-ink ${lang === 'en' ? 'arabic' : ''}`}
          >
            {other.label}
          </a>

          <a
            href={DEMO_URL}
            className="rounded-full bg-ink px-4 py-2 text-sm font-semibold text-void transition-transform hover:scale-[1.03] active:scale-100 sm:px-5"
          >
            {lang === 'ar' ? 'النسخة التجريبية' : 'Demo'}
          </a>
        </div>
      </div>
    </header>
  )
}
