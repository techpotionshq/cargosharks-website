/**
 * Partners and agents — the other half of the network.
 *
 * A forwarder's product *is* its agent network: the carrier that lifts the
 * box, the overseas agent that clears it, the broker who files the entry. The
 * column that matters is not the address, it is how much live work each one is
 * carrying, which is why `openJobs` sits in the table rather than on a detail
 * page nobody opens.
 */

import type { Metadata } from 'next'
import { getLocale, getTranslations } from 'next-intl/server'
import { requireSession } from '@/lib/session'
import { listPartners, partnerTypeCounts } from '@/features/network/queries'
import { DEFAULT_LOCALE, isLocale } from '@/i18n/request'
import { Register, RecordLink } from '@/ui/register'
import { Badge } from '@/ui/status'
import { TableShell, TBody, TD, TH, THead, TR } from '@/ui/table'
import { PartnerDialog } from '@/features/network/ui/dialogs'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('partners')
  return { title: t('title') }
}

export default async function PartnersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; type?: string }>
}) {
  const session = await requireSession()
  const { q, type } = await searchParams
  const t = await getTranslations('partners')
  const tc = await getTranslations('common')
  const resolved = await getLocale()
  const locale = isLocale(resolved) ? resolved : DEFAULT_LOCALE

  const [all, typeCounts] = await Promise.all([
    listPartners(session.actor, q),
    partnerTypeCounts(session.actor),
  ])

  // Filtered here rather than in SQL: the register is capped at 200 rows, and
  // a second round trip to a database 300ms away costs more than the filter.
  const rows = type ? all.filter((row) => row.type === type) : all

  const query = (next: Record<string, string | undefined>): string => {
    const params = new URLSearchParams()
    if (q) params.set('q', q)
    for (const [key, value] of Object.entries(next)) {
      if (value) params.set(key, value)
      else params.delete(key)
    }
    const search = params.toString()
    return search ? `/partners?${search}` : '/partners'
  }

  return (
    <Register
      actions={<PartnerDialog />}
      eyebrow={t('eyebrow')}
      title={t('title')}
      description={t('subtitle')}
      search={{
        action: '/partners',
        value: q,
        placeholder: t('searchPlaceholder'),
        label: tc('search'),
      }}
      filters={[
        { label: tc('all'), href: query({ type: undefined }), active: !type, count: all.length },
        ...typeCounts.map((row) => ({
          label: t(`types.${row.type}`),
          href: query({ type: row.type }),
          count: row.count,
          active: type === row.type,
        })),
      ]}
      isEmpty={rows.length === 0}
      empty={{
        icon: 'partners',
        title: q || type ? t('noneMatching') : t('noneYet'),
        description: q || type ? t('noneMatchingHint') : t('noneYetHint'),
      }}
    >
      <TableShell>
        <THead>
          <TR>
            <TH>{t('code')}</TH>
            <TH>{t('name')}</TH>
            <TH>{t('type')}</TH>
            <TH>{t('country')}</TH>
            <TH align="end">{t('paymentTerms')}</TH>
            <TH align="end">{t('openJobs')}</TH>
            <TH>{tc('status')}</TH>
          </TR>
        </THead>
        <TBody>
          {rows.map((row) => (
            <TR key={row.id}>
              <TD>
                <RecordLink href={`/partners/${row.id}`}>{row.code}</RecordLink>
              </TD>
              <TD className="font-medium text-ink">
                {locale === 'ar' && row.legalNameAr ? row.legalNameAr : row.legalNameEn}
              </TD>
              <TD>
                <Badge tone="info">{t(`types.${row.type}`)}</Badge>
              </TD>
              <TD className="whitespace-nowrap text-ink-muted">{row.countryCode ?? '—'}</TD>
              <TD align="end" numeric>
                {row.paymentTermsDays === null ? '—' : t('days', { count: row.paymentTermsDays })}
              </TD>
              <TD align="end" numeric>
                {row.openJobs}
              </TD>
              <TD>
                <Badge tone={row.isActive ? 'positive' : 'muted'}>
                  {row.isActive ? tc('active') : tc('inactive')}
                </Badge>
              </TD>
            </TR>
          ))}
        </TBody>
      </TableShell>
    </Register>
  )
}
