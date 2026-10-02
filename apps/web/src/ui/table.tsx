/**
 * Tables.
 *
 * The enquiry queue and the operations board are tables, and they are where an
 * operations manager spends the day — so density is a feature, not a
 * compromise. The treatment here is tuned for scanning: sticky header, a hover
 * row, hairline separators rather than a grid, and no zebra striping, which
 * fights the hover state and adds a second horizontal rhythm to a table that
 * already has one.
 *
 * Alignment is logical throughout (`text-start`, never `text-left`), so the
 * whole board mirrors correctly in Arabic. Numeric columns are the deliberate
 * exception: they align to the *end* in both directions, because a column of
 * figures reads against its decimal point regardless of script.
 */

import type { ReactNode } from 'react'

/**
 * Which columns survive a narrow table.
 *
 * Every register used to keep every column at every width and scroll
 * sideways, and on a 390px phone the first viewport held a reference and a
 * customer name — the status, the money and the date were all off to the
 * inline end, behind a scroll nobody could see was there. A column now says
 * how much it matters: `low` columns (customer, lane, owner — context the row
 * carries elsewhere) need a 48rem table; `lowest` (vessel, broker) need 56rem.
 * Reference, status and money are never marked, so they are what a phone sees.
 *
 * Measured against the *table's* width (`TableShell` is a size container), not
 * the window's. These were `md:` and `xl:`, and from `md` up the sidebar takes
 * 248px of the window: a 768px tablet gave the register 440px and every `low`
 * column at once, so thirty registers overflowed by ~360px with the money and
 * the status off-screen in both languages. A panel in a third of a grid is the
 * same case at any window size, and gets the same answer.
 *
 * The same value goes on the `TH` and on every `TD` in the column — a table
 * has no column element that can hide a whole column for us.
 */
export type ColumnPriority = 'high' | 'low' | 'lowest'

const PRIORITY_CLASS: Record<ColumnPriority, string> = {
  high: '',
  low: 'hidden @3xl:table-cell',
  lowest: 'hidden @4xl:table-cell',
}

