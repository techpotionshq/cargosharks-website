'use client'

/**
 * The sidebar's navigation list, and its phone counterparts.
 *
 * A client component for two reasons: the active route, and which sections are
 * open. Everything else about the sidebar is static markup rendered on the
 * server, and the item definitions arrive as serialisable props so the *shape*
 * of the navigation stays declared in the layout rather than here.
 *
 * Active state is matched by prefix, so `/customers/new` and `/customers/{id}`
 * both keep "Customers" lit. The dashboard is exempt — every path starts with
 * `/`, so a prefix match there would light it permanently.
 */

import type { Route } from 'next'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { FOCUS_RING } from './control'
import { Icon, type IconName } from './icon'

interface NavLink {
  readonly href: string
  readonly label: string
  readonly icon: IconName
  /** Rendered as a count chip — open exceptions, unanswered enquiries. */
  readonly badge?: number
  /** Paints the badge as an alarm rather than as a neutral count. */
  readonly badgeTone?: 'critical' | 'neutral'
}

export interface NavSection {
  readonly label: string
  readonly items: readonly NavLink[]
}

function isActive(pathname: string, href: string): boolean {
  if (href === '/dashboard') return pathname === '/dashboard'
  return pathname === href || pathname.startsWith(`${href}/`)
}

/** The section holding the current screen, or the first one when none does (`/search`). */
function activeSection(sections: readonly NavSection[], pathname: string): string | undefined {
  return (
    sections.find((section) => section.items.some((item) => isActive(pathname, item.href)))
      ?.label ?? sections[0]?.label
  )
}

/** `99+` past two digits: the chip is a signal, not a ledger. */
function countLabel(count: number): string {
  return count > 99 ? '99+' : String(count)
}

