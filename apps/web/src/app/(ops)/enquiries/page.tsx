/**
 * The enquiry board — `FR-EQ-01`, Moment 3a.
 *
 * Reads through the slice's `queries.ts` under the caller's own actor, so the
 * page carries no branch filter of its own. RSC streaming plus a page of
 * fifty (`lib/paging.ts`) is what meets the two-second list budget (§12)
 * without a cache.
 *
 * The filters are links, not client state. A filtered queue is a URL an
 * operations manager can bookmark, send to a colleague, or leave open on a
 * second screen — none of which a `useState` filter can do.
 */

import type { Metadata } from 'next'
import { getLocale, getTranslations } from 'next-intl/server'
import { requireSession } from '@/lib/session'
import {
  countEnquiries,
  listEnquiries,
  type EnquiryListFilters,
} from '@/features/enquiries/queries'
import { Pager } from '@/ui/pager'
import { pageRequest } from '@/lib/paging'
import { EnquiryTable } from '@/features/enquiries/ui/enquiry-table'
import { DEFAULT_LOCALE, isLocale } from '@/i18n/request'
import { Register } from '@/ui/register'
import { formatNumber } from '@/lib/format'
import { NewEnquiryButton } from '@/features/enquiries/ui/new-enquiry-dialog'

type Filter = 'all' | 'unassigned' | 'overdue' | 'quoted'

const FILTERS: readonly {
  key: Filter
  label: 'filterAll' | 'filterUnassigned' | 'filterOverdue' | 'filterQuoted'
}[] = [
  { key: 'all', label: 'filterAll' },
  { key: 'unassigned', label: 'filterUnassigned' },
  { key: 'overdue', label: 'filterOverdue' },
  { key: 'quoted', label: 'filterQuoted' },
]

/** The tab says which screen this is, as the sidebar does, in the reader's language. */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('nav')
  return { title: t('enquiries') }
}

export default async function EnquiriesPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string; page?: string }>
}) {
  const session = await requireSession()
  const params = await searchParams
  const filter = (FILTERS.find((f) => f.key === params.filter)?.key ?? 'all') as Filter

  const t = await getTranslations('enquiry')
  const tDash = await getTranslations('dashboard')
  const resolved = await getLocale()
  const locale = isLocale(resolved) ? resolved : DEFAULT_LOCALE

  /*
    One page of the filtered queue, and every figure on the strip counted.

    The board once asked for whichever slice the filter named and counted it,
    so the strip disagreed with itself ("Unassigned 0" while the filter held
    three). The fix for that cut every view from a hundred open and a hundred
    quoted rows in memory, which agreed with itself and stopped at a hundred.
    Now the filter is part of the query, the table pages, and the counts come
    from one counting query over every row, so they agree with what each
    filter pages through however long the queue gets.
  */
  const FILTER_QUERY: Record<Filter, EnquiryListFilters> = {
    all: { status: 'open' },
    unassigned: { status: 'open', unassignedOnly: true },
    overdue: { status: 'open', overdueOnly: true },
    quoted: { status: 'quoted' },
  }
  const [enquiriesPage, counts] = await Promise.all([
    listEnquiries(session.actor, FILTER_QUERY[filter], locale, pageRequest(params.page)),
    countEnquiries(session.actor),
  ])
  const filterCounts: Record<Filter, number> = {
    all: counts.open,
    unassigned: counts.unassigned,
    overdue: counts.overdue,
    quoted: counts.quoted,
  }

  return (
    <Register
      eyebrow={tDash('quotesEyebrow')}
      title={t('title')}
      description={t('subtitle')}
      actions={<NewEnquiryButton />}
      summary={[
        { label: t('filterAll'), value: formatNumber(counts.open, locale) },
        { label: t('filterUnassigned'), value: formatNumber(counts.unassigned, locale) },
        {
          label: t('filterOverdue'),
          value: (
            <span className={counts.overdue > 0 ? 'text-critical' : undefined}>
              {formatNumber(counts.overdue, locale)}
            </span>
          ),
        },
        { label: tDash('avgMargin'), value: `${counts.avgMargin.toFixed(1)}%` },
      ]}
      filters={FILTERS.map((option) => ({
        label: t(option.label),
        href: option.key === 'all' ? '/enquiries' : `/enquiries?filter=${option.key}`,
        count: filterCounts[option.key],
        active: option.key === filter,
      }))}
      isEmpty={false}
      empty={{ title: '' }}
    >
      <EnquiryTable rows={enquiriesPage.rows} locale={locale} />
      <Pager page={enquiriesPage} path="/enquiries" params={{ filter: params.filter }} />
    </Register>
  )
}