export function TableShell({
  children,
  className,
  /**
   * `fill`: take whatever height the card has left, and scroll inside it.
   *
   * For a register that shares a grid row with something short. Left to run,
   * a forty-row table drags the row to its own length and every card beside
   * it ends in a column of dead canvas. The fix is *not* a height of the
   * table's own — a fixed cap only moves the dead canvas inside the card,
   * below the last row. The card owns the height (the grid stretches it, a
   * `max-h` bounds it) and the body claims the remainder, so the last row is
   * always at the card's bottom edge whichever way the row was sized.
   *
   * `min-h-0` because a flex child's floor is its content: without it a
   * forty-row table refuses to shrink and pushes the card past its cap
   * instead of scrolling. `qb-scroll` draws the bar, since a panel whose
   * scrollbar is hidden until hover is indistinguishable from a short one.
   *
   * `THead` is already `sticky top-0`, which does nothing until there is a
   * vertical scroll container for it to stick inside; this is that container.
   * Both axes are `auto` on the one element, which is the arrangement sticky
   * wants — the case that breaks it is `overflow-x` scrolling against a
   * `visible` cross axis, and `visible` is exactly what `auto` is not.
   */
  scroll = 'none',
}: {
  readonly children: ReactNode
  readonly className?: string
  readonly scroll?: 'none' | 'fill'
}) {
  return (
    // Wide boards scroll inside their own card rather than the page.
    <div
      className={[
        // `qb-scroll-x` draws a soft edge on whichever side has more columns
        // behind it — see globals.css. `@container` is what the columns'
        // priorities and the cells' padding measure; see `ColumnPriority`.
        'qb-scroll-x @container w-full overflow-x-auto',
        scroll === 'fill' ? 'qb-scroll min-h-0 flex-1 overflow-y-auto' : '',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {/*
        No floor. There was a 52rem minimum from md up, so a wide board
        scrolled rather than crushed its columns — and once the columns that
        do not fit leave by priority, the floor only guaranteed a scroll in
        the band between "the low columns appear" and 52rem. A register that
        still does not fit scrolls inside this box on its own merits.
      */}
      <table className="w-full border-collapse text-body-sm">{children}</table>
    </div>
  )
}

/**
 * The header group. Takes a `<TR>`, exactly like `TBody` does.
 *
 * It used to emit its own `<tr>` around whatever it was given, and fifteen of
 * the twenty call sites passed a `<TR>` anyway — producing `<tr><tr><th>`.
 * A nested row is not repairable markup: the browser leaves the `<th>`s
 * outside the table's column algorithm, so the header cells sized themselves
 * to their text while the body cells sized to the table, and every register in
 * the product had a header whose columns did not line up with its rows.
 *
 * Requiring the `<TR>` is the fix that cannot regress: the header now has the
 * same shape as the body, so there is no longer a right and a wrong way to
 * write one.
 */
export function THead({ children }: { readonly children: ReactNode }) {
  return (
    <thead className="sticky top-0 z-10 bg-surface [&>tr]:border-b [&>tr]:border-line">
      {children}
    </thead>
  )
}

export function TH({
  children,
  align = 'start',
  priority = 'high',
  className,
}: {
  readonly children?: ReactNode
  readonly align?: 'start' | 'end'
  readonly priority?: ColumnPriority
  readonly className?: string
}) {
  return (
    <th
      scope="col"
      className={[
        // In a table under 48rem the padding tightens (the shell is the size
        // container, as for `ColumnPriority`). A phone has room for three or four
        // columns, and 24px of padding per column was most of the margin by
        // which the last of them fell off-screen; 12px still reads as a gap.
        // Under 72rem it is 20px rather than 24px: nine columns at 1280 have
        // 966px between them, and the 36px that saves is a whole column of
        // the enquiry queue no longer pushed out of its card.
        //
        // A header may wrap onto a second line at any width, and only does
        // when its column is squeezed — the table gives every column its
        // one-line width when there is room. Held to one line from md up,
        // "WORKING CALENDAR" and "REVENUE / COST" were each the widest thing
        // in their column, and the reason the branch and charge-type tables
        // scrolled at 1280 with every cell beneath them already wrapping.
        'px-1.5 py-2.5 text-micro font-semibold tracking-[0.06em] text-ink-subtle uppercase @xl:px-2 @3xl:px-2.5 @6xl:px-3',
        align === 'end' ? 'text-end' : 'text-start',
        PRIORITY_CLASS[priority],
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {children}
    </th>
  )
}

export function TBody({ children }: { readonly children: ReactNode }) {
  return <tbody className="divide-y divide-line">{children}</tbody>
}

export function TR({
  children,
  className,
  /** Draws an inline-start rule in a status colour — used for breached rows. */
  flag,
}: {
  readonly children: ReactNode
  readonly className?: string
  readonly flag?: 'critical' | 'caution' | 'positive'
}) {
  /*
    An inset shadow has no logical form — `2px 0` is the *left* edge in both
    directions — so the rule sat on the far side of an Arabic row, beside the
    last column instead of the reference. The `rtl:` twin moves it to the
    inline start, which is where the eye enters the row.
  */
  const flagClass =
    flag === 'critical'
      ? 'shadow-[inset_2px_0_0_0_var(--qb-critical)] rtl:shadow-[inset_-2px_0_0_0_var(--qb-critical)]'
      : flag === 'caution'
        ? 'shadow-[inset_2px_0_0_0_var(--qb-caution)] rtl:shadow-[inset_-2px_0_0_0_var(--qb-caution)]'
        : flag === 'positive'
          ? 'shadow-[inset_2px_0_0_0_var(--qb-positive)] rtl:shadow-[inset_-2px_0_0_0_var(--qb-positive)]'
          : ''

  return (
    <tr
      className={['group transition-colors hover:bg-surface-sunken', flagClass, className]
        .filter(Boolean)
        .join(' ')}
    >
      {children}
    </tr>
  )
}

export function TD({
  children,
  align = 'start',
  numeric = false,
  priority = 'high',
  className,
}: {
  readonly children?: ReactNode
  readonly align?: 'start' | 'end'
  readonly numeric?: boolean
  readonly priority?: ColumnPriority
  readonly className?: string
}) {
  return (
    <td
      className={[
        // Tighter under 48rem for the same reason as the header; see `TH`. A
        // long status pill may also wrap there: "Awaiting documents" held to
        // one line was the widest thing in several registers, and it pushed
        // the figure beside it off a phone. A short one does not (`Badge`
        // marks it): two words broken one per line read as a rendering fault.
        // Its leading dot goes too: the pill's own colour already carries the
        // tone, and the dot's 12px was the last few pixels of a phone row.
        'px-1.5 py-2.5 align-middle text-ink @xl:px-2 @3xl:px-2.5 @6xl:px-3 @max-3xl:[&_[data-badge]:not([data-short])]:whitespace-normal @max-3xl:[&_[data-dot]]:hidden',
        align === 'end' ? 'text-end' : 'text-start',
        // A figure never wraps: "KWD 1,840.500" broken after the code is two
        // half-numbers, and a column of them stops aligning on the decimal.
        numeric ? 'numeric whitespace-nowrap' : '',
        PRIORITY_CLASS[priority],
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {children}
    </td>
  )
}