export function SidebarNav({
  sections,
  moreBelowLabel,
}: {
  readonly sections: readonly NavSection[]
  /** Names the cue drawn when sections are still out of sight below. */
  readonly moreBelowLabel: string
}) {
  const pathname = usePathname()
  const baseId = useId()

  /*
    Sections fold, and the one you are in is open.

    Twenty-one links in four groups measure about 940px drawn open, and the
    column they share with the logo, the two doors and the account card has
    about 500px of it at 1280x720 and 680px at 1440x900. Finance came last and
    landed below the fold on every laptop, with nothing to say it was there,
    and finance staff read an absent Finance as "I have no access". Folded, the
    four headings always fit; the open one is the section the reader is
    already working in.

    State rather than `<details>`, because the open set has to follow the
    route: moving from Rate cards to Invoices opens Finance without the reader
    asking. Sections the reader opened by hand stay open across navigations
    — this component lives in the layout, so it is not remounted — which is
    what lets someone who works across two sections keep both in view.
  */
  const [open, setOpen] = useState<ReadonlySet<string>>(() => {
    const current = activeSection(sections, pathname)
    return new Set(current ? [current] : [])
  })

  useEffect(() => {
    const current = activeSection(sections, pathname)
    if (!current) return
    setOpen((previous) => (previous.has(current) ? previous : new Set([...previous, current])))
  }, [pathname, sections])

  const toggle = useCallback((label: string) => {
    setOpen((previous) => {
      const next = new Set(previous)
      if (next.has(label)) next.delete(label)
      else next.add(label)
      return next
    })
  }, [])

  /*
    The cue for whatever still does not fit.

    Folding fixes the default, not every case: open all four on a 720px screen
    and the list scrolls again. A scroll region whose bar is hidden until the
    pointer moves looks exactly like a short list, so while there is anything
    below the visible edge a fade and a labelled chevron say so — and the
    chevron scrolls, because on a trackpad-less laptop it is the obvious thing
    to press.
  */
  const scroller = useRef<HTMLDivElement>(null)
  const [moreBelow, setMoreBelow] = useState(false)

  const measure = useCallback(() => {
    const element = scroller.current
    if (!element) return
    setMoreBelow(element.scrollHeight - element.scrollTop - element.clientHeight > 4)
  }, [])

  useEffect(() => {
    const element = scroller.current
    if (!element) return
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    for (const child of element.children) observer.observe(child)
    return () => observer.disconnect()
  }, [measure, open])

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div
        ref={scroller}
        onScroll={measure}
        className="qb-scroll flex flex-1 flex-col gap-1 overflow-y-auto px-3 py-3"
      >
        {sections.map((section, index) => {
          const expanded = open.has(section.label)
          const listId = `${baseId}-section-${index}`
          /*
            A folded section still reports its alarms. Five supplier bills
            waiting for review are no less waiting because Finance is closed,
            so the critical counts of the hidden rows are summed onto the
            heading — the reader can see there is something in there without
            opening it to look.
          */
          const hiddenAlarms = expanded
            ? 0
            : section.items.reduce(
                (sum, item) => sum + (item.badgeTone !== 'neutral' ? (item.badge ?? 0) : 0),
                0,
              )
          return (
            <div key={section.label}>
              <button
                type="button"
                onClick={() => toggle(section.label)}
                aria-expanded={expanded}
                aria-controls={listId}
                className={`flex h-8 w-full items-center gap-2 rounded-sm ps-3 pe-2 text-start text-micro font-semibold tracking-[0.14em] text-chrome-ink-muted uppercase transition-colors hover:bg-surface-sunken hover:text-chrome-ink ${FOCUS_RING}`}
              >
                {/* Full-strength muted ink: at /70 the group names measured 2.6:1. */}
                <span className="truncate">{section.label}</span>
                {hiddenAlarms > 0 ? (
                  <span className="numeric min-w-[1.25rem] rounded-full bg-critical px-1.5 py-px text-center tracking-normal text-surface">
                    {countLabel(hiddenAlarms)}
                  </span>
                ) : null}
                <Icon
                  name="chevron-down"
                  size={13}
                  className={`ms-auto shrink-0 transition-transform ${expanded ? '' : '-rotate-90 rtl:rotate-90'}`}
                />
              </button>
              <ul id={listId} hidden={!expanded} className="mt-0.5 mb-2 flex flex-col gap-px">
                {section.items.map((item) => {
                  const active = isActive(pathname, item.href)
                  const critical = item.badgeTone !== 'neutral'
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href as Route}
                        aria-current={active ? 'page' : undefined}
                        // 34px rows rather than 37px: three pixels across
                        // twenty-one rows is a whole section's heading back.
                        className={[
                          'group relative flex items-center gap-2.5 rounded-sm py-[0.4rem] ps-3 pe-2 text-body-sm transition-colors',
                          active
                            ? 'bg-accent-soft font-semibold text-accent'
                            : 'font-medium text-chrome-ink-muted hover:bg-surface-sunken hover:text-chrome-ink',
                        ].join(' ')}
                      >
                        {/*
                          A soft wash for the active row, with a solid rule on the
                          inline-start edge. The rule is what survives at a glance —
                          the wash alone is too quiet on a light chrome, and a fully
                          saturated pill at every level of the tree competes with
                          the alarm colours on the board it frames.

                          Both in the accent, the navy the chrome is cut from. In
                          the brand red the lit row carried the same colour as the
                          exception count beside it, and "you are here" read as
                          "something is wrong here".
                        */}
                        <span
                          className={[
                            'absolute inset-y-1.5 start-0 w-[3px] rounded-e-full bg-accent transition-opacity',
                            active ? 'opacity-100' : 'opacity-0',
                          ].join(' ')}
                        />
                        <Icon
                          name={item.icon}
                          size={17}
                          weight={active ? 'fill' : 'regular'}
                          className={active ? 'text-accent' : 'text-ink-subtle'}
                        />
                        <span className="truncate">{item.label}</span>
                        {item.badge ? (
                          <span
                            className={[
                              'numeric ms-auto min-w-[1.25rem] rounded-full px-1.5 py-px text-center text-micro font-semibold',
                              /*
                                `text-surface`, not `text-on-brand`: on-brand is
                                light in both themes, and the dark theme's critical
                                is a light red, so the count read at 2.4:1. The
                                surface colour flips with the theme — white on the
                                light red-600, near-black on the dark one's pale
                                red — and clears AA in both (6.0:1 and 7.0:1).
                              */
                              critical
                                ? 'bg-critical text-surface'
                                : 'bg-surface-sunken text-ink-muted',
                            ].join(' ')}
                          >
                            {countLabel(item.badge)}
                          </span>
                        ) : null}
                      </Link>
                    </li>
                  )
                })}
              </ul>
            </div>
          )
        })}
      </div>

      {moreBelow ? (
        // The fade is decoration and lets clicks through; only the chevron
        // takes them.
        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex h-14 items-end justify-center bg-linear-to-t from-chrome via-chrome/85 to-transparent pb-1.5">
          <button
            type="button"
            data-nav-more-below
            aria-label={moreBelowLabel}
            title={moreBelowLabel}
            onClick={() =>
              scroller.current?.scrollBy({
                top: scroller.current.clientHeight * 0.75,
                behavior: 'smooth',
              })
            }
            className={`pointer-events-auto flex h-7 items-center gap-1 rounded-full border border-chrome-line bg-chrome px-2.5 text-micro font-medium text-chrome-ink-muted shadow-card transition-colors hover:text-chrome-ink ${FOCUS_RING}`}
          >
            {moreBelowLabel}
            <Icon name="chevron-down" size={12} />
          </button>
        </div>
      ) : null}
    </div>
  )
}

