/**
 * The quotation.
 *
 * The register linked here and the route did not exist, so every reference in
 * the quotations table was a link to a 404.
 *
 * Two things this screen is careful about, both of them rules the schema
 * already enforces and the page has to *show* rather than contradict:
 *
 *   1. **A quote is never edited.** There is no edit button. A revision is a
 *      new version, and the older ones are listed as history with their own
 *      references — because the customer may be holding one of them.
 *   2. **Margin is the frozen figure**, taken from `priced_snapshot` at the
 *      moment of quoting and never recomputed against today's rate card. The
 *      page says so, in words, next to the number.
 *
 * Buy-side cost and margin appear here and nowhere a customer can reach. They
 * live in this slice and are never projected into the portal, the tracking
 * page or the quotation PDF.
 */

import type { Metadata, Route } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getLocale, getTranslations } from 'next-intl/server'
import { requireSession } from '@/lib/session'
import { getQuoteDetail } from '@/features/ledger/queries'
import { QuoteStatusActions } from '@/features/ledger/ui/quote-actions'
import { DEFAULT_LOCALE, isLocale } from '@/i18n/request'
import { formatDate, formatDateTime, formatMoney } from '@/lib/format'
import { Icon, modeIcon } from '@/ui/icon'
import { EmptyState, Field, Grid, PageHeader } from '@/ui/layout'
import { Metric } from '@/ui/metric'
import { Panel } from '@/ui/panel'
import { Badge, quoteTone } from '@/ui/status'
import { TableShell, TBody, TD, TH, THead, TR } from '@/ui/table'
import { Term } from '@/ui/term'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>
}): Promise<Metadata> {
  const session = await requireSession()
  const { id } = await params
  const quote = await getQuoteDetail(session.actor, id)
  return { title: quote?.reference ?? 'Quotation' }
}

