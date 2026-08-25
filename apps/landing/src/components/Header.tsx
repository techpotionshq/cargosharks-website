'use client'

import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { List, X } from '@phosphor-icons/react/dist/ssr'
import { DEMO_URL, type Lang, languageSwitch, nav } from '@/content/copy'

/**
 * A bar that floats clear of the top edge rather than sitting on it.
 *
 * The old header was pinned edge to edge and transparent over the hero, which
 * is the arrangement every page has, and it forced an unhappy compromise: the
 * hero's photograph runs under it, so the nav had to be white to be legible
 * there — and then a white nav over the light sections below was unreadable
 * and the bar had to acquire a background on scroll, which is a whole
 * mechanism to work around a decision.
 *
 * Detached, it is its own object. It has a surface of its own at every scroll
 * position, so the nav is one colour on the whole page, there is no state to
 * manage and no flash at the moment the background appears. It also reads as
 * an instrument laid on the page rather than as browser chrome, which is the
 * single cheapest way to make a site look designed rather than generated —
 * Terminal's does exactly this and it is the first thing you notice.
 *
 * The labels on the two buttons are mono, uppercase and small. That is this
 * repository's own convention for a label — `.tracked` is used on every eyebrow
 * in the product — so the site and the software agree, and it is the detail
 * that stops a pair of buttons looking like a template's pair of buttons.
 */
export function Header({ lang, mark }: { lang: Lang; mark: ReactNode }) {
  const [open, setOpen] = useState(false)
  const other = languageSwitch[lang]

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
    <header className="pointer-events-none fixed inset-x-0 top-0 z-50 pt-3 sm:pt-4">
      <div className="shell-wide">
        <div className="pointer-events-auto mx-auto flex max-w-[64rem] items-center justify-between gap-4 rounded-xl border border-void-line bg-void/85 py-2.5 pe-2.5 ps-5 shadow-xl backdrop-blur-xl">
          <a
            href={lang === 'ar' ? '/ar/' : '/'}
            className="shrink-0 transition-opacity hover:opacity-70"
          >
            {mark}
          </a>

          <nav className="hidden items-center gap-1 md:flex">
            {nav.map((item) => (
              <a
                key={item.href}
                href={item.href}
                className="rounded-lg px-3.5 py-2 text-[0.875rem] text-on-void-dim transition-colors hover:bg-void-lift hover:text-on-void"
              >
                {item.label[lang]}
              </a>
            ))}
          </nav>

          <div className="flex items-center gap-2">
            <a
              href={other.href}
              hrefLang={other.hrefLang}
              lang={other.hrefLang}
              className={`rounded-lg border border-void-line px-3 py-2 text-[0.8rem] text-on-void-dim transition-colors hover:text-on-void ${
                lang === 'en' ? 'arabic' : ''
              }`}
            >
              {other.label}
            </a>

            <a
              href={DEMO_URL}
              className="tracked hidden rounded-lg bg-blue px-4 py-2.5 text-[0.6rem] leading-none text-on-brand transition-opacity hover:opacity-90 sm:block"
            >
              {lang === 'ar' ? 'النسخة التجريبية' : 'Live demo'}
            </a>

            <button
              type="button"
              onClick={() => setOpen((was) => !was)}
              aria-expanded={open}
              aria-label={
                open
                  ? lang === 'ar'
                    ? 'إغلاق القائمة'
                    : 'Close menu'
                  : lang === 'ar'
                    ? 'فتح القائمة'
                    : 'Open menu'
              }
              className="flex size-9 items-center justify-center rounded-lg border border-void-line text-on-void-dim transition-colors hover:text-on-void md:hidden"
            >
              {open ? <X weight="bold" className="size-4" /> : <List weight="bold" className="size-4" />}
            </button>
          </div>
        </div>

        {open ? (
          <nav className="pointer-events-auto mx-auto mt-2 flex max-w-[64rem] flex-col rounded-xl border border-void-line bg-void/95 p-3 shadow-xl backdrop-blur-xl md:hidden">
            {nav.map((item) => (
              <a
                key={item.href}
                href={item.href}
                onClick={() => setOpen(false)}
                className="rounded-lg px-3 py-3.5 text-[1rem] text-on-void-dim transition-colors hover:bg-void-lift hover:text-on-void"
              >
                {item.label[lang]}
              </a>
            ))}
            <a
              href={DEMO_URL}
              onClick={() => setOpen(false)}
              className="tracked mt-2 rounded-lg bg-blue px-4 py-3.5 text-center text-[0.62rem] text-on-brand"
            >
              {lang === 'ar' ? 'افتحوا النسخة التجريبية' : 'Open the live demo'}
            </a>
          </nav>
        ) : null}
      </div>
    </header>
  )
}
