/**
 * One master: its houses, its costs, and the split between them.
 *
 * The page is arranged in the order the work happens. Attach the houses, enter
 * what the master cost, split it. The manifest sits at the top because it is
 * what leaves the building — everything else on the page exists to make it
 * correct.
 *
 * The allocate button is a form rather than a link for the obvious reason and
 * one less obvious one: it writes a charge line onto every house, and a `GET`
 * that does that could be fired by a link preview in somebody's chat client.
 */

import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getLocale, getTimeZone, getTranslations } from 'next-intl/server'
import { requireSession } from '@/lib/session'
import { can } from '@/lib/permissions'
import {
  getConsolidation,
  listAllocationShares,
  listAttachableJobs,
  type ConsolAllocationShare,
} from '@/features/consolidation/queries'
import { ConsolChargeDialog, ConsolidationDialog } from '@/features/consolidation/ui/dialogs'
import {
  AllocateButton,
  AttachHouseForm,
  DetachHouseButton,
} from '@/features/consolidation/ui/house-actions'
import {
  closeConsolidation,
  reverseConsolAllocation,
  withdrawConsolCharge,
} from '@/features/consolidation/form-actions'
import { localInputValue } from '@qabandi/core'
import { DEFAULT_LOCALE, isLocale } from '@/i18n/request'
import { formatDate, formatMoney } from '@/lib/format'
import { Card, CardHeader } from '@/ui/card'
import { Icon } from '@/ui/icon'
import { Button, EmptyState, Field, Grid, PageHeader } from '@/ui/layout'
import { Badge, jobTone } from '@/ui/status'
import { TBody, TD, TH, THead, TR, TableShell } from '@/ui/table'

