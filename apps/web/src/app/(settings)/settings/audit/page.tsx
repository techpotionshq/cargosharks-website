/**
 * The audit trail — `FR-AD-02`, `FR-AD-03`, §5.4.
 *
 * Written by a database trigger rather than by application code, which is the
 * only version worth having: a write that goes round the application is still
 * recorded, and no developer can forget to log one. That also means this
 * screen is a *read* of ground truth rather than a report the application
 * generates about itself.
 *
 * ## Search, and why it took a while to be worth building
 *
 * The trail was complete and unsearchable, which is a strange half-state: the
 * evidence existed and could not be reached without a `psql` prompt. `FR-AD-02`
 * asks for search by record, person and date range, and `NFR-10` asks for
 * export; `Security_Measures.md` §6 carried both as open.
 *
 * The controls are links and a GET form rather than client state, following
 * the rest of the registers. On this screen the reason is sharper than
 * consistency: a filtered audit view is a thing somebody pastes into an
 * incident note or a message to counsel, and a URL that reproduces exactly
 * what the sender was looking at is most of what makes that note useful.
 * `/api/audit.csv` takes the same five parameters, so the file and the screen
 * are the same query and cannot drift.
 */

import type { Metadata } from 'next'
import { getLocale, getTimeZone, getTranslations } from 'next-intl/server'
import { requireSession } from '@/lib/session'
import { can } from '@/lib/permissions'
import { auditTableCounts, listAudit } from '@/features/admin/queries'
import { DEFAULT_LOCALE, isLocale } from '@/i18n/request'
import { formatDateTime, formatRelative } from '@/lib/format'
import { Button, EmptyState, PageHeader } from '@/ui/layout'
import { Register } from '@/ui/register'
import { Badge } from '@/ui/status'
import { TableShell, TBody, TD, TH, THead, TR } from '@/ui/table'
import { dayIn } from '@/lib/time'

const OP_TONE = { INSERT: 'positive', UPDATE: 'info', DELETE: 'critical' } as const
const OPERATIONS = ['INSERT', 'UPDATE', 'DELETE'] as const
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

