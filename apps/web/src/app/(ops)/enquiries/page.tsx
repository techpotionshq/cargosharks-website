/**
 * The enquiry board — `FR-EQ-01`, Moment 3a.
 *
 * Reads through the slice's `queries.ts` under the caller's own actor, so the
 * page carries no branch filter of its own. RSC streaming plus keyset
 * pagination is what meets the two-second list budget (§12) without a cache.
 *
 * The filters are links, not client state. A filtered queue is a URL an
 * operations manager can bookmark, send to a colleague, or leave open on a
 * second screen — none of which a `useState` filter can do.
 */

import type { Metadata } from 'next'
import { getLocale, getTranslations } from 'next-intl/server'
import { requireSession } from '@/lib/session'
import { listEnquiries } from '@/features/enquiries/queries'
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
  searchParams: Promise<{ filter?: string }>
}) {
  const session = await requireSession()
  const params = await searchParams
  const filter = (FILTERS.find((f) => f.key === params.filter)?.key ?? 'all') as Filter

  const t = await getTranslations('enquiry')
  const tDash = await getTranslations('dashboard')
  const resolved = await getLocale()
  const locale = isLocale(resolved) ? resolved : DEFAULT_LOCALE

  /*
    The open queue once and the quoted list once, and every filter cut from
    those in memory.

    The board used to ask the database for whichever slice the filter named,
    so the counts beside the other filters were unknowable and the tiles
    above the table counted only the slice on screen — "Unassigned 0" while
    the unassigned filter held three. Cutting every view from the same rows
    is what lets the strip carry counts that agree with what a click shows.
    The predicates are the ones the query used (`unassignedOnly`,
    `overdueOnly`), applied here instead.
  */
  const [open, quoted] = await Promise.all([
    listEnquiries(session.actor, { status: 'open', limit: 100 }, locale),
    listEnquiries(session.actor, { status: 'quoted', limit: 100 }, locale),
  ])

  const now = Date.now()
  const isBreached = (r: (typeof open)[number]) =>
    r.firstRespondedAt === null && r.slaDueAt !== null && r.slaDueAt.getTime() < now
  const views: Record<Filter, typeof open> = {
    all: open,
    unassigned: open.filter((r) => r.owner === null),
    overdue: open.filter(isBreached),
    quoted,
  }
  const rows = views[filter]

  const priced = open.filter((r) => r.quotedMargin !== null)
  const avgMargin =
    priced.reduce((sum, r) => sum + (r.quotedMargin ?? 0), 0) / Math.max(priced.length, 1)

  return (
    <Register
      eyebrow={tDash('quotesEyebrow')}
      title={t('title')}
      description={t('subtitle')}
      actions={<NewEnquiryButton />}
      summary={[
        { label: t('filterAll'), value: formatNumber(open.length, locale) },
        { label: t('filterUnassigned'), value: formatNumber(views.unassigned.length, locale) },
        {
          label: t('filterOverdue'),
          value: (
            <span className={views.overdue.length > 0 ? 'text-critical' : undefined}>
              {formatNumber(views.overdue.length, locale)}
            </span>
          ),
        },
        { label: tDash('avgMargin'), value: `${avgMargin.toFixed(1)}%` },
      ]}
      filters={FILTERS.map((option) => ({
        label: t(option.label),
        href: option.key === 'all' ? '/enquiries' : `/enquiries?filter=${option.key}`,
        count: views[option.key].length,
        active: option.key === filter,
      }))}
      isEmpty={false}
      empty={{ title: '' }}
    >
      <EnquiryTable rows={rows} locale={locale} />
    </Register>
  )
}
