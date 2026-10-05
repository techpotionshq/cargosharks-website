/**
 * Ports and places.
 *
 * Sorted by name but carrying a use count, because a forwarder's location
 * table is long and almost all of it is dead weight — the twenty places that
 * appear on real job files are the ones worth maintaining, and the count is
 * how you find them.
 */

import type { Metadata } from 'next'
import { getLocale, getTranslations } from 'next-intl/server'
import { requireSession } from '@/lib/session'
import { listLocations, locationCounts } from '@/features/network/queries'
import { Pager } from '@/ui/pager'
import { pageRequest } from '@/lib/paging'
import { DEFAULT_LOCALE, isLocale } from '@/i18n/request'
import { Register } from '@/ui/register'
import { Badge } from '@/ui/status'
import { Icon } from '@/ui/icon'
import { TableShell, TBody, TD, TH, THead, TR } from '@/ui/table'
import { LocationDialog, RetireNetworkDialog } from '@/features/network/ui/dialogs'

const KIND_ICON = {
  seaport: 'ship',
  airport: 'plane',
  inland: 'truck',
  warehouse: 'container',
  border: 'customs',
} as const

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('locations')
  return { title: t('title') }
}

export default async function LocationsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string }>
}) {
  const session = await requireSession()
  const { q, page } = await searchParams
  const t = await getTranslations('locations')
  const tc = await getTranslations('common')
  const resolved = await getLocale()
  const locale = isLocale(resolved) ? resolved : DEFAULT_LOCALE

  const [locationsPage, counts] = await Promise.all([
    listLocations(session.actor, q, pageRequest(page)),
    locationCounts(session.actor, q),
  ])
  const rows = locationsPage.rows

  return (
    <Register
      actions={<LocationDialog />}
      eyebrow={t('eyebrow')}
      title={t('title')}
      description={t('subtitle')}
      search={{
        action: '/locations',
        value: q,
        placeholder: t('searchPlaceholder'),
        label: tc('search'),
      }}
      summary={[
        { label: t('total'), value: counts.total },
        { label: t('inUse'), value: counts.inUse },
      ]}
      isEmpty={locationsPage.total === 0}
      empty={{
        icon: 'locations',
        title: q ? t('noneMatching') : t('noneYet'),
        description: q ? t('noneMatchingHint') : t('noneYetHint'),
      }}
    >
      <TableShell>
        <THead>
          <TR>
            <TH>{t('unlocode')}</TH>
            <TH>{t('name')}</TH>
            <TH priority="low">{t('kind')}</TH>
            <TH priority="low">{t('country')}</TH>
            <TH priority="low" align="end">
              {t('shipments')}
            </TH>
            <TH>{tc('status')}</TH>
            <TH align="end" />
          </TR>
        </THead>
        <TBody>
          {rows.map((row) => (
            <TR key={row.id}>
              <TD className="ref whitespace-nowrap text-ink">{row.unlocode ?? '—'}</TD>
              <TD className="font-medium text-ink">
                {locale === 'ar' && row.nameAr ? row.nameAr : row.nameEn}
              </TD>
              <TD priority="low">
                <span className="inline-flex items-center gap-1.5 text-ink-muted">
                  <Icon
                    name={KIND_ICON[row.kind as keyof typeof KIND_ICON] ?? 'locations'}
                    size={15}
                  />
                  {t(`kinds.${row.kind}`)}
                </span>
              </TD>
              <TD priority="low" className="whitespace-nowrap text-ink-muted">
                {row.countryCode ?? '—'}
              </TD>
              <TD
                priority="low"
                align="end"
                numeric
                className={row.useCount ? 'text-ink' : 'text-ink-subtle'}
              >
                {row.useCount || '—'}
              </TD>
              <TD>
                <Badge tone={row.isActive ? 'positive' : 'muted'}>
                  {row.isActive ? tc('active') : tc('inactive')}
                </Badge>
              </TD>
              <TD align="end">
                <RetireNetworkDialog
                  kind="location"
                  id={row.id}
                  name={locale === 'ar' && row.nameAr ? row.nameAr : row.nameEn}
                  isActive={row.isActive}
                />
              </TD>
            </TR>
          ))}
        </TBody>
      </TableShell>
      <Pager page={locationsPage} path="/locations" params={{ q }} />
    </Register>
  )
}
