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
import { getLocale, getTimeZone, getTranslations } from 'next-intl/server'
import { todayIn } from '@qabandi/core'
import { requireSession } from '@/lib/session'
import { getQuoteDetail } from '@/features/ledger/queries'
import { QuoteStatusActions } from '@/features/ledger/ui/quote-actions'
import { QuoteLineDialog } from '@/features/ledger/ui/dialogs'
import { CoverNoteEditor } from '@/features/ledger/ui/cover-note-editor'
import { DEFAULT_LOCALE, isLocale } from '@/i18n/request'
import { formatDate, formatDateTime, formatMoney } from '@/lib/format'
import { Icon, modeIcon } from '@/ui/icon'
import { Button, EmptyState, Field, Grid, PageHeader } from '@/ui/layout'
import { Metric } from '@/ui/metric'
import { Panel } from '@/ui/panel'
import { Badge, quoteTone } from '@/ui/status'
import { TableShell, TBody, TD, TH, THead, TR } from '@/ui/table'
import { Term } from '@/ui/term'
import { Notice } from '@/ui/notice'

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
  const timeZone = await getTimeZone()

  const session = await requireSession()
  const { id } = await params
  const resolved = await getLocale()
  const locale = isLocale(resolved) ? resolved : DEFAULT_LOCALE
  const quote = await getQuoteDetail(session.actor, id, locale)
  // Invisible under RLS means not-found, which is also the right answer to
  // give: no enumeration signal for another branch's quotation (FR-ID-04).
  if (!quote) notFound()

  const t = await getTranslations('quoteDetail')
  const tc = await getTranslations('common')
  const tq = await getTranslations('quotes')
  const tMode = await getTranslations('mode')
  const tBasis = await getTranslations('quoteForm')

  const sell = Number(quote.totalSell ?? 0)
  const cost = Number(quote.totalCost ?? 0)
  const marginPct = sell > 0 ? ((sell - cost) / sell) * 100 : null
  const money = (amount: number) => formatMoney({ amount, currency: quote.currency }, locale)

  /*
    Calendar days in the reader's zone, not instants (S18). `new Date('2026-10-01')`
    is midnight UTC — 03:00 in Kuwait — so a quotation valid until the 1st read
    "expired" for most of the 1st. Valid until a day means valid all that day,
    the reading the PDF and the send/accept guard already give it.
  */
  const expired = quote.validUntil !== null && quote.validUntil < todayIn(timeZone)
  const pdf = `/api/quotes/${quote.id}/pdf`

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
            {/*
              The document the customer receives — FR-EQ-08.

              Both languages, as plain links: a `GET` renders and streams and
              stores nothing, so opening one in a tab is safe. The href is
              built above rather than interpolated inline because
              `check-links.mjs` reads an interpolated href by its literal
              prefix and cannot see past the first `${`.
            */}
            <Button size="sm" variant="ghost" href={pdf} download icon="download">
              {t('pdf')}
            </Button>
            <Button size="sm" variant="ghost" href={`${pdf}?locale=ar`} download>
              {t('pdfAr')}
            </Button>
            <QuoteStatusActions quoteId={quote.id} status={quote.status} />
          </>
        }
      />

      {/*
        An expired quotation still shows its numbers — someone is looking at it
        precisely because a customer came back late — but it says so first.
      */}
      {expired && !['accepted', 'rejected'].includes(quote.status) ? (
        <Notice tone="caution" icon="clock" className="mb-4">
          {t('expired', { on: formatDate(new Date(quote.validUntil!), locale, timeZone) })}
        </Notice>
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
          value={quote.validUntil ? formatDate(new Date(quote.validUntil), locale, timeZone) : '—'}
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
          actions={
            /*
              Only on a draft. `addQuoteLine` refuses anything else — a sent
              quotation is an offer somebody is holding, and changing it means
              a revision (FR-RT-08), not an edit.
            */
            quote.status === 'draft' ? (
              <QuoteLineDialog quoteId={quote.id} currency={quote.currency} variant="ghost" />
            ) : null
          }
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
                    {/* The basis in the reader's language — it was the enum, spaced out. */}
                    <TD className="text-ink-muted">
                      {tBasis(`bases.${line.basis}` as 'bases.flat')}
                    </TD>
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
                {quote.sentAt ? formatDateTime(quote.sentAt, locale, timeZone) : t('notSent')}
              </Field>
              <Field label={t('decidedAt')}>
                {quote.decidedAt ? formatDateTime(quote.decidedAt, locale, timeZone) : '—'}
              </Field>
              <Field label={t('created')}>
                {formatDateTime(quote.createdAt, locale, timeZone)}
              </Field>
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

      {/*
        The covering note — FR-EQ-08, the generative surface behind the
        evaluation harness. Only on a draft: a sent quotation is a document the
        customer is already holding, so its note is history like everything else
        on it. The model drafts the prose; the pricing above owns every figure.
      */}
      {quote.status === 'draft' ? (
        <Panel
          className="mb-4"
          icon="assistant"
          title={t('coverNote.title')}
          explain={t('coverNote.explain')}
        >
          <CoverNoteEditor
            quoteId={quote.id}
            notes={{ en: quote.coverNoteEn, ar: quote.coverNoteAr }}
            labels={{
              english: t('coverNote.english'),
              arabic: t('coverNote.arabic'),
              placeholder: t('coverNote.placeholder'),
              draft: t('coverNote.draft'),
              drafting: t('coverNote.drafting'),
              save: t('coverNote.save'),
              saving: tc('saving'),
              saved: t('coverNote.saved'),
            }}
          />
        </Panel>
      ) : null}
    </>
  )
}
