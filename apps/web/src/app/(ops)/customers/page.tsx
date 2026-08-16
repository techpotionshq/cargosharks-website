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
import { Button, EmptyState, PageHeader } from '@/ui/layout'
import { Badge } from '@/ui/status'
import { Icon } from '@/ui/icon'
import { TableShell, TBody, TD, TH, THead, TR } from '@/ui/table'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('customers')
  return { title: t('title') }
}

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>
}) {
  const session = await requireSession()
  const { q } = await searchParams
  const t = await getTranslations('customers')
  const tc = await getTranslations('common')
  const resolved = await getLocale()
  const locale = isLocale(resolved) ? resolved : DEFAULT_LOCALE

  const rows = await listCustomers(session.actor, q)
  const mayWrite = can(session, 'customer.write')

  return (
    <>
      <PageHeader
        eyebrow={t('eyebrow')}
        title={t('title')}
        description={t('subtitle')}
        actions={
          mayWrite ? (
            <Button href="/customers/new" variant="primary" icon="plus">
              {t('new')}
            </Button>
          ) : null
        }
      />

      <form action="/customers" className="relative mb-4 max-w-sm">
        <Icon
          name="search"
          size={16}
          className="pointer-events-none absolute start-2.5 top-1/2 -translate-y-1/2 text-ink-subtle"
        />
        <input
          type="search"
          name="q"
          defaultValue={q ?? ''}
          placeholder={t('searchPlaceholder')}
          aria-label={tc('search')}
          className="h-9 w-full rounded-sm border border-line bg-surface ps-8 pe-3 text-[0.8125rem] text-ink placeholder:text-ink-subtle focus:border-brand focus:outline-none"
        />
      </form>

      {rows.length === 0 ? (
        <div className="rounded-card border border-line bg-surface">
          <EmptyState
            icon="customers"
            title={q ? t('noneMatching') : t('noneYet')}
            description={q ? t('noneMatchingHint') : t('noneYetHint')}
            action={
              mayWrite && !q ? (
                <Button href="/customers/new" variant="primary" icon="plus">
                  {t('new')}
                </Button>
              ) : null
            }
          />
        </div>
      ) : (
        <TableShell>
          <THead>
            <TR>
              <TH>{t('code')}</TH>
              <TH>{t('name')}</TH>
              <TH>{t('country')}</TH>
              <TH>{t('branch')}</TH>
              <TH align="end">{t('openJobs')}</TH>
              <TH>{tc('status')}</TH>
            </TR>
          </THead>
          <TBody>
            {rows.map((row) => (
              <TR key={row.id}>
                <TD className="whitespace-nowrap">
                  <Link href={`/customers/${row.id}`} className="ref text-brand hover:underline">
                    {row.code}
                  </Link>
                </TD>
                <TD className="font-medium text-ink">
                  <Link href={`/customers/${row.id}`} className="hover:underline">
                    {locale === 'ar' && row.legalNameAr ? row.legalNameAr : row.legalNameEn}
                  </Link>
                </TD>
                <TD className="whitespace-nowrap text-ink-muted">{row.countryCode ?? '—'}</TD>
                <TD className="whitespace-nowrap text-ink-muted">{row.branchCode ?? '—'}</TD>
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
      )}
    </>
  )
}
