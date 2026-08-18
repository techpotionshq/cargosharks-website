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
import { getLocale, getTranslations } from 'next-intl/server'
import { requireSession } from '@/lib/session'
import { can } from '@/lib/permissions'
import {
  getConsolidation,
  listAttachableJobs,
} from '@/features/consolidation/queries'
import {
  ConsolChargeDialog,
  ConsolidationDialog,
} from '@/features/consolidation/ui/dialogs'
import {
  allocateConsolCharge,
  attachHouse,
  closeConsolidation,
  detachHouse,
  reverseConsolAllocation,
} from '@/features/consolidation/form-actions'
import { DEFAULT_LOCALE, isLocale } from '@/i18n/request'
import { formatDate } from '@/lib/format'
import { Card, CardHeader } from '@/ui/card'
import { Button, EmptyState, Field, Grid, PageHeader } from '@/ui/layout'
import { Badge, jobTone } from '@/ui/status'
import { TBody, TD, TH, THead, TR, TableShell } from '@/ui/table'

export default async function ConsolidationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const session = await requireSession()
  const { id } = await params

  const consol = await getConsolidation(session.actor, id)
  if (!consol) notFound()

  const [attachable, t, tc, tJob] = await Promise.all([
    consol.status === 'open' ? listAttachableJobs(session.actor, id) : Promise.resolve([]),
    getTranslations('consolidations'),
    getTranslations('common'),
    getTranslations('job'),
  ])

  const resolved = await getLocale()
  const locale = isLocale(resolved) ? resolved : DEFAULT_LOCALE
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
              {formatDate(consol.etd, locale)}
            </Field>
            <Field label={t('eta')} mono>
              {formatDate(consol.eta, locale)}
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
              <form action={attachHouse} className="flex items-center gap-2">
                <input type="hidden" name="consolidationId" value={id} />
                <select
                  name="jobId"
                  required
                  aria-label={t('attach')}
                  className="h-8 max-w-56 rounded-sm border border-line bg-surface px-2 text-[0.8125rem] text-ink"
                >
                  <option value="">{tc('choose')}</option>
                  {attachable.map((job) => (
                    <option key={job.id} value={job.id}>
                      {job.label}
                    </option>
                  ))}
                </select>
                <Button type="submit" size="sm" variant="secondary" icon="plus">
                  {t('attach')}
                </Button>
              </form>
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
                        <form action={detachHouse}>
                          <input type="hidden" name="consolidationId" value={id} />
                          <input type="hidden" name="jobId" value={house.jobId} />
                          <Button type="submit" size="sm" variant="ghost">
                            {t('detach')}
                          </Button>
                        </form>
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
              {consol.charges.map((charge) => (
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
                    <span className="numeric shrink-0 text-[0.875rem] font-medium">
                      {charge.amount} {charge.currency}
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
                      />
                    ) : (
                      <Badge tone="caution">{t('notAllocated')}</Badge>
                    )}
                  </div>
                </li>
              ))}
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

/**
 * `allocateConsolCharge` returns an `ActionState` so it can hand back the
 * engine's own refusal — "every house has a zero volume, so there is nothing
 * to split by". A plain `action={}` form cannot show that, so this posts and
 * lets the page revalidate; the refusal surfaces on the next render as the
 * cost still sitting unallocated.
 *
 * The honest note: this is the one place in the feature where the message is
 * lost. Wiring `useActionState` here means a client component for a single
 * button, and the refusals it swallows are all visible states on the page —
 * no houses attached, cargo figures missing.
 */
function AllocateButton({
  consolidationId,
  chargeLineId,
  label,
}: {
  readonly consolidationId: string
  readonly chargeLineId: string
  readonly label: string
}) {
  return (
    <form
      action={async (form: FormData) => {
        'use server'
        await allocateConsolCharge({}, form)
      }}
    >
      <input type="hidden" name="consolidationId" value={consolidationId} />
      <input type="hidden" name="chargeLineId" value={chargeLineId} />
      <Button type="submit" size="sm" variant="secondary">
        {label}
      </Button>
    </form>
  )
}
