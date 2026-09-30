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

import Link from 'next/link'
import { getLocale, getTranslations } from 'next-intl/server'
import { requireSession } from '@/lib/session'
import { listEnquiries } from '@/features/enquiries/queries'
import { EnquiryTable } from '@/features/enquiries/ui/enquiry-table'
import { DEFAULT_LOCALE, isLocale } from '@/i18n/request'
import { Card } from '@/ui/card'
import { PageHeader } from '@/ui/layout'
import { StatTile } from '@/ui/stat'
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

  const rows = await listEnquiries(
    session.actor,
    {
      status: filter === 'quoted' ? 'quoted' : 'open',
      unassignedOnly: filter === 'unassigned',
      overdueOnly: filter === 'overdue',
      limit: 100,
    },
    locale,
  )

  // Counted from the rows already fetched rather than three more round trips:
  // the queue is a hundred rows at most, and the tiles must agree with the
  // table under them — separate queries drift by a second and lose trust.
  const now = Date.now()
  const breached = rows.filter(
    (r) => r.firstRespondedAt === null && r.slaDueAt !== null && r.slaDueAt.getTime() < now,
  ).length
  const unassigned = rows.filter((r) => r.owner === null).length

  return (
    <>
      <PageHeader
        eyebrow={tDash('quotesEyebrow')}
        title={t('title')}
        description={t('subtitle')}
        actions={<NewEnquiryButton />}
      />

      <div className="mb-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile
          label={t('filterAll')}
          value={formatNumber(rows.length, locale)}
          icon="enquiries"
        />
        <StatTile
          label={t('filterUnassigned')}
          value={formatNumber(unassigned, locale)}
          icon="user"
          tone={unassigned > 0 ? 'caution' : 'muted'}
          href="/enquiries?filter=unassigned"
        />
        <StatTile
          label={t('filterOverdue')}
          value={formatNumber(breached, locale)}
          icon="alert"
          tone={breached > 0 ? 'critical' : 'positive'}
          href="/enquiries?filter=overdue"
        />
        <StatTile
          label={tDash('avgMargin')}
          value={`${(
            rows.reduce((sum, r) => sum + (r.quotedMargin ?? 0), 0) /
            Math.max(rows.filter((r) => r.quotedMargin !== null).length, 1)
          ).toFixed(1)}%`}
          icon="rates"
        />
      </div>

      <Card padding="none">
        <div className="flex flex-wrap items-center gap-1 border-b border-line p-3">
          {FILTERS.map((option) => {
            const active = option.key === filter
            return (
              <Link
                key={option.key}
                href={option.key === 'all' ? '/enquiries' : `/enquiries?filter=${option.key}`}
                aria-current={active ? 'page' : undefined}
                className={`rounded-sm px-3 py-1.5 text-[0.8125rem] font-medium transition-colors ${
                  active
                    ? 'bg-brand-soft text-brand-soft-ink'
                    : 'text-ink-muted hover:bg-surface-sunken hover:text-ink'
                }`}
              >
                {t(option.label)}
              </Link>
            )
          })}
        </div>

        <EnquiryTable rows={rows} locale={locale} />
      </Card>
    </>
  )
}
