/**
 * The payables panels — the bill under review, and the agent's account.
 *
 * The matching table is the screen this feature was built for. It puts three
 * figures on one row: what the agent billed, what the job accrued, and the
 * difference — and it colours the difference by whether it is inside the
 * tolerance somebody configured rather than by whether it is non-zero. A table
 * that flagged every rounding difference would be ignored inside a week, which
 * is the failure mode of every variance report that has ever been switched off.
 */

import { getLocale, getTimeZone, getTranslations } from 'next-intl/server'
import { requireSession } from '@/lib/session'
import { can } from '@/lib/permissions'
import { DEFAULT_LOCALE, isLocale } from '@/i18n/request'
import { formatDate, formatMoney, trimDecimal } from '@/lib/format'
import { Card, CardHeader } from '@/ui/card'
import { Button, EmptyState, Field } from '@/ui/layout'
import { Badge, type Tone } from '@/ui/status'
import { TBody, TD, TH, THead, TR, TableShell } from '@/ui/table'
import { MatchDialog, SupplierLineDialog, type MatchCandidateOption } from './dialogs'
import { unmatchSupplierLine } from '../form-actions'
import type { PartnerAccount, SupplierInvoiceDetail } from '../queries'

function display(amount: string, currency: string, locale: 'en' | 'ar'): string {
  return formatMoney({ amount: amount, currency }, locale)
}

/**
 * The five verdicts, and the colour each one earns.
 *
 * `under` is caution rather than positive on purpose. An agent billing less
 * than we accrued is not good news — it means the accrual was too high, and it
 * has been depressing the margin on every similar job since.
 */
const VERDICT_TONE: Record<string, Tone> = {
  exact: 'positive',
  within_tolerance: 'positive',
  over: 'critical',
  under: 'caution',
  unbilled: 'muted',
}

export async function SupplierInvoiceLinesCard({
  bill,
  candidates,
  className,
}: {
  readonly bill: SupplierInvoiceDetail
  readonly candidates: readonly MatchCandidateOption[]
  readonly className?: string
}) {
  const session = await requireSession()
  const [t, tc] = await Promise.all([getTranslations('payables'), getTranslations('common')])
  const resolved = await getLocale()
  const locale = isLocale(resolved) ? resolved : DEFAULT_LOCALE

  const mayMatch = can(session, 'payable.record') && ['received', 'disputed'].includes(bill.status)

  return (
    <Card className={className} padding="none">
      <div className="flex items-start justify-between gap-3 p-5 pb-3">
        <CardHeader icon="invoices" eyebrow={t('linesEyebrow')} title={t('lines')} />
        {mayMatch ? <SupplierLineDialog billId={bill.id} /> : null}
      </div>

      {bill.lines.length === 0 ? (
        <EmptyState icon="invoices" title={t('noLines')} description={t('noLinesHint')} />
      ) : (
        <TableShell className="border-t border-line">
          <THead>
            <TR>
              <TH>{t('theirLine')}</TH>
              {/* Variance and verdict are the review; on a phone the billed
                  figure follows the line (below), and accrued and the match
                  action — a dialog of candidate costs, desk work — wait. */}
              <TH priority="low" align="end">
                {t('billed')}
              </TH>
              <TH priority="low" align="end">
                {t('accrued')}
              </TH>
              <TH align="end">{t('variance')}</TH>
              <TH>{t('verdict')}</TH>
              {mayMatch ? (
                <TH priority="low" align="end">
                  {tc('actions')}
                </TH>
              ) : null}
            </TR>
          </THead>
          <TBody>
            {bill.lines.map((line) => (
              <TR key={line.id}>
                <TD>
                  <span dir="auto" className="font-medium">
                    {line.description}
                  </span>
                  <span className="mt-0.5 block text-micro text-ink-subtle">
                    {line.chargeTypeName ?? t('unmapped')}
                    {line.jobReference ? ` · ${line.jobReference}` : ''}
                  </span>
                  <span className="mt-0.5 block text-caption text-ink-muted md:hidden">
                    {t('billed')}{' '}
                    <span className="numeric whitespace-nowrap text-ink">
                      {display(line.amount, bill.currency, locale)}
                    </span>
                  </span>
                  {/*
                    What each match claims, under the line it claims it from.
                    "Which of our costs does this cover" is the question the
                    row exists to answer, and answering it in a tooltip would
                    mean nobody ever reads it.
                  */}
                  {line.matches.map((match) => (
                    <span
                      key={match.id}
                      className="mt-1 flex flex-wrap items-center gap-x-2 text-micro text-ink-muted"
                    >
                      <span aria-hidden>↳</span>
                      <span>
                        {match.jobReference} · {match.chargeTypeName}
                      </span>
                      <span className="tabular-nums">
                        {display(match.accruedAmount, match.accruedCurrency, locale)}
                      </span>
                      {mayMatch ? (
                        <form action={unmatchSupplierLine}>
                          <input type="hidden" name="matchId" value={match.id} />
                          <input type="hidden" name="supplierInvoiceId" value={bill.id} />
                          <button
                            type="submit"
                            className="text-critical underline-offset-2 hover:underline"
                          >
                            {t('unmatch')}
                          </button>
                        </form>
                      ) : null}
                    </span>
                  ))}
                </TD>
                <TD priority="low" align="end" className="tabular-nums">
                  {display(line.amount, bill.currency, locale)}
                  {bill.currency !== bill.baseCurrency ? (
                    <span className="mt-0.5 block text-micro text-ink-subtle">
                      {display(line.billedBase, bill.baseCurrency, locale)}
                    </span>
                  ) : null}
                </TD>
                <TD priority="low" align="end" className="tabular-nums text-ink-muted">
                  {display(line.accruedBase, bill.baseCurrency, locale)}
                </TD>
                <TD
                  align="end"
                  numeric
                  className={line.needsReview ? 'font-semibold text-critical' : 'text-ink-muted'}
                >
                  {display(line.varianceBase, bill.baseCurrency, locale)}
                  {line.variancePercent ? (
                    <span className="mt-0.5 block text-micro text-ink-subtle">
                      {Number(line.variancePercent).toFixed(1)}%
                    </span>
                  ) : null}
                </TD>
                <TD>
                  <Badge tone={VERDICT_TONE[line.verdict] ?? 'muted'}>
                    {t(`verdicts.${line.verdict}` as 'verdicts.exact')}
                  </Badge>
                  {line.needsReview ? (
                    <span className="mt-0.5 block text-micro text-ink-subtle">
                      {t('allowed', {
                        amount: display(line.allowedBase, bill.baseCurrency, locale),
                      })}
                    </span>
                  ) : null}
                </TD>
                {mayMatch ? (
                  <TD priority="low" align="end">
                    <MatchDialog
                      billId={bill.id}
                      lineId={line.id}
                      lineDescription={line.description}
                      outstanding={trimDecimal(line.amount) ?? '0'}
                      candidates={candidates}
                    />
                  </TD>
                ) : null}
              </TR>
            ))}
          </TBody>
        </TableShell>
      )}
    </Card>
  )
}

