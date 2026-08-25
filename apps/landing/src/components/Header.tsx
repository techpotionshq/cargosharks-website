'use client'

import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { usePathname } from 'next/navigation'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { ArrowRight, CaretDown, List, X } from '@phosphor-icons/react/dist/ssr'
import { DEMO_URL, type Lang, languageSwitch, nav } from '@/content/copy'

/**
 * The pill that slides between nav items.
 *
 * One `layoutId` shared by every item is what makes it travel rather than fade
 * — two elements with the same layout id are treated as the same object moving,
 * which is the difference between a menu that feels responsive and one that
 * feels like two backgrounds crossfading.
 */
function NavPill({ reduced }: { reduced: boolean | null }) {
  return (
    <motion.span
      layoutId="nav-pill"
      aria-hidden="true"
      className="bar-pill absolute inset-0 -z-10 rounded-lg"
      transition={{ duration: reduced ? 0 : 0.28, ease: [0.16, 1, 0.3, 1] }}
    />
  )
}

/**
 * A bar that floats clear of the top edge, in one colour.
 *
 * The old header was pinned edge to edge and transparent over the hero, which
 * forced an unhappy compromise: the hero photograph runs under it, so the nav
 * had to be white to be legible there — and a white nav over the light sections
 * below was unreadable, so the bar grew a background on scroll.
 *
 * The version after that inverted: it measured which band was behind it and
 * turned white over the dark ones, dark over the paper. It worked and it was
 * wrong. A bar that changes colour twice on the way down a page announces
 * itself at four moments that have nothing to do with the reader, and the
 * crossing cannot be made pretty — every path from white to near-black passes
 * through the grey where the type has no contrast against its own panel.
 *
 * So it is dark, everywhere, and translucent. Chrome that stays put is chrome
 * you stop noticing, which is the entire job of a header. The blur does what
 * the inversion was doing: the photograph moves under the bar at the top of the
 * page and the product screenshot moves under it further down, so it still
 * reads as sitting *on* the page rather than bolted over it.
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
  mark,
}: {
  lang: Lang
  /**
   * The lockup, rendered by the caller.
   *
   * `Wordmark` calls `resolveBrand()`, and importing that into a client
   * component would pull `@qabandi/brand` into the browser bundle — the
   * property that makes a re-skin a rebuild of nothing but the tokens. It
   * arrives as a child and this component only places it.
   */
  mark: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const [hovered, setHovered] = useState<string | null>(null)
  const [panel, setPanel] = useState<string | null>(null)
  const pathname = usePathname()
  const reduced = useReducedMotion()
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

  /**
   * Escape closes the panel, and so does scrolling.
   *
   * Escape because a panel opened by a click is a thing a keyboard user has to
   * be able to dismiss. Scroll because the panel is anchored to a fixed bar and
   * would otherwise hang over the page the reader has moved on to — a menu that
   * outlives the intention that opened it.
   */
  useEffect(() => {
    if (!panel) return

    const close = () => setPanel(null)
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('scroll', close, { passive: true })
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', close)
    }
  }, [panel])

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
  /**
   * Which nav item wears the pill.
   *
   * `panel` is in the chain, and that is the second half of the flicker fix.
   * The panel is a sibling of the `<nav>`, so moving the cursor down into it
   * fires the nav's `onMouseLeave` and cleared `hovered` — the pill then flew
   * back to the current page or vanished, in the bar, while the reader was
   * looking at the menu that item had just opened. Falling back to the open
   * panel keeps the trigger lit for as long as its contents are on screen,
   * which is also what a reader would expect it to mean.
   */
  const lit =
    hovered ?? panel ?? nav.find((item) => (item.href ? here(item.href) : false))?.id ?? null

  const panelItem = nav.find((item) => item.id === panel && item.columns) ?? null

  /**
   * The panel closes on a delay, and the delay is the fix for the glitching.
   *
   * Two things made it flicker. The panel hangs eight pixels below the bar, and
   * that gap is inside the header — which is `pointer-events-none`, so a cursor
   * travelling from a nav item down into the panel left both elements on the
   * way and `onMouseLeave` fired mid-journey. And a reader moving sideways
   * between "Product" and "Compare" crossed a few pixels of bar between them,
   * which closed and reopened the panel rather than swapping its contents.
   *
   * A cancellable timer answers both: leaving schedules a close, entering
   * anything that belongs to the menu cancels it. 160ms is long enough to cross
   * the gap and short enough that nobody who has genuinely left sees a panel
   * hanging around. The ref rather than state because a pending close must not
   * re-render anything — it is a decision that has not been taken yet.
   */
  const closing = useRef<ReturnType<typeof setTimeout> | null>(null)

  const holdPanel = (id: string) => {
    if (closing.current) clearTimeout(closing.current)
    closing.current = null
    setPanel(id)
  }

  const releasePanel = () => {
    if (closing.current) clearTimeout(closing.current)
    closing.current = setTimeout(() => setPanel(null), 160)
  }

  useEffect(
    () => () => {
      if (closing.current) clearTimeout(closing.current)
    },
    [],
  )

  return (
    <header className="pointer-events-none fixed inset-x-0 top-0 z-50 pt-3 sm:pt-4">
      <div className="shell-wide">
        <motion.div
          initial={reduced ? false : { opacity: 0, y: -14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
          // One height, always. It used to shrink its padding once the reader
          // left the top of the page, which is a common trick and was wrong
          // here for a plain reason: the bar is fixed, so every pixel it loses
          // is a pixel the whole page appears to jump. Scrolling slowly past
          // the threshold made it twitch; scrolling fast made it flicker.
          className="bar pointer-events-auto mx-auto flex max-w-[64rem] items-center justify-between gap-4 rounded-xl border py-2.5 pe-2.5 ps-5 shadow-lg backdrop-blur-xl"
        >
          <a
            href={lang === 'ar' ? '/ar/' : '/'}
            className="shrink-0 transition-opacity duration-200 hover:opacity-70"
          >
            {mark}
          </a>

          <nav
            className="hidden items-center gap-1 md:flex"
            onMouseLeave={() => {
              setHovered(null)
              releasePanel()
            }}
          >
            {nav.map((item) => {
              const isOpen = panel === item.id
              const active = item.href ? here(item.href) : isOpen

              /*
                Hover opens it and a click toggles it.

                Hover alone is the pattern everyone knows and it strands anybody
                on a touchscreen or a keyboard — the panel can never be opened.
                Click alone costs a mouse user a click on every menu. Both, with
                the click winning, is the arrangement that works for all three
                without either group noticing there was a decision.
              */
              return (
                <div
                  key={item.id}
                  onMouseEnter={() => {
                    setHovered(item.id)
                    if (item.columns) holdPanel(item.id)
                  }}
                >
                  {item.href ? (
                    <a
                      href={item.href}
                      aria-current={here(item.href) ? 'page' : undefined}
                      className={`relative isolate block rounded-lg px-3.5 py-2 text-[0.875rem] ${
                        lit === item.id || active ? 'text-on-void' : 'text-on-void-dim'
                      }`}
                    >
                      {lit === item.id ? <NavPill reduced={reduced} /> : null}
                      {item.label[lang]}
                    </a>
                  ) : (
                    <button
                      type="button"
                      onClick={() => (isOpen ? setPanel(null) : holdPanel(item.id))}
                      aria-expanded={isOpen}
                      className={`relative isolate flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-[0.875rem] ${
                        lit === item.id || isOpen ? 'text-on-void' : 'text-on-void-dim'
                      }`}
                    >
                      {lit === item.id ? <NavPill reduced={reduced} /> : null}
                      {item.label[lang]}
                      <CaretDown
                        weight="bold"
                        aria-hidden="true"
                        className={`size-2.5 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
                      />
                    </button>
                  )}
                </div>
              )
            })}
          </nav>

          <div className="flex items-center gap-2">
            <a
              href={other.href}
              hrefLang={other.hrefLang}
              lang={other.hrefLang}
              className={`bar-hover rounded-lg border border-void-line text-on-void-dim px-3 py-2 text-[0.8rem] ${
                lang === 'en' ? 'arabic' : ''
              }`}
            >
              {other.label}
            </a>

            {/* The one element that does not invert. Brand blue carries
                `--qb-on-brand` on both surfaces, and a call to action that
                changes colour halfway down the page stops being the same
                button. */}
            {/*
              Nothing here changes size.

              The arrow grew out of `size-0` on hover and the button carried
              `active:scale`, so pointing at it widened the button and pressing
              it shrank the element — and because the bar is a flex row, both
              moved everything beside them. A control in fixed chrome may change
              colour; it may not change the layout around it.
            */}
            <a
              href={DEMO_URL}
              className="tracked group hidden items-center gap-2 rounded-lg bg-blue px-4 py-2.5 text-[0.6rem] leading-none text-on-brand transition-opacity duration-200 hover:opacity-90 sm:flex"
            >
              {lang === 'ar' ? 'النسخة التجريبية' : 'Live demo'}
              <ArrowRight
                weight="bold"
                aria-hidden="true"
                className="size-3 transition-transform duration-200 group-hover:translate-x-0.5 rtl:-scale-x-100 rtl:group-hover:-translate-x-0.5"
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
              className="flex size-9 border-void-line text-on-void-dim items-center justify-center rounded-lg border transition-transform md:hidden"
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
                  {open ? (
                    <X weight="bold" className="size-4" />
                  ) : (
                    <List weight="bold" className="size-4" />
                  )}
                </motion.span>
              </AnimatePresence>
            </button>
          </div>
        </motion.div>

        {/*
          The panel.

          It hangs off the bar rather than out of the item that opened it, so
          the two are one object: same width, same surface, and a
          single element to animate. A panel anchored under its own trigger has
          to be measured and positioned, and re-measured when the language flips
          the bar's contents end to end.

          **It is keyed `"panel"`, not by the group.** Keyed by the group, moving
          from "Product" to "Inside it" was an exit and an enter: two panels
          rendered at once, the outgoing one fading up and out while the incoming
          one faded down and in, which is the flicker. Keyed by nothing, the box
          is one persistent object that opens once, swaps its contents instantly
          while it is open, and closes once. Instant is correct here — a reader
          moving along the menu is comparing, and a 200ms cross-fade on every
          step is 200ms of neither.
        */}
        <AnimatePresence initial={false}>
          {panelItem ? (
            <motion.div
              key="panel"
              onMouseEnter={() => holdPanel(panelItem.id)}
              onMouseLeave={releasePanel}
              initial={reduced ? false : { opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reduced ? undefined : { opacity: 0, y: -8 }}
              transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
              // `mt-0 pt-2` rather than `mt-2`: the eight pixels between the bar
              // and the panel are padding *inside* the hoverable element rather
              // than a margin outside it, so a cursor moving down never leaves.
              // No surface on this element — it is only a hover bridge. `.bar`
              // paints a background, and putting one here filled the eight-pixel
              // gap as well, which welded the panel to the bar and squared off
              // the corners of both. The wrapper is transparent; the panel
              // inside it is the object.
              className="pointer-events-auto mx-auto mt-0 hidden max-w-[64rem] pt-2 md:block"
            >
              <div className="bar grid gap-8 overflow-hidden rounded-xl border p-7 shadow-xl backdrop-blur-xl lg:grid-cols-12 lg:gap-10 lg:p-9">
                {/*
                  The left column, which was a paragraph in a lot of empty space.

                  A picture of the thing the group is about does more than the
                  sentence did and it fills the column it was rattling around in.
                  A photograph of the trade rather than another product
                  capture: the site shows the software in five places already,
                  and a sixth thumbnail of the same dashboard in a menu is
                  wallpaper. It is also why there is no `-ar` variant to pick —
                  a container yard has no language.
                */}
                <div className="lg:col-span-4">
                  {panelItem.image ? (
                    <span className="block overflow-hidden rounded-lg border border-line/60">
                      <img
                        src={panelItem.image.src}
                        alt={panelItem.image.alt[lang]}
                        width={1000}
                        height={667}
                        loading="lazy"
                        // Cropped to the top of the capture rather than fitted:
                        // the interesting half of every one of these screens is
                        // its first few rows, and a whole dashboard at this width
                        // is a grey rectangle.
                        className="block aspect-[16/10] w-full object-cover object-top"
                      />
                    </span>
                  ) : null}

                  {panelItem.intro ? (
                    <p className="mt-4 max-w-[34ch] text-on-void-dim text-[0.85rem] leading-[1.6]">
                      {panelItem.intro[lang]}
                    </p>
                  ) : null}
                </div>

                <div className="grid gap-8 sm:grid-cols-2 lg:col-span-8 lg:gap-10">
                  {(panelItem.columns ?? []).map((column) => (
                    <div key={column.heading.en}>
                      <p className="tracked text-on-void-dim text-[0.55rem] opacity-70">
                        {column.heading[lang]}
                      </p>
                      <ul className="mt-4 space-y-1">
                        {column.links.map((link) => (
                          <li key={link.href}>
                            <a
                              href={link.href}
                              onClick={() => setPanel(null)}
                              className="bar-hover -mx-3 block rounded-lg px-3 py-2.5 transition-colors duration-150"
                            >
                              <span className="block text-on-void text-[0.9rem] font-medium">
                                {link.label[lang]}
                              </span>
                              <span className="mt-0.5 block text-on-void-dim text-[0.8rem] leading-[1.5] opacity-80">
                                {link.blurb[lang]}
                              </span>
                            </a>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              </div>
            </motion.div>
          ) : null}
        </AnimatePresence>

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
              className="bar pointer-events-auto mx-auto mt-2 max-w-[64rem] overflow-hidden rounded-xl border backdrop-blur-xl md:hidden"
            >
              {/*
                On a phone the panel is not a panel — everything is open at
                once, under its own heading.

                A mega menu that becomes an accordion on mobile makes a reader
                tap twice to reach a page they can already see the name of, and
                it hides exactly the pages this menu exists to surface. The
                sheet is scrollable and the whole tree is eleven lines; there is
                nothing here worth collapsing.
              */}
              <div className="flex max-h-[70vh] flex-col overflow-y-auto p-3">
                {nav.map((group, groupIndex) => (
                  <motion.div
                    key={group.id}
                    initial={reduced ? false : { opacity: 0, x: 8 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.25, delay: 0.05 + groupIndex * 0.06 }}
                    className={groupIndex > 0 ? 'mt-4 border-t border-void-line pt-4' : ''}
                  >
                    <p className="tracked px-3 text-on-void-dim text-[0.55rem] opacity-70">
                      {group.label[lang]}
                    </p>

                    {(group.columns ?? [])
                      .flatMap((column) => column.links)
                      .map((link) => (
                        <a
                          key={link.href}
                          href={link.href}
                          onClick={() => setOpen(false)}
                          aria-current={here(link.href) ? 'page' : undefined}
                          className={`mt-1 block rounded-lg px-3 py-2.5 ${
                            here(link.href) ? 'bar-pill' : ''
                          }`}
                        >
                          <span className="block text-on-void text-[0.95rem] font-medium">
                            {link.label[lang]}
                          </span>
                          <span className="mt-0.5 block text-on-void-dim text-[0.8rem] leading-[1.5] opacity-80">
                            {link.blurb[lang]}
                          </span>
                        </a>
                      ))}
                  </motion.div>
                ))}
                <a
                  href={DEMO_URL}
                  onClick={() => setOpen(false)}
                  className="tracked mt-2 rounded-lg bg-blue px-4 py-3.5 text-center text-[0.62rem] text-on-brand "
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
