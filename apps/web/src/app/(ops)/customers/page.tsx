/**
 * The customer list.
 *
 * The first screen of the product that is genuinely a *register* rather than a
 * board: the operator comes here to find one company, not to triage. So it is
 * a search box and a table, and the search is a plain form submitting a query
 * parameter — no client state, no debounce, and it works with JavaScript off.
 */

import Link from 'next/link'
import type { Metadata } from 'next'
import { getLocale, getTranslations } from 'next-intl/server'
import { requireSession } from '@/lib/session'
import { can } from '@/lib/permissions'
import { listCustomers } from '@/features/customers/queries'
import { DEFAULT_LOCALE, isLocale } from '@/i18n/request'
import { Button } from '@/ui/layout'
import { RECORD_LINK, Register } from '@/ui/register'
import { Badge } from '@/ui/status'
import { TableShell, TBody, TD, TH, THead, TR } from '@/ui/table'
import { Pager } from '@/ui/pager'
import { pageRequest } from '@/lib/paging'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('customers')
  return { title: t('title') }
}

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string }>
}) {
  const session = await requireSession()
  const { q, page } = await searchParams
  const t = await getTranslations('customers')
  const tc = await getTranslations('common')
  const resolved = await getLocale()
  const locale = isLocale(resolved) ? resolved : DEFAULT_LOCALE

  const customersPage = await listCustomers(session.actor, q, pageRequest(page))
  const rows = customersPage.rows
  const mayWrite = can(session, 'customer.write')

  const action = mayWrite ? (
    <Button href="/customers/new" variant="primary" icon="plus">
      {t('new')}
    </Button>
  ) : null

  return (
    <Register
      eyebrow={t('eyebrow')}
      title={t('title')}
      description={t('subtitle')}
      actions={action}
      search={{
        action: '/customers',
        value: q,
        placeholder: t('searchPlaceholder'),
        label: tc('search'),
      }}
      isEmpty={customersPage.total === 0}
      empty={{
        icon: 'customers',
        title: q ? t('noneMatching') : t('noneYet'),
        description: q ? t('noneMatchingHint') : t('noneYetHint'),
        action: q ? undefined : (action ?? undefined),
      }}
    >
      <TableShell>
        <THead>
          <TR>
            <TH>{t('code')}</TH>
            <TH>{t('name')}</TH>
            <TH priority="low">{t('country')}</TH>
            <TH priority="low">{t('branch')}</TH>
            <TH priority="low" align="end">
              {t('openJobs')}
            </TH>
            <TH>{tc('status')}</TH>
          </TR>
        </THead>
        <TBody>
          {rows.map((row) => (
            <TR key={row.id}>
              <TD className="whitespace-nowrap">
                <Link href={`/customers/${row.id}`} className={RECORD_LINK}>
                  {row.code}
                </Link>
              </TD>
              <TD className="font-medium text-ink">
                <Link href={`/customers/${row.id}`} className="hover:underline">
                  {locale === 'ar' && row.legalNameAr ? row.legalNameAr : row.legalNameEn}
                </Link>
              </TD>
              <TD priority="low" className="whitespace-nowrap text-ink-muted">
                {row.countryCode ?? '—'}
              </TD>
              <TD priority="low" className="whitespace-nowrap text-ink-muted">
                {row.branchCode ?? '—'}
              </TD>
              <TD priority="low" align="end" numeric>
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
      <Pager page={customersPage} path="/customers" params={{ q }} />
    </Register>
  )
}