export default async function QuoteDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession()
  const { id } = await params
  const quote = await getQuoteDetail(session.actor, id)
  // Invisible under RLS means not-found, which is also the right answer to
  // give: no enumeration signal for another branch's quotation (FR-ID-04).
  if (!quote) notFound()

  const t = await getTranslations('quoteDetail')
  const tc = await getTranslations('common')
  const tq = await getTranslations('quotes')
  const tMode = await getTranslations('mode')
  const resolved = await getLocale()
  const locale = isLocale(resolved) ? resolved : DEFAULT_LOCALE

  const sell = Number(quote.totalSell ?? 0)
  const cost = Number(quote.totalCost ?? 0)
  const marginPct = sell > 0 ? ((sell - cost) / sell) * 100 : null
  const money = (amount: number) => formatMoney({ amount, currency: quote.currency }, locale)

  const expired = quote.validUntil !== null && new Date(quote.validUntil).getTime() < Date.now()

  return (
    <>
      <PageHeader
        eyebrow={
          <span className="inline-flex items-center gap-2">
            <Link href="/quotes" className="hover:text-ink">
              {tq('title')}
            </Link>
            <Icon name="chevron-end" size={12} />
            <span>{quote.customerName ?? tc('none')}</span>
          </span>
        }
        title={<span className="ref numeric">{quote.reference}</span>}
        description={
          quote.lane ? (
            <span className="inline-flex items-center gap-2">
              {quote.mode ? <Icon name={modeIcon(quote.mode)} size={14} /> : null}
              {quote.lane}
              {quote.mode ? ` · ${tMode(quote.mode as 'air')}` : ''}
            </span>
          ) : undefined
        }
        actions={
          <>
            <Badge tone={quoteTone(quote.status)} dot>
              {tq(`statuses.${quote.status}` as 'statuses.sent')}
            </Badge>
            {quote.version > 1 ? (
              <Badge tone="muted">{t('version', { version: quote.version })}</Badge>
            ) : null}
            <QuoteStatusActions quoteId={quote.id} status={quote.status} />
          </>
        }
      />

      {/*
        An expired quotation still shows its numbers — someone is looking at it
        precisely because a customer came back late — but it says so first.
      */}
      {expired && !['accepted', 'rejected'].includes(quote.status) ? (
        <p className="mb-4 flex items-center gap-2 rounded-card border border-caution/40 bg-caution-soft/50 px-4 py-3 text-[0.875rem] text-caution">
          <Icon name="clock" size={16} className="shrink-0" />
          {t('expired', { on: formatDate(new Date(quote.validUntil!), locale) })}
        </p>
      ) : null}

      <div className="mb-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Metric label={t('sell')} value={money(sell)} icon="quotes" tone="brand" />
        <Metric label={t('cost')} value={money(cost)} icon="finance" hint={t('costHint')} />
        <Metric
          label={t('margin')}
          value={marginPct === null ? '—' : `${marginPct.toFixed(1)}%`}
          icon="trend"
          tone={
            marginPct === null
              ? 'neutral'
              : marginPct < 8
                ? 'critical'
                : marginPct < 15
                  ? 'caution'
                  : 'positive'
          }
          hint={<Term name="margin">{t('marginHint')}</Term>}
        />
        <Metric
          label={t('validUntil')}
          value={quote.validUntil ? formatDate(new Date(quote.validUntil), locale) : '—'}
          icon="calendar"
          tone={expired ? 'caution' : 'neutral'}
          hint={t('validUntilHint')}
        />
      </div>

      <Grid className="mb-4">
        <Panel
          className="lg:col-span-8"
          padding="none"
          icon="finance"
          title={t('lines')}
          explain={t('linesExplain')}
        >
          {quote.lines.length === 0 ? (
            <EmptyState icon="finance" title={t('noLines')} description={t('noLinesHint')} />
          ) : (
            <TableShell minWidth="none">
              <THead>
                <TR>
                  <TH>{t('charge')}</TH>
                  <TH>{t('basis')}</TH>
                  <TH align="end">{t('quantity')}</TH>
                  <TH align="end">{t('rate')}</TH>
                  <TH align="end">{t('amount')}</TH>
                </TR>
              </THead>
              <TBody>
                {quote.lines.map((line) => (
                  <TR key={line.id}>
                    <TD className="font-medium text-ink">
                      {line.chargeName}
                      {line.description ? (
                        <span className="block text-[0.75rem] font-normal text-ink-subtle">
                          {line.description}
                        </span>
                      ) : null}
                    </TD>
                    <TD className="text-ink-muted">{line.basis.replace(/_/g, ' ')}</TD>
                    <TD align="end" numeric className="text-ink-muted">
                      {Number(line.quantity)}
                    </TD>
                    <TD align="end" numeric className="text-ink-muted">
                      {formatMoney({ amount: Number(line.rate), currency: line.currency }, locale, {
                        showCurrency: false,
                      })}
                    </TD>
                    <TD align="end" numeric className="font-semibold">
                      {formatMoney(
                        { amount: Number(line.amount), currency: line.currency },
                        locale,
                        { showCurrency: false },
                      )}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </TableShell>
          )}
        </Panel>

        <div className="flex flex-col gap-4 lg:col-span-4">
          <Panel icon="quotes" title={t('about')} explain={t('aboutExplain')}>
            <dl className="grid grid-cols-2 gap-4">
              <Field label={t('enquiry')}>
                <Link
                  href={`/enquiries/${quote.enquiryId}`}
                  className="ref text-brand hover:underline"
                >
                  {quote.enquiryReference}
                </Link>
              </Field>
              <Field label={t('branch')}>{quote.branchCode ?? '—'}</Field>
              <Field label={t('preparedBy')}>{quote.preparedBy ?? '—'}</Field>
              <Field label={t('sentAt')}>
                {quote.sentAt ? formatDateTime(quote.sentAt, locale) : t('notSent')}
              </Field>
              <Field label={t('decidedAt')}>
                {quote.decidedAt ? formatDateTime(quote.decidedAt, locale) : '—'}
              </Field>
              <Field label={t('created')}>{formatDateTime(quote.createdAt, locale)}</Field>
            </dl>
            {quote.notes ? (
              <p className="mt-4 border-t border-line pt-4 text-[0.8125rem] text-ink-muted">
                {quote.notes}
              </p>
            ) : null}
          </Panel>

          {/*
            Earlier versions, with their own references. A customer holding a
            printed v1 must be able to find v1 here, unchanged — that is the
            whole reason a revision is a new row rather than an edit.
          */}
          {quote.history.length > 0 ? (
            <Panel padding="none" icon="audit" title={t('history')} explain={t('historyExplain')}>
              <ul className="divide-y divide-line">
                {quote.history.map((version) => (
                  <li key={version.id}>
                    <Link
                      /*
                        Cast because `typedRoutes` cannot resolve a link from
                        `/quotes/[id]` to itself while it is still generating
                        that route's type — the inference is circular. Every
                        other link on the page is checked normally.
                      */
                      href={`/quotes/${version.id}` as Route}
                      className="flex items-center justify-between gap-3 px-5 py-3 transition-colors hover:bg-surface-sunken"
                    >
                      <span className="ref numeric text-[0.8125rem] text-brand">
                        {version.reference}
                      </span>
                      <span className="flex items-center gap-2">
                        <span className="numeric text-[0.75rem] text-ink-subtle">
                          {t('version', { version: version.version })}
                        </span>
                        <Badge tone={quoteTone(version.status)}>
                          {tq(`statuses.${version.status}` as 'statuses.sent')}
                        </Badge>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </Panel>
          ) : null}
        </div>
      </Grid>
    </>
  )
}