export default async function ConsolidationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const timeZone = await getTimeZone()

  const session = await requireSession()
  const resolved = await getLocale()
  const locale = isLocale(resolved) ? resolved : DEFAULT_LOCALE
  const { id } = await params

  const consol = await getConsolidation(session.actor, id, locale)
  if (!consol) notFound()

  const [attachable, shares, t, tc, tJob] = await Promise.all([
    consol.status === 'open' ? listAttachableJobs(session.actor, id, locale) : Promise.resolve([]),
    // Unconditional: a closed master is the one most likely to be opened *to*
    // settle an argument about who paid for what.
    listAllocationShares(session.actor, id),
    getTranslations('consolidations'),
    getTranslations('common'),
    getTranslations('job'),
  ])

  /*
    Grouped here rather than by a `filter` inside the charge loop, which would
    walk every share once per cost — quadratic on exactly the master that has
    the most of both.
  */
  const sharesByCharge = new Map<string, ConsolAllocationShare[]>()
  for (const share of shares) {
    const list = sharesByCharge.get(share.consolChargeLineId)
    if (list) list.push(share)
    else sharesByCharge.set(share.consolChargeLineId, [share])
  }

  // As in the document panel: the link checker cannot see past the first
  // interpolation in an href, so the URL is built before it is used.
  const manifestUrl = `/api/consolidations/${id}/manifest`
  const mayWrite = can(session, 'consol.write')
  const mayAllocate = can(session, 'consol.allocate')

  return (
    <>
      <PageHeader
        eyebrow={
          <span className="inline-flex items-center gap-2">
            <Link href="/consolidations" className="hover:text-ink">
              {t('title')}
            </Link>
            <span aria-hidden>·</span>
            <span>{consol.masterBillNumber ?? t('noMasterBill')}</span>
          </span>
        }
        title={consol.reference}
        actions={
          <span className="flex flex-wrap items-center gap-2">
            <Button href={manifestUrl} download icon="document" variant="secondary">
              {t('manifest')}
            </Button>
            <Button href={`${manifestUrl}?locale=ar`} download variant="ghost">
              AR
            </Button>
            {mayWrite ? (
              <ConsolidationDialog
                variant="secondary"
                defaults={{
                  id: consol.id,
                  branchId: consol.branchId,
                  mode: consol.mode,
                  tradeDirection: consol.tradeDirection,
                  masterBillNumber: consol.masterBillNumber,
                  bookingNumber: consol.bookingNumber,
                  vesselName: consol.vesselName,
                  voyageNumber: consol.voyageNumber,
                  flightNumber: consol.flightNumber,
                  notes: consol.notes,
                  carrierPartnerId: consol.carrierPartnerId,
                  coloadPartnerId: consol.coloadPartnerId,
                  originId: consol.originId,
                  destinationId: consol.destinationId,
                  etd: localInputValue(consol.etd, consol.branchTimeZone),
                  eta: localInputValue(consol.eta, consol.branchTimeZone),
                }}
              />
            ) : null}
            {mayWrite && consol.status === 'open' ? (
              <form action={closeConsolidation}>
                <input type="hidden" name="consolidationId" value={id} />
                <Button type="submit" variant="secondary" icon="sealed">
                  {t('close')}
                </Button>
              </form>
            ) : null}
          </span>
        }
      />

      <Grid>
        <Card className="lg:col-span-12">
          <dl className="grid grid-cols-2 gap-4 md:grid-cols-4 lg:grid-cols-6">
            <Field label={t('carrier')}>{consol.carrierName ?? '—'}</Field>
            <Field label={t('vessel')} mono>
              {[consol.vesselName, consol.voyageNumber].filter(Boolean).join(' / ') ||
                consol.flightNumber ||
                '—'}
            </Field>
            <Field label={t('route')}>
              {[consol.originName, consol.destinationName].filter(Boolean).join(' → ') || '—'}
            </Field>
            <Field label={t('etd')} mono>
              {formatDate(consol.etd, locale, timeZone)}
            </Field>
            <Field label={t('eta')} mono>
              {formatDate(consol.eta, locale, timeZone)}
            </Field>
            <Field label={tc('status')}>
              <Badge tone={consol.status === 'open' ? 'info' : 'muted'}>
                {t(`statuses.${consol.status}` as 'statuses.open')}
              </Badge>
            </Field>
          </dl>
        </Card>

        {/* --- houses ------------------------------------------------- */}
        <Card className="lg:col-span-7" padding="none">
          <div className="flex flex-wrap items-start justify-between gap-3 p-5 pb-3">
            <CardHeader
              icon="jobs"
              eyebrow={t('houses')}
              title={t('housesTitle', { n: consol.houseCount })}
            />

            {mayWrite && consol.status === 'open' && attachable.length > 0 ? (
              <AttachHouseForm
                consolidationId={id}
                jobs={attachable.map((job) => ({ id: job.id, label: job.label }))}
                label={t('attach')}
                choose={tc('choose')}
              />
            ) : null}
          </div>

          {consol.houses.length === 0 ? (
            <EmptyState icon="jobs" title={t('noHouses')} description={t('noHousesHint')} />
          ) : (
            <TableShell className="border-t border-line" minWidth="none">
              <THead>
                <TR>
                  <TH>{t('house')}</TH>
                  <TH>{tc('customer')}</TH>
                  <TH align="end">{t('packages')}</TH>
                  <TH align="end">{t('volume')}</TH>
                  <TH align="end">{tc('status')}</TH>
                  <TH align="end">{tc('actions')}</TH>
                </TR>
              </THead>
              <TBody>
                {consol.houses.map((house) => (
                  <TR key={house.jobId}>
                    <TD>
                      <Link
                        href={`/jobs/${house.jobId}`}
                        className="ref numeric font-medium hover:text-brand"
                      >
                        {house.houseBillNumber ?? house.reference}
                      </Link>
                    </TD>
                    <TD className="text-ink-muted">{house.customerName}</TD>
                    <TD align="end" numeric className="text-ink-muted">
                      {house.packages}
                    </TD>
                    <TD align="end" numeric className="text-ink-muted">
                      {Number(house.volumeCbm).toFixed(3)}
                    </TD>
                    <TD align="end">
                      <Badge tone={jobTone(house.status)}>
                        {tJob(`statuses.${house.status}` as 'statuses.booked')}
                      </Badge>
                    </TD>
                    <TD align="end">
                      {mayWrite && consol.status === 'open' ? (
                        <DetachHouseButton
                          consolidationId={id}
                          jobId={house.jobId}
                          label={t('detach')}
                        />
                      ) : null}
                    </TD>
                  </TR>
                ))}
                <TR>
                  <TD className="font-semibold">{tc('total')}</TD>
                  <TD />
                  <TD align="end" numeric className="font-semibold">
                    {consol.houses.reduce((acc, h) => acc + h.packages, 0)}
                  </TD>
                  <TD align="end" numeric className="font-semibold">
                    {Number(consol.volumeCbm).toFixed(3)}
                  </TD>
                  <TD />
                  <TD />
                </TR>
              </TBody>
            </TableShell>
          )}
        </Card>

        {/* --- master costs ------------------------------------------- */}
        <Card className="lg:col-span-5" padding="none">
          <div className="flex flex-wrap items-start justify-between gap-3 p-5 pb-3">
            <CardHeader icon="finance" eyebrow={t('charges')} title={t('chargesTitle')} />
            {mayWrite ? <ConsolChargeDialog consolidationId={id} /> : null}
          </div>

          {consol.charges.length === 0 ? (
            <EmptyState icon="finance" title={t('noCharges')} description={t('noChargesHint')} />
          ) : (
            <ul className="border-t border-line">
              {consol.charges.map((charge) => {
                const chargeShares = sharesByCharge.get(charge.id) ?? []

                return (
                  <li key={charge.id} className="border-b border-line p-4 last:border-0">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <span className="block text-[0.875rem] font-medium text-ink">
                          {charge.chargeTypeName}
                        </span>
                        <span className="block text-[0.6875rem] text-ink-subtle">
                          {charge.counterpartyName ?? t('noCounterparty')} ·{' '}
                          {t(`bases.${charge.allocationBasis}` as 'bases.volume')}
                        </span>
                      </div>
                      {/*
                      Formatted, not interpolated.

                      This printed `{charge.amount} {charge.currency}` straight
                      from the row, and a `numeric(19,6)` column arrives from
                      node-postgres as the string `1450.000000` — so a master's
                      cost card read "1450.000000 KWD". It went unnoticed while
                      the card had no rows to draw. `formatMoney` is what every
                      other money figure in the product goes through, and it is
                      what rounds per currency: three places for the dinar, two
                      for the dirham.
                    */}
                      <span className="numeric shrink-0 text-[0.875rem] font-medium">
                        {formatMoney(
                          { amount: Number(charge.amount), currency: charge.currency },
                          locale,
                        )}
                      </span>
                    </div>

                    <div className="mt-2.5 flex items-center justify-between gap-2">
                      <Badge tone={charge.direction === 'cost' ? 'muted' : 'positive'}>
                        {charge.direction === 'cost' ? t('cost') : t('revenue')}
                      </Badge>

                      {charge.allocatedAt ? (
                        <span className="flex items-center gap-2">
                          <Badge tone="positive">{t('allocated')}</Badge>
                          {mayAllocate ? (
                            <form action={reverseConsolAllocation}>
                              <input type="hidden" name="consolidationId" value={id} />
                              <input type="hidden" name="chargeLineId" value={charge.id} />
                              <Button type="submit" size="sm" variant="ghost">
                                {t('reverse')}
                              </Button>
                            </form>
                          ) : null}
                        </span>
                      ) : mayAllocate && consol.houses.length > 0 ? (
                        <AllocateButton
                          consolidationId={id}
                          chargeLineId={charge.id}
                          label={t('allocate')}
                          manual={
                            charge.allocationBasis === 'manual'
                              ? {
                                  currency: charge.currency,
                                  houses: consol.houses.map((house) => ({
                                    jobId: house.jobId,
                                    label: house.houseBillNumber ?? house.reference,
                                  })),
                                }
                              : undefined
                          }
                        />
                      ) : (
                        <Badge tone="caution">{t('notAllocated')}</Badge>
                      )}
                    </div>

                    {/*
                      An unsplit cost can be corrected or withdrawn (O12).
                      Before, a mistyped amount or the wrong basis stayed on
                      the master for good. Withdrawn, not deleted: the row is
                      stamped and drops out of the page and the split.
                    */}
                    {mayWrite && !charge.allocatedAt ? (
                      <div className="mt-2 flex items-center justify-end gap-2">
                        <ConsolChargeDialog
                          consolidationId={id}
                          defaults={{
                            id: charge.id,
                            direction: charge.direction,
                            chargeTypeId: charge.chargeTypeId,
                            counterpartyPartnerId: charge.counterpartyPartnerId,
                            amount: charge.amount,
                            currency: charge.currency,
                            fxRate: charge.fxRate,
                            allocationBasis: charge.allocationBasis,
                            description: charge.description,
                          }}
                        />
                        <form action={withdrawConsolCharge}>
                          <input type="hidden" name="consolidationId" value={id} />
                          <input type="hidden" name="chargeLineId" value={charge.id} />
                          <Button type="submit" size="sm" variant="ghost">
                            {t('withdrawCharge')}
                          </Button>
                        </form>
                      </div>
                    ) : null}

                    {/*
                    The split, on request.

                    `<details>` rather than component state, for the reason the
                    support banner gives: this is a server component on a page
                    whose every other control is a form, and a breakdown that
                    needs JavaScript to appear is one more thing between a
                    finance manager and an answer they are already annoyed to
                    be looking for.

                    Driven off the rows rather than `charge.shareCount` so the
                    control cannot promise a breakdown that is not there — a
                    reversed allocation clears the shares, and a count read from
                    a stale render would open onto nothing.
                  */}
                    {chargeShares.length > 0 ? (
                      <details className="group mt-2.5">
                        <summary className="flex cursor-pointer list-none items-center gap-1.5 text-[0.6875rem] text-ink-muted [&::-webkit-details-marker]:hidden">
                          <Icon
                            name="chevron-end"
                            size={12}
                            className="shrink-0 transition-transform group-open:rotate-90 rtl:-scale-x-100 rtl:group-open:-rotate-90"
                          />
                          <span>{t('shares', { count: chargeShares.length })}</span>
                        </summary>

                        <ul className="mt-2 space-y-1 border-s border-line ps-3">
                          {chargeShares.map((share) => (
                            <li
                              key={share.jobId}
                              className="flex items-baseline justify-between gap-3 text-[0.75rem]"
                            >
                              <Link
                                href={`/jobs/${share.jobId}`}
                                className="truncate text-ink-muted underline-offset-2 hover:text-ink hover:underline"
                              >
                                {share.jobReference}
                              </Link>
                              {/*
                              Same treatment as the cost above it: the column
                              arrives as `12.500000` and only `formatMoney`
                              knows the dinar takes three places.
                            */}
                              <span className="numeric shrink-0 text-ink">
                                {formatMoney(
                                  { amount: Number(share.shareAmount), currency: charge.currency },
                                  locale,
                                )}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </details>
                    ) : null}
                  </li>
                )
              })}
            </ul>
          )}

          <p className="p-4 pt-3 text-[0.6875rem] leading-relaxed text-ink-subtle">
            {t('allocationNote')}
          </p>
        </Card>
      </Grid>
    </>
  )
}