/**
 * The same list as a horizontal strip, for phones where the sidebar is gone.
 *
 * The strip is the quick way between neighbouring screens; the menu sheet
 * (`MobileMenu`) is the complete one. Twenty-one pills do not fit any phone,
 * so the strip always scrolls — and on load it is scrolled to the current
 * screen, because a strip that always opens at Dashboard hides the one pill
 * that says where you are.
 */
export function MobileNav({ sections }: { readonly sections: readonly NavSection[] }) {
  const pathname = usePathname()
  const items = sections.flatMap((section) => section.items)
  const strip = useRef<HTMLElement>(null)

  useEffect(() => {
    /*
      `scrollIntoView` rather than arithmetic on `scrollLeft`: in Arabic the
      strip scrolls the other way, and Chromium reports a negative
      `scrollLeft` there that Safari historically did not. `block: 'nearest'`
      leaves the page's own vertical scroll alone when the strip is already
      in view, which it is after every navigation.
    */
    strip.current
      ?.querySelector<HTMLElement>('[aria-current="page"]')
      ?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'instant' })
  }, [pathname])

  return (
    <nav
      ref={strip}
      className="flex items-center gap-1 overflow-x-auto border-b border-line bg-surface px-3 py-1.5 md:hidden"
    >
      {items.map((item) => {
        const active = isActive(pathname, item.href)
        return (
          <Link
            key={item.href}
            href={item.href as Route}
            aria-current={active ? 'page' : undefined}
            // 40px tall: on a phone this strip and the menu are the only
            // navigation, and at 32px its pills were the most-missed targets.
            className={[
              'flex h-10 shrink-0 items-center gap-1.5 rounded-full px-3 text-body-sm transition-colors',
              active
                ? 'bg-accent-soft font-semibold text-accent'
                : 'font-medium text-ink-muted hover:bg-surface-sunken hover:text-ink',
            ].join(' ')}
          >
            <Icon name={item.icon} size={15} weight={active ? 'fill' : 'regular'} />
            {item.label}
            {item.badge ? (
              // The same pair as the sidebar's count, for the same contrast.
              <span className="numeric rounded-full bg-critical px-1.5 text-micro font-semibold text-surface">
                {countLabel(item.badge)}
              </span>
            ) : null}
          </Link>
        )
      })}
    </nav>
  )
}

