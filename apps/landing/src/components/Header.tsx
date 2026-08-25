'use client'

import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { List, X } from '@phosphor-icons/react/dist/ssr'
import { DEMO_URL, type Lang, languageSwitch, nav } from '@/content/copy'

/**
 * The header is transparent over the hero and solid past it.
 *
 * It has to be transparent at the top: the hero's light runs up behind it and a
 * bar with its own background would cut the composition in half two hundred
 * pixels from the top of the page. It has to be solid after that, or the mono
 * nav sits unreadably on a white product screenshot.
 *
 * **The nav is centred and the actions are not.** Three groups — mark, links,
 * actions — with the links absolutely centred on the viewport rather than
 * sitting in the middle of a flex row. In a flex row the links' position is a
 * function of how wide the two outer groups happen to be, and the two outer
 * groups are different widths in Arabic than in English, so the nav landed in a
 * visibly different place on each page. Absolute centring makes it the same
 * place in both, which is the property that makes the language switch feel like
 * a switch rather than a redirect.
 *
 * The mobile menu is new. Below `md` the links simply were not rendered, so a
 * phone visitor had no route to `/what-we-do/` or `/compare/` from the home
 * page at all — the two pages the footer sends them to and the nav promised.
 */
export function Header({ lang, mark }: { lang: Lang; mark: ReactNode }) {
  const [stuck, setStuck] = useState(false)
  const [open, setOpen] = useState(false)
  const other = languageSwitch[lang]

  useEffect(() => {
    const onScroll = () => setStuck(window.scrollY > 24)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  /**
   * The sheet closes on Escape and locks the page behind it.
   *
   * Without the lock the body scrolls under an open menu on iOS, which lands
   * the reader somewhere unrelated when they close it. Restoring the previous
   * value rather than clearing it: the doc pages set nothing, but assuming that
   * is how a scroll lock quietly breaks the next thing that does.
   */
  useEffect(() => {
    if (!open) return

    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)

    return () => {
      document.body.style.overflow = previous
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <header
      className={`fixed inset-x-0 top-0 z-50 transition-colors duration-300 ${
        stuck || open ? 'border-b border-edge bg-void/85 backdrop-blur-xl' : 'border-b border-transparent'
      }`}
    >
      {/* `.shell`, not `.shell-wide`, and this is load-bearing.
          The bar is shared with the five imported documents, whose every
          section measures from `.shell` — so a header on the wider measure put
          the lockup 72px outside the column of the page under it, and a reader
          clicking from here to `/what-we-do/` watched the logo step sideways.
          That is the exact fault `README.md` records the shared shell for. The
          product frames on the home page are wider than this on purpose; the
          header is chrome, and chrome aligns to the text. */}
      <div className="shell relative flex h-[4.5rem] items-center justify-between gap-6">
        <a
          href={lang === 'ar' ? '/ar/' : '/'}
          className="relative z-10 text-ink transition-opacity hover:opacity-70"
        >
          {mark}
        </a>

        <nav className="absolute inset-x-0 hidden items-center justify-center gap-1 md:flex">
          {nav.map((item) => (
            <a
              key={item.href}
              href={item.href}
              className="rounded-full px-4 py-2 text-[0.9rem] text-ink-dim transition-colors hover:bg-raise/60 hover:text-ink"
            >
              {item.label[lang]}
            </a>
          ))}
        </nav>

        <div className="relative z-10 flex items-center gap-2">
          <a
            href={other.href}
            hrefLang={other.hrefLang}
            lang={other.hrefLang}
            className={`rounded-full border border-edge-lit px-3.5 py-1.5 text-sm text-ink-dim transition-colors hover:border-ink-faint hover:text-ink ${
              lang === 'en' ? 'arabic' : ''
            }`}
          >
            {other.label}
          </a>

          <a
            href={DEMO_URL}
            className="hidden rounded-full bg-ink px-5 py-2 text-sm font-semibold text-void transition-transform hover:scale-[1.03] active:scale-100 sm:block"
          >
            {lang === 'ar' ? 'النسخة التجريبية' : 'Demo'}
          </a>

          <button
            type="button"
            onClick={() => setOpen((was) => !was)}
            aria-expanded={open}
            aria-label={open ? (lang === 'ar' ? 'إغلاق القائمة' : 'Close menu') : lang === 'ar' ? 'فتح القائمة' : 'Open menu'}
            className="flex size-9 items-center justify-center rounded-full border border-edge-lit text-ink-dim transition-colors hover:text-ink md:hidden"
          >
            {open ? <X weight="bold" className="size-4" /> : <List weight="bold" className="size-4" />}
          </button>
        </div>
      </div>

      {open ? (
        <div className="border-t border-edge bg-void/95 backdrop-blur-xl md:hidden">
          <nav className="shell flex flex-col py-4">
            {nav.map((item) => (
              <a
                key={item.href}
                href={item.href}
                onClick={() => setOpen(false)}
                className="border-b border-edge py-4 text-[1.05rem] text-ink-dim transition-colors hover:text-ink"
              >
                {item.label[lang]}
              </a>
            ))}
            <a
              href={DEMO_URL}
              onClick={() => setOpen(false)}
              className="mt-5 rounded-full bg-blue py-3.5 text-center text-[0.95rem] font-semibold text-on-brand"
            >
              {lang === 'ar' ? 'افتحوا النسخة التجريبية' : 'Open the live demo'}
            </a>
          </nav>
        </div>
      ) : null}
    </header>
  )
}
