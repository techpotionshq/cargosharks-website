'use client'

import { useEffect, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { usePathname } from 'next/navigation'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { ArrowRight, List, X } from '@phosphor-icons/react/dist/ssr'
import { DEMO_URL, type Lang, languageSwitch, nav } from '@/content/copy'

/**
 * Where the bar reads the page from.
 *
 * Roughly the vertical centre of the pill: `pt-4` plus half its height. It does
 * not need to be exact — it needs to be inside the bar and stable, so that the
 * flip happens as a band's edge passes behind the bar rather than before or
 * after it.
 */
const BASELINE_PX = 40

/**
 * Everything on the site that is dark behind the header.
 *
 * The app's own sections say so themselves with `data-tone="dark"`. The five
 * imported documents cannot: they are converted HTML that nobody hand-edits,
 * and adding an attribute to each dark band across five files is exactly the
 * per-file drift that moving them into components was meant to end. They are
 * matched by the two classes `pages.css` already uses — every one of those
 * documents opens on `.hero` and punctuates with `.band--navy`.
 */
const DARK_SELECTOR = '[data-tone="dark"], .doc-page .hero, .doc-page .band--navy'

/**
 * A bar that floats clear of the top edge, and inverts against whatever is
 * behind it.
 *
 * The old header was pinned edge to edge and transparent over the hero, which
 * forced an unhappy compromise: the hero photograph runs under it, so the nav
 * had to be white to be legible there — and a white nav over the light sections
 * below was unreadable, so the bar had to grow a background on scroll, which is
 * a mechanism built to work around a decision.
 *
 * Detached and inverting, it stops being a compromise and becomes a rule: **the
 * bar is always the opposite of what is behind it.** White pill with dark type
 * over the port photograph, dark pill with light type over the paper. It is
 * legible at every scroll position on all nine routes without a single
 * hand-tuned exception, and the flip itself is the most satisfying thing on the
 * page — one object turning over as a band passes behind it.
 *
 * **It is the same component on all nine routes.** `DocPage` renders this and
 * so does `Site`; the five imported documents used to carry their own header
 * markup and their own copy of the scroll behaviour, which is how the nav came
 * to say "What it does" while the page it opened was called "What we do".
 *
 * What moves, and why each one is answering the reader rather than decorating:
 *
 *   - the bar **inverts** on what is behind it;
 *   - it **condenses** once you leave the top, taking less room the further in
 *     you are;
 *   - a **pill slides between nav items** on hover — one object moving, rather
 *     than two backgrounds fading;
 *   - the **current page** keeps that pill, so the bar says where you are. The
 *     doc pages had no active state at all;
 *   - the **sheet** opens and closes instead of appearing.
 *
 * All of it is off under `prefers-reduced-motion`, and none of it loops. A
 * header that animates on its own is a header that is still loading.
 */
export function Header({
  lang,
  marks,
}: {
  lang: Lang
  /**
   * Both inkings of the lockup, rendered by the caller.
   *
   * The bar needs whichever one contrasts with the surface it is currently on,
   * and it cannot build them itself: `Wordmark` calls `resolveBrand()`, and
   * importing that here would pull `@qabandi/brand` into the client bundle —
   * the property that makes a re-skin a rebuild of nothing but the tokens.
   * Both arrive as children and this component only chooses.
   */
  marks: { onPaper: ReactNode; onDark: ReactNode }
}) {
  const [open, setOpen] = useState(false)
  const [condensed, setCondensed] = useState(false)
  const [overDark, setOverDark] = useState(true)
  const [hovered, setHovered] = useState<string | null>(null)
  const pathname = usePathname()
  const reduced = useReducedMotion()
  const other = languageSwitch[lang]

  useEffect(() => {
    let frame: number | null = null

    /**
     * Is a dark band crossing the bar's baseline right now?
     *
     * Rectangles rather than an `IntersectionObserver`. An observer would need
     * a `rootMargin` describing a one-pixel band at the bar's height, which is
     * a number recomputed from the viewport on every resize and re-registered
     * with a new observer each time — more moving parts to answer a question
     * that is four `getBoundingClientRect()` calls. There are never more than a
     * handful of dark bands on a page, and this runs at most once a frame.
     */
    const measure = () => {
      frame = null
      const dark = Array.from(document.querySelectorAll(DARK_SELECTOR)).some((node) => {
        const rect = node.getBoundingClientRect()
        return rect.top <= BASELINE_PX && rect.bottom >= BASELINE_PX
      })
      setOverDark(dark)
      setCondensed(window.scrollY > 40)
    }

    const request = () => {
      if (frame === null) frame = requestAnimationFrame(measure)
    }

    measure()
    window.addEventListener('scroll', request, { passive: true })
    window.addEventListener('resize', request)
    return () => {
      window.removeEventListener('scroll', request)
      window.removeEventListener('resize', request)
      if (frame !== null) cancelAnimationFrame(frame)
    }
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

  /**
   * `/what-we-do` and `/what-we-do/` are the same page.
   *
   * `trailingSlash: true` means every href in `copy.ts` carries one and every
   * rendered path does too, but the dev server and a static host disagree about
   * this often enough that comparing the raw strings marks nothing active on
   * one of them. Trimming both ends the argument.
   */
  const here = (href: string) => {
    const trim = (value: string) => value.replace(/\/+$/, '') || '/'
    return trim(pathname ?? '') === trim(href)
  }

  // The pill follows the cursor while the reader is in the bar, and falls back
  // to the current page when they leave it. One `layoutId` across both states is
  // what makes it slide rather than cross-fade.
  const lit = hovered ?? nav.find((item) => here(item.href))?.href ?? null

  /**
   * One number, and the stylesheet does the rest.
   *
   * This was two objects of Tailwind classes swapped on a state change, and it
   * snapped: `transition-colors` tweens a property between two values of that
   * property, and replacing `text-ink-dim` with `text-on-void-dim` replaces the
   * declaration outright. The background cross-faded and the type changed
   * between frames, which reads as a glitch rather than as a transition.
   *
   * `--tone` is a registered `<number>` — see `globals.css` — so the browser can
   * interpolate it, and it inherits, so the background, both borders, three
   * text colours, the nav pill and both lockups all move on one clock at one
   * easing. Nothing here knows what colour anything is.
   */
  const tone = overDark ? 1 : 0

  return (
    <header className="pointer-events-none fixed inset-x-0 top-0 z-50 pt-3 sm:pt-4">
      <div className="shell-wide">
        <motion.div
          initial={reduced ? false : { opacity: 0, y: -14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
          style={{ '--tone': tone } as CSSProperties}
          className={`bar bar-surface pointer-events-auto mx-auto flex max-w-[64rem] items-center justify-between gap-4 rounded-xl border ps-5 backdrop-blur-xl ${
            condensed ? 'py-1.5 pe-1.5 shadow-lg' : 'py-2.5 pe-2.5 shadow-md'
          }`}
        >
          {/*
            Both lockups are in the DOM and one of them is transparent.

            Swapping the `src` would flash — the second file is not decoded until
            it is asked for, so the mark disappears for a frame at exactly the
            moment the bar is drawing attention to itself by inverting. Stacked,
            they cross-fade with the rest of the bar and neither is ever fetched
            mid-transition. They are two SVGs of a few hundred bytes.
          */}
          <a
            href={lang === 'ar' ? '/ar/' : '/'}
            className="relative shrink-0 transition-opacity duration-200 hover:opacity-70"
          >
            <span className="bar-mark-paper block">{marks.onPaper}</span>
            <span aria-hidden={overDark} className="bar-mark-dark absolute inset-0">
              {marks.onDark}
            </span>
          </a>

          <nav className="hidden items-center gap-1 md:flex" onMouseLeave={() => setHovered(null)}>
            {nav.map((item) => (
              <a
                key={item.href}
                href={item.href}
                onMouseEnter={() => setHovered(item.href)}
                aria-current={here(item.href) ? 'page' : undefined}
                className={`relative isolate rounded-lg px-3.5 py-2 text-[0.875rem] ${
                  lit === item.href ? 'bar-ink' : 'bar-dim'
                }`}
              >
                {lit === item.href ? (
                  <motion.span
                    layoutId="nav-pill"
                    aria-hidden="true"
                    className="bar-pill absolute inset-0 -z-10 rounded-lg"
                    transition={{ duration: reduced ? 0 : 0.28, ease: [0.16, 1, 0.3, 1] }}
                  />
                ) : null}
                {item.label[lang]}
              </a>
            ))}
          </nav>

          <div className="flex items-center gap-2">
            <a
              href={other.href}
              hrefLang={other.hrefLang}
              lang={other.hrefLang}
              className={`bar-edge bar-dim bar-hover rounded-lg border px-3 py-2 text-[0.8rem] ${
                lang === 'en' ? 'arabic' : ''
              }`}
            >
              {other.label}
            </a>

            {/* The one element that does not invert. Brand blue carries
                `--qb-on-brand` on both surfaces, and a call to action that
                changes colour halfway down the page stops being the same
                button. */}
            <a
              href={DEMO_URL}
              className="tracked group hidden items-center gap-2 rounded-lg bg-blue px-4 py-2.5 text-[0.6rem] leading-none text-on-brand transition-[transform,opacity] duration-200 hover:opacity-90 active:scale-[0.97] sm:flex"
            >
              {lang === 'ar' ? 'النسخة التجريبية' : 'Live demo'}
              {/* Hidden until hover and sliding in from nothing — the button
                  acknowledging the cursor, not an icon the label needs. */}
              <ArrowRight
                weight="bold"
                aria-hidden="true"
                className="size-0 -translate-x-1 opacity-0 transition-all duration-200 group-hover:size-3 group-hover:translate-x-0 group-hover:opacity-100 rtl:-scale-x-100 rtl:translate-x-1 rtl:group-hover:translate-x-0"
              />
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
              className="bar-edge bar-dim flex size-9 items-center justify-center rounded-lg border transition-transform active:scale-95 md:hidden"
            >
              {/* Keyed so the two glyphs quarter-turn into each other rather
                  than swapping between frames. */}
              <AnimatePresence mode="wait" initial={false}>
                <motion.span
                  key={open ? 'close' : 'open'}
                  initial={reduced ? false : { opacity: 0, rotate: -90 }}
                  animate={{ opacity: 1, rotate: 0 }}
                  exit={reduced ? undefined : { opacity: 0, rotate: 90 }}
                  transition={{ duration: 0.18 }}
                  className="flex"
                >
                  {open ? <X weight="bold" className="size-4" /> : <List weight="bold" className="size-4" />}
                </motion.span>
              </AnimatePresence>
            </button>
          </div>
        </motion.div>

        <AnimatePresence initial={false}>
          {open ? (
            <motion.nav
              key="sheet"
              initial={reduced ? false : { opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={reduced ? undefined : { opacity: 0, height: 0 }}
              transition={{ duration: 0.26, ease: [0.16, 1, 0.3, 1] }}
              // `overflow-hidden` is what makes a height animation possible at
              // all: without it the children paint outside the collapsing box.
              style={{ '--tone': tone } as CSSProperties}
              className="bar bar-surface pointer-events-auto mx-auto mt-2 max-w-[64rem] overflow-hidden rounded-xl border backdrop-blur-xl md:hidden"
            >
              <div className="flex flex-col p-3">
                {nav.map((item, index) => (
                  <motion.a
                    key={item.href}
                    href={item.href}
                    onClick={() => setOpen(false)}
                    initial={reduced ? false : { opacity: 0, x: 8 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.25, delay: 0.05 + index * 0.05 }}
                    aria-current={here(item.href) ? 'page' : undefined}
                    className={`rounded-lg px-3 py-3.5 text-[1rem] ${
                      here(item.href) ? 'bar-pill bar-ink' : 'bar-dim'
                    }`}
                  >
                    {item.label[lang]}
                  </motion.a>
                ))}
                <a
                  href={DEMO_URL}
                  onClick={() => setOpen(false)}
                  className="tracked mt-2 rounded-lg bg-blue px-4 py-3.5 text-center text-[0.62rem] text-on-brand active:scale-[0.98]"
                >
                  {lang === 'ar' ? 'افتحوا النسخة التجريبية' : 'Open the live demo'}
                </a>
              </div>
            </motion.nav>
          ) : null}
        </AnimatePresence>
      </div>
    </header>
  )
}
