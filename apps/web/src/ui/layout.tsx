/**
 * Page furniture — headers, empty states, buttons, grids.
 *
 * Small pieces, but they are what make eight screens look like one product.
 * Every one of them is a server component and none carries a colour literal.
 */

import type { Route } from 'next'
import Link from 'next/link'
import type { ReactNode } from 'react'
import { Icon, type IconName } from './icon'
import { BUTTON_SIZE, BUTTON_VARIANT, MENU_ITEM, MENU_ITEM_DANGER, buttonClass } from './control'

export function PageHeader({
  title,
  eyebrow,
  description,
  status,
  actions,
  className,
}: {
  readonly title: ReactNode
  readonly eyebrow?: ReactNode
  readonly description?: ReactNode
  /**
   * The record's state, beside its name.
   *
   * Status pills used to ride in the actions row, where they read as one
   * more button — "Issued" next to "Void", the same height and the same
   * shape. Beside the title they read as what they are: a fact about the
   * thing the page is about.
   */
  readonly status?: ReactNode
  readonly actions?: ReactNode
  readonly className?: string
}) {
  return (
    <header
      className={['mb-6 flex flex-wrap items-end justify-between gap-4', className]
        .filter(Boolean)
        .join(' ')}
    >
      <div className="min-w-0">
        {eyebrow ? <p className="eyebrow mb-1.5">{eyebrow}</p> : null}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <h1 className="font-display text-display leading-tight font-semibold tracking-tight text-ink">
            {title}
          </h1>
          {status ? <div className="flex flex-wrap items-center gap-1.5">{status}</div> : null}
        </div>
        {description ? (
          <p className="mt-1.5 max-w-2xl text-body text-ink-muted">{description}</p>
        ) : null}
      </div>
      {/*
        The actions wrap, within the screen. Kept on one line, a header with
        five buttons — an enquiry's "Assign · Cancel it · Close · Price it · New
        quotation" — was 572px wide on a 390px phone and pushed the whole page
        sideways; nine screens did it.
      */}
      {actions ? (
        <div className="flex max-w-full shrink-0 flex-wrap items-center gap-2">{actions}</div>
      ) : null}
    </header>
  )
}

export interface ButtonProps {
  readonly children?: ReactNode
  /**
   * `menu` and `menu-danger` draw the button as a row of a `MoreMenu` panel.
   * A server component cannot ask the menu whether it is inside one, so the
   * caller says so.
   */
  readonly variant?: keyof typeof BUTTON_VARIANT | 'menu' | 'menu-danger'
  readonly size?: keyof typeof BUTTON_SIZE
  readonly icon?: IconName
  /** Places the glyph after the label — for "next", "open". */
  readonly iconEnd?: IconName
  readonly href?: string
  /**
   * The `href` hands back a file rather than a page — renders a plain `<a>`.
   *
   * A route handler is not a destination the client router can render, so a
   * `<Link>` at one is all cost and no benefit: the prefetcher spends a real
   * request on the response (a session lookup and a generated file, on a
   * handler that has no idea it is being speculated about) and then discards
   * it, and the click resolves through the fallback to a full navigation
   * anyway.
   *
   * The HTML `download` attribute is deliberately *not* set. It forces a save
   * on whatever comes back, including a `401` or a `404` body, which turns an
   * expired session into a file named after the route containing a line of
   * JSON. Left off, `Content-Disposition` still downloads what should be
   * downloaded, and an error stays a page the reader can see.
   */
  readonly download?: boolean
  readonly type?: 'button' | 'submit'
  /**
   * On a `<button>`, the attribute. On a link, `aria-disabled` and out of the
   * tab order.
   *
   * `disabled` is not an anchor attribute — React drops it, and the link used
   * to look dimmed while staying focusable and announced as a live link. A
   * destination that should never be reachable is still better not rendered
   * at all; this is for the one that is reachable *later* (a download that
   * needs a document first) and wants to show where it will be.
   */
  readonly disabled?: boolean
  readonly className?: string
  readonly title?: string
  readonly 'aria-label'?: string
}

/**
 * Renders a `<Link>` when given an `href` and a `<button>` otherwise — or a
 * plain `<a>` when that href is a file rather than a page, see `download`.
 *
 * One component rather than two because the *only* difference that should
 * survive to the reader is whether it navigates — a link styled as a button
 * and a button styled as a link is how keyboard users end up unable to
 * activate half an interface.
 */
