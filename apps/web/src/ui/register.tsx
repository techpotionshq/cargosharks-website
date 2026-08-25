/**
 * The register — the shape every "list of records" screen in the product takes.
 *
 * Twelve screens are a header, an optional search box, a filter strip and
 * either a table or an explanation of why there is nothing to show. Writing
 * that twelve times guarantees they drift; the fourth one gets a different
 * empty state, the seventh forgets the search box keeps its term.
 *
 * The filters are links rather than client state, deliberately. A filtered
 * register is a URL an operations manager can bookmark, send to a colleague or
 * leave open on a second screen — none of which a `useState` filter can do,
 * and it costs no JavaScript.
 */

import type { Route } from 'next'
import Link from 'next/link'
import type { ReactNode } from 'react'
import { Icon, type IconName } from './icon'
import { EmptyState, PageHeader } from './layout'

interface RegisterFilter {
  readonly label: string
  readonly href: string
  readonly count?: number
  readonly active: boolean
}

export interface RegisterProps {
  readonly eyebrow: ReactNode
  readonly title: ReactNode
  readonly description?: ReactNode
  readonly actions?: ReactNode
  /** Omitted where a register is short enough to read whole. */
  readonly search?: {
    readonly action: string
    readonly value?: string
    readonly placeholder: string
    readonly label: string
    /**
     * Query parameters the search form has to carry with it.
     *
     * The box is a GET form of its own, so submitting it replaces the whole
     * query string — and everything the filter strip had put there goes with
     * it. On a register whose filters are links that is a real loss: filter to
     * one table, type a term, and the table filter silently disappears while
     * the strip still draws it as active. Anything named here is re-submitted
     * as a hidden field, so the two controls compose instead of fighting.
     */
    readonly hidden?: Readonly<Record<string, string | undefined>>
  }
  readonly filters?: readonly RegisterFilter[]
  /** Small figures above the table — "of which 4 overdue". */
  readonly summary?: readonly { readonly label: string; readonly value: ReactNode }[]
  readonly empty: {
    readonly icon?: IconName
    readonly title: string
    readonly description?: string
    readonly action?: ReactNode
  }
  readonly isEmpty: boolean
  readonly children: ReactNode
}

export function Register({
  eyebrow,
  title,
  description,
  actions,
  search,
  filters,
  summary,
  empty,
  isEmpty,
  children,
}: RegisterProps) {
  return (
    <>
      <PageHeader eyebrow={eyebrow} title={title} description={description} actions={actions} />

      {summary?.length ? (
        <dl className="mb-4 flex flex-wrap items-baseline gap-x-8 gap-y-2 border-b border-line pb-4">
          {summary.map((item) => (
            <div key={item.label} className="flex items-baseline gap-2">
              <dt className="eyebrow">{item.label}</dt>
              <dd className="numeric text-[1.0625rem] font-semibold text-ink">{item.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}

      {search || filters?.length ? (
        <div className="mb-4 flex flex-wrap items-center gap-3">
          {search ? (
            <form action={search.action} className="relative max-w-xs flex-1">
              <Icon
                name="search"
                size={16}
                className="pointer-events-none absolute start-2.5 top-1/2 -translate-y-1/2 text-ink-subtle"
              />
              <input
                type="search"
                name="q"
                defaultValue={search.value ?? ''}
                placeholder={search.placeholder}
                aria-label={search.label}
                className="h-9 w-full rounded-md border border-line bg-surface ps-8 pe-3 text-[0.8125rem] text-ink placeholder:text-ink-subtle focus:border-brand focus:outline-none"
              />
              {Object.entries(search.hidden ?? {}).map(([name, value]) =>
                value === undefined || value === '' ? null : (
                  <input key={name} type="hidden" name={name} value={value} />
                ),
              )}
            </form>
          ) : null}

          {filters?.length ? (
            <nav className="flex flex-wrap items-center gap-1">
              {filters.map((filter) => (
                <Link
                  key={filter.href}
                  href={filter.href as Route}
                  aria-current={filter.active ? 'true' : undefined}
                  className={[
                    'inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[0.8125rem] transition-colors',
                    filter.active
                      ? 'bg-brand font-semibold text-on-brand'
                      : 'border border-line bg-surface font-medium text-ink-muted hover:bg-surface-sunken hover:text-ink',
                  ].join(' ')}
                >
                  {filter.label}
                  {filter.count !== undefined ? (
                    <span
                      className={`numeric text-[0.75rem] ${
                        filter.active ? 'text-on-brand/75' : 'text-ink-subtle'
                      }`}
                    >
                      {filter.count}
                    </span>
                  ) : null}
                </Link>
              ))}
            </nav>
          ) : null}
        </div>
      ) : null}

      {isEmpty ? (
        <div className="rounded-card border border-line bg-surface">
          <EmptyState
            icon={empty.icon}
            title={empty.title}
            description={empty.description}
            action={empty.action}
          />
        </div>
      ) : (
        children
      )}
    </>
  )
}

/**
 * A record's identifier, as the first cell of a register row.
 *
 * Monospace and brand-coloured, because a reference is a thing you read
 * against a printed document and then click.
 */
export function RecordLink({
  href,
  children,
}: {
  readonly href: string
  readonly children: ReactNode
}) {
  return (
    <Link href={href as Route} className="ref whitespace-nowrap text-brand hover:underline">
      {children}
    </Link>
  )
}
