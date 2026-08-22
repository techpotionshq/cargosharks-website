/**
 * The consolidation board — every master sailing, and what is under it.
 *
 * The two numbers that matter on a row are the house count and the unallocated
 * cost count. The first says whether the master is worth sailing; the second
 * says whether anybody knows what it cost, and an open consolidation carrying
 * three unallocated costs is a groupage margin nobody can state.
 */

import Link from 'next/link'
import { getLocale, getTranslations } from 'next-intl/server'
import { requireSession } from '@/lib/session'
import { listConsolidations } from '@/features/consolidation/queries'
import { ConsolidationDialog } from '@/features/consolidation/ui/dialogs'
import { CandidatesPanel } from '@/features/consolidation/ui/candidates-panel'
import { DEFAULT_LOCALE, isLocale } from '@/i18n/request'
import { formatDate } from '@/lib/format'
import { Card } from '@/ui/card'
import { EmptyState, PageHeader } from '@/ui/layout'
import { Badge } from '@/ui/status'
import { TBody, TD, TH, THead, TR, TableShell } from '@/ui/table'

export default async function ConsolidationsPage() {
  const session = await requireSession()
  const [rows, t, tc, tMode] = await Promise.all([
    listConsolidations(session.actor),
    getTranslations('consolidations'),
    getTranslations('common'),
    getTranslations('mode'),
  ])

  const resolved = await getLocale()
  const locale = isLocale(resolved) ? resolved : DEFAULT_LOCALE

  return (
    <>
      <PageHeader
        eyebrow={t('eyebrow')}
        title={t('title')}
        description={t('description')}
        actions={<ConsolidationDialog />}
      />

      {/*
        The suggestions above the masters, deliberately.

        Everything in the table below is a consolidation somebody already
        decided to make. This is the list of the ones nobody noticed — loose
        LCL and air bookings sharing a lane and a sailing window — and it is
        the only place in the product where the consolidation that *did not*
        happen is visible at all. It renders nothing on a tidy week.
      */}
      <CandidatesPanel />

      <Card padding="none">
        {rows.length === 0 ? (
          <EmptyState icon="ship" title={t('none')} description={t('noneHint')} />
        ) : (
          <TableShell>
            <THead>
              <TR>
                <TH>{t('reference')}</TH>
                <TH>{t('masterBill')}</TH>
                <TH>{t('carrier')}</TH>
                <TH>{t('route')}</TH>
                <TH align="end">{t('houses')}</TH>
                <TH align="end">{t('volume')}</TH>
                <TH align="end">{t('etd')}</TH>
                <TH align="end">{tc('status')}</TH>
              </TR>
            </THead>
            <TBody>
              {rows.map((row) => (
                <TR key={row.id}>
                  <TD>
                    <Link
                      href={`/consolidations/${row.id}`}
                      className="ref numeric font-medium hover:text-brand"
                    >
                      {row.reference}
                    </Link>
                    <span className="mt-0.5 block text-[0.6875rem] text-ink-subtle">
                      {tMode(row.mode as 'sea_lcl')}
                    </span>
                  </TD>
                  <TD numeric className="text-ink-muted">
                    {row.masterBillNumber ?? '—'}
                  </TD>
                  <TD className="text-ink-muted">
                    {[row.vesselName, row.voyageNumber].filter(Boolean).join(' / ') ||
                      row.flightNumber ||
                      '—'}
                  </TD>
                  <TD className="text-ink-muted">
                    {[row.originName, row.destinationName].filter(Boolean).join(' → ') || '—'}
                  </TD>
                  <TD align="end" numeric>
                    {row.houseCount}
                  </TD>
                  <TD align="end" numeric className="text-ink-muted">
                    {Number(row.volumeCbm).toFixed(2)}
                  </TD>
                  <TD align="end" numeric className="text-ink-muted">
                    {formatDate(row.etd, locale)}
                  </TD>
                  <TD align="end">
                    <span className="inline-flex items-center gap-1.5">
                      {/*
                        An unallocated cost is the one thing on this row that
                        needs doing, so it is flagged beside the status rather
                        than buried on the detail page.
                      */}
                      {row.unallocatedCount > 0 ? (
                        <Badge tone="caution">{t('unallocated', { n: row.unallocatedCount })}</Badge>
                      ) : null}
                      <Badge tone={row.status === 'open' ? 'info' : 'muted'}>
                        {t(`statuses.${row.status}` as 'statuses.open')}
                      </Badge>
                    </span>
                  </TD>
                </TR>
              ))}
            </TBody>
          </TableShell>
        )}
      </Card>
    </>
  )
}