export function Button({
  children,
  variant = 'secondary',
  size = 'md',
  icon,
  iconEnd,
  href,
  download = false,
  type = 'button',
  disabled = false,
  className,
  ...rest
}: ButtonProps) {
  const classes = [
    variant === 'menu'
      ? MENU_ITEM
      : variant === 'menu-danger'
        ? MENU_ITEM_DANGER
        : buttonClass(variant, size),
    // Dimmed and inert, but still readable — a pending submit says what it is
    // doing, and a label nobody can read is worse than a live button.
    disabled ? 'pointer-events-none opacity-60' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ')

  // A disabled link is announced as one and skipped by Tab (see `disabled`).
  const inert = disabled ? ({ 'aria-disabled': true, tabIndex: -1 } as const) : {}

  const inner = (
    <>
      {icon ? <Icon name={icon} size={16} strokeWidth={2} /> : null}
      {children}
      {iconEnd ? <Icon name={iconEnd} size={16} strokeWidth={2} /> : null}
    </>
  )

  if (href && download) {
    return (
      <a href={href} className={classes} {...inert} {...rest}>
        {inner}
      </a>
    )
  }

  return href ? (
    <Link href={href as Route} className={classes} {...inert} {...rest}>
      {inner}
    </Link>
  ) : (
    <button type={type} className={classes} disabled={disabled} {...rest}>
      {inner}
    </button>
  )
}

export function EmptyState({
  icon = 'enquiries',
  title,
  description,
  action,
  variant = 'page',
  className,
}: {
  readonly icon?: IconName
  readonly title: string
  readonly description?: string
  readonly action?: ReactNode
  /**
   * An empty *section* is not an empty *page*.
   *
   * The centred treatment below is sized for a card whose entire body is
   * missing — it wants the room, and the reader's eye has nowhere else to go.
   * A section inside a card that has other content is the opposite case: the
   * heading it belongs to sits at the inline start, and centring the note
   * across a wide card strands it in the middle of an acre of nothing, a
   * quarter of a screen away from the words it answers. `inline` is a quiet
   * line of prose that stays next to its heading.
   */
  readonly variant?: 'page' | 'inline'
  readonly className?: string
}) {
  if (variant === 'inline') {
    return (
      <div
        className={['flex items-start gap-2 text-body-sm text-ink-muted', className]
          .filter(Boolean)
          .join(' ')}
      >
        <Icon name={icon} size={15} className="mt-px shrink-0 text-ink-subtle" />
        {/* The title is a phrase with no full stop ("Nothing delivered yet"),
            so run straight into the hint it read as one broken sentence:
            "Nothing delivered yet Capture the signature…". Weight and a dash
            make it a heading and its note, in either language. */}
        <span>
          <span className="font-medium">{title}</span>
          {description ? <span className="text-ink-subtle"> — {description}</span> : null}
        </span>
        {action}
      </div>
    )
  }

  return (
    <div
      className={['flex flex-col items-center px-6 py-12 text-center', className]
        .filter(Boolean)
        .join(' ')}
    >
      <span className="mb-3 flex size-11 items-center justify-center rounded-full bg-surface-sunken text-ink-subtle">
        <Icon name={icon} size={20} />
      </span>
      <p className="text-title font-medium text-ink">{title}</p>
      {description ? (
        <p className="mt-1 max-w-sm text-body-sm text-ink-muted">{description}</p>
      ) : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  )
}

/**
 * A labelled value.
 *
 * The job file and the tracking page are mostly this: forty pairs of "what it
 * is called" and "what it says". Defining it once is what stops the same pair
 * being spelled three different ways across three screens.
 */
export function Field({
  label,
  children,
  mono = false,
  className,
}: {
  readonly label: ReactNode
  readonly children: ReactNode
  /** For references, container numbers and bill numbers. */
  readonly mono?: boolean
  readonly className?: string
}) {
  return (
    <div className={['min-w-0', className].filter(Boolean).join(' ')}>
      <dt className="eyebrow mb-1">{label}</dt>
      {/*
        Two lines, then an ellipsis — not one. A customer called "Fintas Steel
        Industries" in a quarter-width column read "Fintas Steel I…", and the
        name is the one thing on that card a person came to check. The title
        still carries the whole value for anything longer.
      */}
      <dd
        className={`line-clamp-2 text-body break-words text-ink ${mono ? 'ref numeric' : ''}`}
        title={typeof children === 'string' ? children : undefined}
      >
        {children}
      </dd>
    </div>
  )
}

/**
 * A lane: origin → destination.
 *
 * A component rather than a formatted string, and the reason is bidi. `U+2192
 * RIGHTWARDS ARROW` is not a mirrored character, so in Arabic the text
 * reorders correctly — origin to the right, destination to the left — while
 * the arrow keeps pointing right, back at the origin. A drawn arrow with
 * `rtl:-scale-x-100` points at the destination in both directions.
 *
 * `formatLane` still exists for `title` and `aria-label`, where a plain string
 * is the only thing accepted and no glyph is drawn.
 */
export function Lane({
  origin,
  destination,
  className,
}: {
  readonly origin: string
  readonly destination: string
  readonly className?: string
}) {
  return (
    // Wraps, origin over destination, whenever the line does not fit: held to
    // one line, a lane was the widest cell in a phone register and its two
    // names truncated to "Ista… → Shuw…" — the one fact the column exists to
    // show. It used to stop wrapping at md, and then "Nhava Sheva → Shuwaikh"
    // on one line was 286px of a 966px card and the reason the enquiry and
    // job registers scrolled sideways at 1280. Wrapping costs nothing where
    // there is room: a table gives a cell its one-line width when it can.
    <span
      className={['inline-flex flex-wrap items-center gap-x-1.5', className]
        .filter(Boolean)
        .join(' ')}
    >
      <span className="truncate">{origin}</span>
      {/* The arrow travels with the destination (a no-break pair): wrapped on
          its own, it sat alone on a middle line between two place names. */}
      <span className="inline-flex min-w-0 items-center gap-x-1.5">
        <Icon name="arrow-end" size={13} className="shrink-0 opacity-60" />
        <span className="truncate">{destination}</span>
      </span>
    </span>
  )
}

/**
 * The dashboard's column grid. Twelve columns, collapsing to one on a narrow page.
 *
 * Twelve from a 56rem content area (the layout's `<main>` is the container),
 * not from the window's `lg`: at a 1024px window the sidebar leaves 712px, and
 * a four-twelfths card in that is a 230px column nobody can read a table in.
 */
export function Grid({
  children,
  className,
}: {
  readonly children: ReactNode
  readonly className?: string
}) {
  return (
    <div
      className={['grid grid-cols-1 gap-4 @4xl:grid-cols-12', className].filter(Boolean).join(' ')}
    >
      {children}
    </div>
  )
}