export interface MobileMenuLabels {
  readonly menu: string
  readonly close: string
  readonly search: string
  readonly searchPlaceholder: string
  readonly tracking: string
  readonly settings: string
}

/**
 * Everything the sidebar holds, for a phone: a button in the top bar that
 * opens a sheet.
 *
 * Before this a phone had the strip and nothing else — no search box (the top
 * bar's is `sm:` and up), no settings, no customer tracking and, worst, no way
 * to sign out, so a coordinator on a shared yard tablet left their session
 * behind them. The sheet carries the full grouped list plus those four.
 *
 * A native `<dialog>` opened with `showModal()`, for the reasons `ui/modal.tsx`
 * gives: focus trap, inert page, Escape and top-layer stacking from the
 * platform. The trigger also carries the HTML invoker attributes, so a tap
 * before hydration still opens it.
 *
 * `account` is server-rendered by the layout — the person, the theme and time
 * zone switches, and the sign-out form with its server action — so none of
 * that has to cross into a client component as data.
 */
export function MobileMenu({
  sections,
  labels,
  showSettings,
  account,
}: {
  readonly sections: readonly NavSection[]
  readonly labels: MobileMenuLabels
  readonly showSettings: boolean
  readonly account: ReactNode
}) {
  const pathname = usePathname()
  const ref = useRef<HTMLDialogElement>(null)
  const dialogId = useId()
  const titleId = useId()
  const [open, setOpen] = useState(false)

  const close = useCallback(() => {
    ref.current?.close()
    setOpen(false)
  }, [])

  useEffect(() => {
    const element = ref.current
    if (!element) return
    const onClose = () => setOpen(false)
    element.addEventListener('close', onClose)
    // Opened by its invoker before hydration: adopt it.
    if (element.open) setOpen(true)
    return () => element.removeEventListener('close', onClose)
  }, [])

  // A link inside navigates without unmounting the layout, so the sheet has
  // to be told the screen changed or it would sit open over the new one.
  useEffect(() => {
    close()
  }, [pathname, close])

  // The page behind must not scroll under the sheet.
  useEffect(() => {
    if (!open) return
    const { style } = document.body
    const previous = style.overflow
    style.overflow = 'hidden'
    return () => {
      style.overflow = previous
    }
  }, [open])

  const doorClass =
    'flex h-11 items-center gap-2.5 rounded-sm px-3 text-body font-medium text-ink-muted transition-colors hover:bg-surface-sunken hover:text-ink'

  return (
    <>
      <button
        type="button"
        data-mobile-menu-trigger
        aria-label={labels.menu}
        aria-expanded={open}
        aria-controls={dialogId}
        // Invoker commands; see `InvokerAttributes` in `ui/modal.tsx`.
        {...{ commandfor: dialogId, command: 'show-modal' }}
        onClick={() => {
          if (ref.current && !ref.current.open) ref.current.showModal()
          setOpen(true)
        }}
        className="-me-2 flex size-10 items-center justify-center rounded-sm text-ink-muted transition-colors hover:bg-surface-sunken hover:text-ink md:hidden"
      >
        <Icon name="menu" size={20} />
      </button>

      <dialog
        ref={ref}
        id={dialogId}
        aria-labelledby={titleId}
        onClick={(event) => {
          // The element itself is the backdrop: the panel fills its box.
          if (event.target === ref.current) close()
        }}
        /*
          A sheet at the inline end, under the button that opened it — the
          right edge in English, the left in Arabic, from the logical margin
          alone. `max-h-none`/`h-dvh` undo the UA's centred-dialog sizing, and
          the same text resets as `Modal` stop the trigger's surroundings
          leaking in through inheritance.
        */
        className="visible m-0 ms-auto h-dvh max-h-none w-[min(22rem,calc(100vw-3rem))] max-w-none overflow-hidden border-s border-line bg-surface p-0 text-start font-normal tracking-normal whitespace-normal text-ink normal-case shadow-pop backdrop:bg-[color:var(--qb-scrim)] open:flex"
      >
        <div className="flex min-h-0 w-full flex-col">
          <header className="flex h-14 shrink-0 items-center gap-3 border-b border-line ps-4 pe-2">
            <h2 id={titleId} className="text-heading font-semibold text-ink">
              {labels.menu}
            </h2>
            <button
              type="button"
              onClick={close}
              aria-label={labels.close}
              className="ms-auto flex size-10 items-center justify-center rounded-sm text-ink-subtle transition-colors hover:bg-surface-sunken hover:text-ink"
            >
              <Icon name="close" size={18} />
            </button>
          </header>

          <div className="qb-scroll min-h-0 flex-1 overflow-y-auto px-3 py-3">
            {/* The top bar's search is `sm:` and up; this is the phone's. */}
            <form action="/search" role="search" className="relative mb-3">
              <Icon
                name="search"
                size={16}
                className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-ink-subtle"
              />
              <input
                type="search"
                name="q"
                placeholder={labels.searchPlaceholder}
                aria-label={labels.search}
                className={`h-11 w-full rounded-full border border-line-strong bg-surface-sunken ps-9 pe-3 text-body text-ink placeholder:text-ink-subtle focus:bg-surface ${FOCUS_RING}`}
              />
            </form>

            <nav aria-labelledby={titleId} className="flex flex-col gap-3">
              {sections.map((section) => (
                <div key={section.label}>
                  <p className="mb-1 px-3 text-micro font-semibold tracking-[0.14em] text-ink-muted uppercase">
                    {section.label}
                  </p>
                  <ul className="flex flex-col">
                    {section.items.map((item) => {
                      const active = isActive(pathname, item.href)
                      return (
                        <li key={item.href}>
                          <Link
                            href={item.href as Route}
                            aria-current={active ? 'page' : undefined}
                            onClick={close}
                            className={[
                              'flex h-11 items-center gap-2.5 rounded-sm px-3 text-body transition-colors',
                              active
                                ? 'bg-accent-soft font-semibold text-accent'
                                : 'font-medium text-ink-muted hover:bg-surface-sunken hover:text-ink',
                            ].join(' ')}
                          >
                            <Icon
                              name={item.icon}
                              size={18}
                              weight={active ? 'fill' : 'regular'}
                              className={active ? 'text-accent' : 'text-ink-subtle'}
                            />
                            <span className="truncate">{item.label}</span>
                            {item.badge ? (
                              <span
                                className={`numeric ms-auto rounded-full px-1.5 text-micro font-semibold ${
                                  item.badgeTone !== 'neutral'
                                    ? 'bg-critical text-surface'
                                    : 'bg-surface-sunken text-ink-muted'
                                }`}
                              >
                                {countLabel(item.badge)}
                              </span>
                            ) : null}
                          </Link>
                        </li>
                      )
                    })}
                  </ul>
                </div>
              ))}
            </nav>

            <div className="mt-3 flex flex-col border-t border-line pt-3">
              <Link href="/track" onClick={close} className={doorClass}>
                <Icon name="tracking" size={18} className="text-ink-subtle" />
                {labels.tracking}
                <Icon name="external" size={13} className="ms-auto opacity-50" />
              </Link>
              {showSettings ? (
                <Link href="/settings" onClick={close} className={doorClass}>
                  <Icon name="settings" size={18} className="text-ink-subtle" />
                  {labels.settings}
                  <Icon name="chevron-end" size={13} className="ms-auto opacity-50" />
                </Link>
              ) : null}
            </div>
          </div>

          <div className="shrink-0 border-t border-line p-3">{account}</div>
        </div>
      </dialog>
    </>
  )
}