/**
 * The current account, both directions, and what actually has to move.
 *
 * The three figures at the top are the whole argument for netting: gross
 * receivable, gross payable, and the residual. A screen that showed only the
 * first two would be technically true and operationally useless — it overstates
 * both sides of the balance sheet and invites two transfers where one belongs.
 */
export async function PartnerAccountCard({
  account,
  className,
}: {
  readonly account: PartnerAccount
  readonly className?: string
}) {
  const timeZone = await getTimeZone()

  const [t] = await Promise.all([getTranslations('settlements')])
  const resolved = await getLocale()
  const locale = isLocale(resolved) ? resolved : DEFAULT_LOCALE

  const { net, statement, currency } = account
  const directionTone: Tone =
    net.direction === 'they_owe_us' ? 'positive' : net.direction === 'square' ? 'muted' : 'caution'

  return (
    <Card className={className} padding="none">
      <div className="flex items-start justify-between gap-3 p-5 pb-3">
        <CardHeader icon="finance" eyebrow={t('accountEyebrow')} title={t('account')} />
        <Button href={`/settlements?partner=${account.partnerId}`} variant="ghost" icon="finance">
          {t('history')}
        </Button>
      </div>

      {account.customerId === null ? (
        <EmptyState icon="partners" title={t('noAccount')} description={t('noAccountHint')} />
      ) : (
        <>
          <dl className="grid grid-cols-2 gap-4 border-y border-line px-5 py-4 md:grid-cols-4">
            <Field label={t('theyOweUs')}>
              {display(statement.receivable.amount.toString(), currency, locale)}
            </Field>
            <Field label={t('weOweThem')}>
              {display(statement.payable.amount.toString(), currency, locale)}
            </Field>
            <Field label={t('offset')}>
              {display(net.offset.amount.toString(), currency, locale)}
            </Field>
            <Field label={t('residual')}>
              <span className="flex flex-wrap items-center gap-2">
                <span className="tabular-nums">
                  {display(net.residual.amount.toString(), currency, locale)}
                </span>
                <Badge tone={directionTone}>
                  {t(`directions.${net.direction}` as 'directions.square')}
                </Badge>
              </span>
            </Field>
          </dl>

          {statement.lines.length === 0 ? (
            <EmptyState
              icon="finance"
              title={t('nothingOpen')}
              description={t('nothingOpenHint')}
            />
          ) : (
            <TableShell minWidth="none">
              <THead>
                <TR>
                  {/* Document and running balance on a phone; the date follows
                      the document there (below). */}
                  <TH priority="low">{t('date')}</TH>
                  <TH>{t('document')}</TH>
                  <TH priority="low" align="end">
                    {t('theyOweUsShort')}
                  </TH>
                  <TH priority="low" align="end">
                    {t('weOweThemShort')}
                  </TH>
                  <TH align="end">{t('balance')}</TH>
                </TR>
              </THead>
              <TBody>
                {statement.lines.map((line) => {
                  const signed = Number(line.signedAmount.amount.toString())
                  return (
                    <TR key={line.id}>
                      <TD priority="low" className="text-ink-muted">
                        {formatDate(line.date, locale, timeZone)}
                      </TD>
                      <TD>
                        <span className="font-mono text-body-sm">{line.reference}</span>
                        <span className="mt-0.5 block text-micro text-ink-subtle">
                          {t(`kinds.${line.kind}` as 'kinds.invoice')}
                          <span className="md:hidden">
                            {' · '}
                            {formatDate(line.date, locale, timeZone)}
                          </span>
                        </span>
                      </TD>
                      <TD priority="low" align="end" className="tabular-nums">
                        {signed > 0 ? display(String(signed), currency, locale) : '—'}
                      </TD>
                      <TD priority="low" align="end" className="tabular-nums">
                        {signed < 0 ? display(String(-signed), currency, locale) : '—'}
                      </TD>
                      <TD align="end" className="tabular-nums font-medium">
                        {display(line.balance.amount.toString(), currency, locale)}
                      </TD>
                    </TR>
                  )
                })}
              </TBody>
            </TableShell>
          )}
        </>
      )}
    </Card>
  )
}
