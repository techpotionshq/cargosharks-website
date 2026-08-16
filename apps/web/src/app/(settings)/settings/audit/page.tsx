/**
 * The audit trail — `FR-AD-03`, §5.4.
 *
 * Written by a database trigger rather than by application code, which is the
 * only version worth having: a write that goes round the application is still
 * recorded, and no developer can forget to log one. That also means this
 * screen is a *read* of ground truth rather than a report the application
 * generates about itself.
 */

import type { Metadata } from 'next'
import { getLocale, getTranslations } from 'next-intl/server'
import { requireSession } from '@/lib/session'
import { can } from '@/lib/permissions'
import { auditTableCounts, listAudit } from '@/features/admin/queries'
import { DEFAULT_LOCALE, isLocale } from '@/i18n/request'
import { formatDateTime, formatRelative } from '@/lib/format'
import { EmptyState, PageHeader } from '@/ui/layout'
import { Register } from '@/ui/register'
import { Badge } from '@/ui/status'
import { TableShell, TBody, TD, TH, THead, TR } from '@/ui/table'

const OP_TONE = { INSERT: 'positive', UPDATE: 'info', DELETE: 'critical' } as const

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('audit')
  return { title: t('title') }
}

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{ table?: string }>
}) {
  const session = await requireSession()
  const { table } = await searchParams
  const t = await getTranslations('audit')
  const tc = await getTranslations('common')
  const resolved = await getLocale()
  const locale = isLocale(resolved) ? resolved : DEFAULT_LOCALE
  const now = Date.now()

  if (!can(session, 'admin.audit.read')) {
    return (
      <>
        <PageHeader eyebrow={t('eyebrow')} title={t('title')} />
        <div className="rounded-card border border-line bg-surface">
          <EmptyState icon="hold" title={t('forbidden')} description={t('forbiddenHint')} />
        </div>
      </>
    )
  }

  const [rows, tables] = await Promise.all([
    listAudit(session.actor, table),
    auditTableCounts(session.actor),
  ])

  return (
    <Register
      eyebrow={t('eyebrow')}
      title={t('title')}
      description={t('subtitle')}
      filters={[
        { label: tc('all'), href: '/settings/audit', active: !table },
        ...tables.map((row) => ({
          label: row.tableName,
          href: `/settings/audit?table=${row.tableName}`,
          count: row.count,
          active: table === row.tableName,
        })),
      ]}
      isEmpty={rows.length === 0}
      empty={{ icon: 'audit', title: t('noneYet'), description: t('noneYetHint') }}
    >
      <TableShell>
        <THead>
          <TR>
            <TH>{t('when')}</TH>
            <TH>{t('operation')}</TH>
            <TH>{t('table')}</TH>
            <TH>{t('who')}</TH>
            <TH>{t('branch')}</TH>
            <TH>{t('record')}</TH>
            <TH>{t('ip')}</TH>
          </TR>
        </THead>
        <TBody>
          {rows.map((row) => (
            <TR key={row.id}>
              <TD className="whitespace-nowrap">
                <span className="text-ink">{formatRelative(row.at, locale, now)}</span>
                <span className="mt-0.5 block text-[0.75rem] text-ink-subtle">
                  {formatDateTime(row.at, locale)}
                </span>
              </TD>
              <TD>
                <Badge tone={OP_TONE[row.op as keyof typeof OP_TONE] ?? 'muted'}>{row.op}</Badge>
              </TD>
              <TD className="ref whitespace-nowrap text-ink">{row.tableName}</TD>
              <TD className="whitespace-nowrap">
                <span className="text-ink">{row.principalName ?? t('system')}</span>
                <span className="mt-0.5 block text-[0.75rem] text-ink-subtle">
                  {row.principalType}
                </span>
              </TD>
              <TD className="ref whitespace-nowrap text-ink-muted">{row.branchCode ?? '—'}</TD>
              <TD className="ref max-w-40 truncate text-[0.75rem] text-ink-subtle">
                {row.rowId ?? '—'}
              </TD>
              <TD className="ref whitespace-nowrap text-ink-subtle">{row.ip ?? '—'}</TD>
            </TR>
          ))}
        </TBody>
      </TableShell>
    </Register>
  )
}