/** `YYYY-MM-DD`, `days` before today, in UTC — the zone the log is stamped in. */
function daysAgo(days: number): string {
  const date = new Date()
  date.setUTCDate(date.getUTCDate() - days)
  return dayIn(date)
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('audit')
  return { title: t('title') }
}

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{ table?: string; op?: string; q?: string; from?: string; to?: string }>
}) {
  const timeZone = await getTimeZone()

  const session = await requireSession()
  const params = await searchParams
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

  const table = params.table?.trim() || undefined
  const op = OPERATIONS.includes(params.op as (typeof OPERATIONS)[number]) ? params.op : undefined
  const q = params.q?.trim() || undefined
  const from = params.from && ISO_DATE.test(params.from) ? params.from : undefined
  const to = params.to && ISO_DATE.test(params.to) ? params.to : undefined

  const filters = { table, op, q, from, to }

  const [rows, tables] = await Promise.all([
    listAudit(session.actor, filters),
    auditTableCounts(session.actor),
  ])

  /*
    Every control rebuilds the whole query string rather than appending to it.

    Each of these is a link, so a filter that dropped the others would quietly
    widen the view the moment somebody clicked a second one — and on an audit
    screen, silently showing more than was asked for is the failure that
    matters. `undefined` clears a parameter, which is what the "all" entries
    pass.
  */
  const href = (next: Partial<typeof filters>) => {
    const merged = { ...filters, ...next }
    const query = new URLSearchParams()
    for (const [key, value] of Object.entries(merged)) if (value) query.set(key, value)
    const search = query.toString()
    return search ? `/settings/audit?${search}` : '/settings/audit'
  }

  const periods: { label: string; from?: string }[] = [
    { label: tc('all'), from: undefined },
    { label: t('last7'), from: daysAgo(7) },
    { label: t('last30'), from: daysAgo(30) },
  ]

  return (
    <Register
      eyebrow={t('eyebrow')}
      title={t('title')}
      description={t('subtitle')}
      actions={
        <div className="flex flex-wrap items-center gap-2">
          {/*
            Period as presets rather than two date pickers.

            The arbitrary range is supported — `from` and `to` are read from the
            query and honoured by both the screen and the export — but almost
            every real question is "recently", and a preset answers it in one
            click. Somebody who needs a named fortnight edits the URL, which is
            the same affordance the reports screen offers.
          */}
          {periods.map((period) => {
            const active = (period.from ?? undefined) === from
            return (
              <Button
                key={period.label}
                href={href({ from: period.from, to: undefined })}
                size="sm"
                variant={active ? 'primary' : 'ghost'}
              >
                {period.label}
              </Button>
            )
          })}
          <Button
            href={`/api/audit.csv?${new URLSearchParams(
              Object.entries(filters).filter(([, value]) => Boolean(value)) as [string, string][],
            )}`}
            download
            size="sm"
            icon="download"
          >
            {t('exportCsv')}
          </Button>
        </div>
      }
      search={{
        action: '/settings/audit',
        value: q,
        placeholder: t('searchPlaceholder'),
        label: tc('search'),
        // Without these the search box would clear the table, operation and
        // period the reader had already chosen.
        hidden: { table, op, from, to },
      }}
      filters={[
        { label: tc('all'), href: href({ table: undefined }), active: !table },
        ...tables.map((row) => ({
          label: row.tableName,
          href: href({ table: row.tableName }),
          count: row.count,
          active: table === row.tableName,
        })),
      ]}
      summary={[{ label: t('entries'), value: rows.length }]}
      isEmpty={rows.length === 0}
      empty={
        q || table || op || from
          ? { icon: 'search', title: t('noMatch'), description: t('noMatchHint') }
          : { icon: 'audit', title: t('noneYet'), description: t('noneYetHint') }
      }
    >
      <TableShell>
        <THead>
          <TR>
            <TH>{t('when')}</TH>
            <TH>
              {/*
                The operation header doubles as its own filter.

                Three values, always the same three, and a fourth strip above
                the table for them would cost more room than the column it
                filters. Clicking the active one clears it.
              */}
              <span className="flex flex-wrap items-center gap-1.5">
                {t('operation')}
                {OPERATIONS.map((value) => (
                  <a
                    key={value}
                    href={href({ op: op === value ? undefined : value })}
                    className={`rounded-sm px-1 text-[0.6875rem] ${
                      op === value ? 'bg-brand text-on-brand' : 'text-ink-subtle hover:text-ink'
                    }`}
                  >
                    {value.charAt(0)}
                  </a>
                ))}
              </span>
            </TH>
            <TH>{t('table')}</TH>
            {/* When, what and to which table; who did it follows the table
                name on a phone (below), and the forensic columns wait. */}
            <TH priority="low">{t('who')}</TH>
            <TH priority="low">{t('branch')}</TH>
            <TH priority="low">{t('record')}</TH>
            <TH priority="low">{t('ip')}</TH>
          </TR>
        </THead>
        <TBody>
          {rows.map((row) => (
            <TR key={row.id}>
              <TD className="whitespace-nowrap">
                <span className="text-ink">{formatRelative(row.at, locale, now)}</span>
                <span className="mt-0.5 block text-[0.75rem] text-ink-subtle">
                  {formatDateTime(row.at, locale, timeZone)}
                </span>
              </TD>
              <TD>
                <Badge tone={OP_TONE[row.op as keyof typeof OP_TONE] ?? 'muted'}>{row.op}</Badge>
              </TD>
              <TD className="ref text-ink wrap-anywhere md:whitespace-nowrap">
                {row.tableName}
                <span className="block font-sans text-[0.75rem] text-ink-muted md:hidden">
                  {(locale === 'ar' && row.principalNameAr
                    ? row.principalNameAr
                    : row.principalName) ?? t('system')}
                </span>
              </TD>
              <TD priority="low" className="whitespace-nowrap">
                <span className="text-ink">
                  {(locale === 'ar' && row.principalNameAr
                    ? row.principalNameAr
                    : row.principalName) ?? t('system')}
                </span>
                <span className="mt-0.5 block text-[0.75rem] text-ink-subtle">
                  {row.principalType}
                </span>
              </TD>
              <TD priority="low" className="ref whitespace-nowrap text-ink-muted">
                {row.branchCode ?? '—'}
              </TD>
              <TD priority="low" className="ref max-w-40 truncate text-[0.75rem] text-ink-subtle">
                {row.rowId ?? '—'}
              </TD>
              <TD priority="low" className="ref whitespace-nowrap text-ink-subtle">
                {row.ip ?? '—'}
              </TD>
            </TR>
          ))}
        </TBody>
      </TableShell>
    </Register>
  )
}
