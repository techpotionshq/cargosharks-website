/**
 * The pager under every register — "51–100 of 336", and the way to the rest.
 *
 * Links rather than buttons, for the reason the register's filters are links
 * (`ui/register.tsx`): page three of the overdue invoices is a URL someone can
 * bookmark or send, it costs no JavaScript, and it composes with every filter
 * and search term already in the query string because `pageHref` carries them.
 *
 * It always prints the range and the total, even on a register that fits one
 * page. The total is the figure live run 5 could not find anywhere on the jobs
 * board, and a register that says "1–12 of 12" is one nobody has to wonder
 * about.
 *
 * A server component that fetches its own words, like `LanguageSwitch`: twenty
 * registers passing the same five labels down would be twenty places for one
 * of them to drift.
 */

import type { Route } from 'next'
import Link from 'next/link'
import { getLocale, getTranslations } from 'next-intl/server'
import { DEFAULT_LOCALE, isLocale } from '@/i18n/request'
import { formatNumber } from '@/lib/format'
import { pageCount, pageHref, pageOffset, type Page } from '@/lib/paging'
import { Icon } from './icon'

const LINK =
  'inline-flex h-8 items-center gap-1 rounded-sm border border-line bg-surface px-3 text-body-sm font-medium text-ink transition-colors hover:bg-surface-sunken max-md:h-10'
const INERT =
  'inline-flex h-8 items-center gap-1 rounded-sm border border-line px-3 text-body-sm font-medium text-ink-subtle opacity-60 max-md:h-10'

export async function Pager({
  page,
  path,
  params = {},
  param = 'page',
  className,
}: {
  readonly page: Pick<Page<unknown>, 'total' | 'page' | 'size'>
  /** The register's own path — `/jobs`, `/portal/invoices`. */
  readonly path: string
  /** Every query parameter the current view carries, so the next page keeps it. */
  readonly params?: Readonly<Record<string, string | undefined>>
  /** The query parameter this list pages by, where a screen carries two lists. */
  readonly param?: string
  readonly className?: string
}) {
  if (page.total === 0) return null

  const t = await getTranslations('common')
  const resolved = await getLocale()
  const locale = isLocale(resolved) ? resolved : DEFAULT_LOCALE
  const pages = pageCount(page)
  const offset = pageOffset(page)
  // Past the end — a bookmark from when the register was longer. Say so, and
  // point back at the last page that has rows, rather than an empty table that
  // reads as "nothing here".
  const past = offset >= page.total
  const previous = past ? pages : page.page > 1 ? page.page - 1 : null
  const next = !past && page.page < pages ? page.page + 1 : null
  const n = (value: number) => formatNumber(value, locale)

  return (
    <nav
      aria-label={t('pages')}
      data-pager=""
      className={[
        'flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-3',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <p className="numeric text-caption text-ink-muted" data-pager-range="">
        {past
          ? t('pagePast', { page: n(page.page), pages: n(pages) })
          : t('pageRange', {
              from: n(offset + 1),
              to: n(Math.min(offset + page.size, page.total)),
              total: n(page.total),
            })}
      </p>

      {pages > 1 ? (
        <div className="flex items-center gap-2">
          {previous !== null ? (
            <Link
              href={pageHref(path, params, previous, param) as Route}
              rel="prev"
              className={LINK}
            >
              <Icon name="chevron-start" size={14} />
              {t('previousPage')}
            </Link>
          ) : (
            <span className={INERT} aria-disabled="true">
              <Icon name="chevron-start" size={14} />
              {t('previousPage')}
            </span>
          )}
          <span className="numeric text-caption text-ink-muted">
            {t('pageOf', { page: n(Math.min(page.page, pages)), pages: n(pages) })}
          </span>
          {next !== null ? (
            <Link href={pageHref(path, params, next, param) as Route} rel="next" className={LINK}>
              {t('nextPage')}
              <Icon name="chevron-end" size={14} />
            </Link>
          ) : (
            <span className={INERT} aria-disabled="true">
              {t('nextPage')}
              <Icon name="chevron-end" size={14} />
            </span>
          )}
        </div>
      ) : null}
    </nav>
  )
}
