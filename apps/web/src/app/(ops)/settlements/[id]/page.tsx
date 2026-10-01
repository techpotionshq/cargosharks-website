/**
 * One set-off — the figures, the documents behind them, and the two acts.
 *
 * Agreeing and settling are separate buttons because they are separate events
 * weeks apart. Agreeing freezes the statement and claims the documents; the
 * residual moves later, if at all. A single button would mean either a
 * settlement recorded before the agent has seen it, or a statement that keeps
 * changing until the money lands.
 *
 * Both are forms rather than links: a `GET` that claims a month's invoices
 * could be fired by a link preview in somebody's chat client.
 */

import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getLocale, getTimeZone, getTranslations } from 'next-intl/server'
import { requireSession } from '@/lib/session'
import { recordId } from '@/lib/ids'
import { can } from '@/lib/permissions'
import { getSettlement } from '@/features/payables/queries'
import { advanceSettlement } from '@/features/payables/form-actions'
import { DEFAULT_LOCALE, isLocale } from '@/i18n/request'
import { formatDate, formatDateTime, formatMoney } from '@/lib/format'
import { Card, CardHeader } from '@/ui/card'
import { Button, EmptyState, Field, Grid, PageHeader } from '@/ui/layout'
import { Badge, type Tone } from '@/ui/status'
import { TBody, TD, TH, THead, TR, TableShell } from '@/ui/table'

const STATUS_TONE: Record<string, Tone> = {
  draft: 'info',
  agreed: 'brand',
  settled: 'positive',
  void: 'muted',
}

const DIRECTION_TONE: Record<string, Tone> = {
  they_owe_us: 'positive',
  we_owe_them: 'caution',
  square: 'muted',
}

export default async function SettlementPage({ params }: { params: Promise<{ id: string }> }) {
  const timeZone = await getTimeZone()

  const session = await requireSession()
  const resolved = await getLocale()
  const locale = isLocale(resolved) ? resolved : DEFAULT_LOCALE
  const id = recordId((await params).id)

  const settlement = await getSettlement(session.actor, id, locale)
  if (!settlement) notFound()

  const [t, tc] = await Promise.all([getTranslations('settlements'), getTranslations('common')])

  const money = (amount: string) =>
    formatMoney({ amount: Number(amount), currency: settlement.currency }, locale)

  const mayRun = can(session, 'settlement.run')

  return (
    <>
      <PageHeader
        eyebrow={
          <span className="inline-flex items-center gap-2">
            <Link href="/settlements" className="hover:text-ink">
              {t('title')}
            </Link>
            <span aria-hidden>·</span>
            <Link href={`/partners/${settlement.partnerId}`} className="hover:text-ink">
              {settlement.partnerName}
            </Link>
          </span>
        }
        title={settlement.reference}
        actions={
          mayRun ? (
            <span className="flex flex-wrap items-center gap-2">
              {settlement.status === 'draft' ? (
                <form action={advanceSettlement}>
                  <input type="hidden" name="settlementId" value={id} />
                  <input type="hidden" name="action" value="agree" />
                  <Button type="submit" icon="check">
                    {t('agree')}
                  </Button>
                </form>
              ) : null}
              {settlement.status === 'agreed' ? (
                <form action={advanceSettlement}>
                  <input type="hidden" name="settlementId" value={id} />
                  <input type="hidden" name="action" value="settle" />
                  <Button type="submit" icon="sealed">
                    {t('markSettled')}
                  </Button>
                </form>
              ) : null}
            </span>
          ) : null
        }
      />

      <Grid>
        <Card className="lg:col-span-12">
          <dl className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
            <Field label={tc('status')}>
              <Badge tone={STATUS_TONE[settlement.status] ?? 'muted'}>
                {t(`statuses.${settlement.status}` as 'statuses.draft')}
              </Badge>
            </Field>
            <Field label={t('period')}>
              {formatDate(settlement.periodFrom, locale, timeZone)} —{' '}
              {formatDate(settlement.periodTo, locale, timeZone)}
            </Field>
            <Field label={t('theyOweUs')}>{money(settlement.receivableTotal)}</Field>
            <Field label={t('weOweThem')}>{money(settlement.payableTotal)}</Field>
            {/*
              The offset extinguishes both sides and moves no cash; the residual
              is the only figure that becomes a transfer. Showing them apart is
              what stops somebody paying the gross.
            */}
            <Field label={t('offset')}>{money(settlement.offsetAmount)}</Field>
            <Field label={t('residual')}>
              <span className="flex flex-wrap items-center gap-2">
                <span className="tabular-nums">{money(settlement.residualAmount)}</span>
                <Badge tone={DIRECTION_TONE[settlement.residualDirection] ?? 'muted'}>
                  {t(`directions.${settlement.residualDirection}` as 'directions.square')}
                </Badge>
              </span>
            </Field>
          </dl>

          {settlement.agreedAt ? (
            <p className="mt-4 border-t border-line pt-3 text-[0.8125rem] text-ink-muted">
              {t('agreedOn', { when: formatDateTime(settlement.agreedAt, locale, timeZone) })}
              {settlement.settledAt
                ? ` · ${t('settledOn', { when: formatDateTime(settlement.settledAt, locale, timeZone) })}`
                : ''}
            </p>
          ) : null}
          {settlement.voidReason ? (
            <p className="mt-4 border-t border-line pt-3 text-[0.8125rem] text-critical">
              <span className="font-medium">{t('voided')}</span> {settlement.voidReason}
            </p>
          ) : null}
        </Card>

        <Card className="lg:col-span-12" padding="none">
          <div className="p-5 pb-3">
            <CardHeader icon="invoices" eyebrow={t('documentsEyebrow')} title={t('documents')} />
          </div>

          {settlement.lines.length === 0 ? (
            <EmptyState
              icon="invoices"
              title={t('noDocuments')}
              description={t('noDocumentsHint')}
            />
          ) : (
            <TableShell className="border-t border-line" minWidth="none">
              <THead>
                <TR>
                  <TH>{t('side')}</TH>
                  <TH>{t('document')}</TH>
                  <TH align="end">{t('claimed')}</TH>
                </TR>
              </THead>
              <TBody>
                {settlement.lines.map((line) => (
                  <TR key={line.id}>
                    <TD>
                      <Badge tone={line.kind === 'invoice' ? 'positive' : 'caution'}>
                        {t(`kinds.${line.kind}` as 'kinds.invoice')}
                      </Badge>
                    </TD>
                    <TD>
                      <Link
                        href={
                          line.kind === 'invoice'
                            ? `/invoices/${line.documentId}`
                            : `/payables/${line.documentId}`
                        }
                        className="ref numeric hover:text-brand"
                      >
                        {line.reference}
                      </Link>
                    </TD>
                    <TD align="end" numeric>
                      {money(line.amount)}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </TableShell>
          )}
        </Card>
      </Grid>
    </>
  )
}
