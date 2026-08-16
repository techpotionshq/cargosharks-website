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

export function TableShell({
  children,
  className,
  /**
   * The width below which the table scrolls instead of crushing its columns.
   *
   * A board with eight columns needs a floor; a four-column panel sitting in a
   * third of the grid does not, and giving it one only guarantees that its
   * last columns are permanently off-screen.
   */
  minWidth = 'wide',
}: {
  readonly children: ReactNode
  readonly className?: string
  readonly minWidth?: 'wide' | 'none'
}) {
  return (
    // Wide boards scroll inside their own card rather than the page.
    <div className={['w-full overflow-x-auto', className].filter(Boolean).join(' ')}>
      <table
        className={`w-full border-collapse text-[0.8125rem] ${
          minWidth === 'wide' ? 'min-w-208' : ''
        }`}
      >
        {children}
      </table>
    </div>
  )
}

export function THead({ children }: { readonly children: ReactNode }) {
  return (
    <thead className="sticky top-0 z-10 bg-surface">
      <tr className="border-b border-line">{children}</tr>
    </thead>
  )
}

export function TH({
  children,
  align = 'start',
  className,
}: {
  readonly children?: ReactNode
  readonly align?: 'start' | 'end'
  readonly className?: string
}) {
  return (
    <th
      scope="col"
      className={[
        'px-3 py-2.5 text-[0.6875rem] font-semibold tracking-[0.06em] whitespace-nowrap text-ink-subtle uppercase',
        align === 'end' ? 'text-end' : 'text-start',
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
  const flagClass =
    flag === 'critical'
      ? 'shadow-[inset_2px_0_0_0_var(--qb-critical)]'
      : flag === 'caution'
        ? 'shadow-[inset_2px_0_0_0_var(--qb-caution)]'
        : flag === 'positive'
          ? 'shadow-[inset_2px_0_0_0_var(--qb-positive)]'
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
  className,
}: {
  readonly children?: ReactNode
  readonly align?: 'start' | 'end'
  readonly numeric?: boolean
  readonly className?: string
}) {
  return (
    <td
      className={[
        'px-3 py-2.5 align-middle text-ink',
        align === 'end' ? 'text-end' : 'text-start',
        numeric ? 'numeric' : '',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {children}
    </td>
  )
}
