/**
 * The document register — `FR-DC-01…08`.
 *
 * Newest first, across every shipment. Superseded versions stay in the list
 * rather than being filtered away: a house bill that was reissued is exactly
 * the record someone goes looking for when the customer is holding the old
 * one, and hiding it is how two versions end up in circulation.
 *
 * Paged, with a search box and a released / not-released filter. Live run 5
 * found a hundred and five documents in one list with nothing to narrow it,
 * and every shipment adds several more.
 */

import type { Metadata } from 'next'
import { getLocale, getTimeZone, getTranslations } from 'next-intl/server'
import { requireSession } from '@/lib/session'
import { documentCounts, listDocuments } from '@/features/operations/queries'
import { DEFAULT_LOCALE, isLocale } from '@/i18n/request'
import { formatDateTime } from '@/lib/format'
import { pageHref, pageRequest } from '@/lib/paging'
import { Pager } from '@/ui/pager'
import { Register, RecordLink } from '@/ui/register'
import { Badge } from '@/ui/status'
import { TableShell, TBody, TD, TH, THead, TR } from '@/ui/table'

const CATEGORY_TONE = {
  transport: 'info',
  commercial: 'brand',
  compliance: 'caution',
  partner_compliance: 'muted',
} as const

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('documents')
  return { title: t('title') }
}

export default async function DocumentsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; state?: string; page?: string }>
}) {
  const timeZone = await getTimeZone()

  const session = await requireSession()
  const t = await getTranslations('documents')
  const tc = await getTranslations('common')
  const resolved = await getLocale()
  const locale = isLocale(resolved) ? resolved : DEFAULT_LOCALE

  const params = await searchParams
  const q = params.q?.trim() || undefined
  // An unknown state is no filter, not an error (`lib/filters.ts`).
  const state = params.state === 'released' || params.state === 'draft' ? params.state : undefined

  const [documentsPage, counts] = await Promise.all([
    listDocuments(session.actor, locale, { search: q, state }, pageRequest(params.page)),
    documentCounts(session.actor, q),
  ])
  const rows = documentsPage.rows
  const hrefFor = (next: string | undefined) => pageHref('/documents', { q, state: next }, 1)

  return (
    <Register
      eyebrow={t('eyebrow')}
      title={t('title')}
      description={t('subtitle')}
      summary={[
        { label: t('total'), value: counts.total },
        { label: t('released'), value: counts.released },
        { label: t('draft'), value: counts.draft },
      ]}
      search={{
        action: '/documents',
        value: q,
        placeholder: t('searchPlaceholder'),
        label: tc('search'),
        // The filter survives a new search term, as the register's box promises.
        hidden: { state },
      }}
      filters={[
        { label: tc('all'), href: hrefFor(undefined), count: counts.total, active: !state },
        {
          label: t('released'),
          href: hrefFor('released'),
          count: counts.released,
          active: state === 'released',
        },
        {
          label: t('draft'),
          href: hrefFor('draft'),
          count: counts.draft,
          active: state === 'draft',
        },
      ]}
      isEmpty={documentsPage.total === 0}
      empty={
        q || state
          ? { icon: 'document', title: t('noneMatching'), description: t('noneMatchingHint') }
          : { icon: 'document', title: t('noneYet'), description: t('noneYetHint') }
      }
    >
      <TableShell>
        <THead>
          <TR>
            <TH>{t('shipment')}</TH>
            <TH>{t('type')}</TH>
            <TH priority="low">{t('customer')}</TH>
            <TH priority="low" align="end">
              {t('version')}
            </TH>
            <TH>{tc('status')}</TH>
            <TH priority="low">{t('author')}</TH>
            <TH priority="low">{t('created')}</TH>
          </TR>
        </THead>
        <TBody>
          {rows.map((row) => (
            /*
              A superseded version is set back by a sunken row and muted ink,
              and says so in its status pill — not by fading the whole row to
              55% opacity, which took every badge in it to 2.2:1.
            */
            <TR
              key={row.id}
              className={
                row.isSuperseded ? 'bg-surface-sunken/60 [&_td]:text-ink-muted' : undefined
              }
            >
              <TD>
                <RecordLink href={`/jobs/${row.jobId}`}>{row.jobReference}</RecordLink>
              </TD>
              <TD>
                <span className="font-medium text-ink">
                  {locale === 'ar' ? row.typeNameAr : row.typeNameEn}
                </span>
                <Badge
                  tone={CATEGORY_TONE[row.category as keyof typeof CATEGORY_TONE] ?? 'muted'}
                  className="ms-2"
                >
                  {t(`categories.${row.category}`)}
                </Badge>
              </TD>
              <TD priority="low" className="text-ink-muted">
                {(locale === 'ar' && row.customerNameAr) || row.customerName || '—'}
              </TD>
              <TD priority="low" align="end" numeric>
                v{row.version}
              </TD>
              <TD>
                {row.isSuperseded ? (
                  <Badge tone="muted" icon="clock">
                    {t('superseded')}
                  </Badge>
                ) : row.releasedAt ? (
                  <Badge tone="positive" icon="check">
                    {t('released')}
                  </Badge>
                ) : (
                  <Badge tone="caution">{t('draft')}</Badge>
                )}
              </TD>
              <TD priority="low" className="whitespace-nowrap text-ink-muted">
                {row.authorName ?? '—'}
              </TD>
              <TD priority="low" className="whitespace-nowrap text-ink-muted">
                {formatDateTime(row.createdAt, locale, timeZone)}
              </TD>
            </TR>
          ))}
        </TBody>
      </TableShell>
      <Pager page={documentsPage} path="/documents" params={{ q, state }} />
    </Register>
  )
}
