/**
 * The job file — `FR-JB-01…05`, `FR-DC-01`, `FR-DC-03`.
 *
 * The internal counterpart to the tracking page, and the screen that makes
 * tracking real rather than a mock-up: the milestones a customer sees are
 * these milestones, and the documents they can download are these documents
 * with `released_at` set.
 *
 * Three things here exist because the demo turns on them (Pilot §3.1):
 * the customs hold, the demurrage clock with the charge line it wrote by
 * itself, and the release control on the document vault.
 */

import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getLocale, getTimeZone, getTranslations } from 'next-intl/server'
import { requireSession } from '@/lib/session'
import { recordId } from '@/lib/ids'
import { getJobDetail } from '@/features/jobs/queries'
import { DEFAULT_LOCALE, isLocale } from '@/i18n/request'
import {
  formatDate,
  formatDateTime,
  formatLane,
  formatMoney,
  formatNumber,
  formatRelative,
} from '@/lib/format'
import { Card, CardHeader } from '@/ui/card'
import { Button, EmptyState, Field, Grid, PageHeader } from '@/ui/layout'
import { Badge, customsTone, jobTone, severityTone } from '@/ui/status'
import { Icon, modeIcon } from '@/ui/icon'
import { MilestoneTimeline } from '@/ui/timeline'
import { Meter } from '@/ui/chart'
import { TBody, TD, TH, THead, TR, TableShell } from '@/ui/table'
import {
  AddContainerDialog,
  CloseExceptionDialog,
  FreeTimeClockDialog,
  CustomsDialog,
  JobStatusDialog,
  MilestoneDialog,
  RaiseExceptionDialog,
} from '@/features/operations/ui/dialogs'
import { JobDialog, JobPartnerDialog } from '@/features/jobs/ui/dialogs'
import { listJobCargo, listJobContainers, listJobParties } from '@/features/documents/queries'
import { CargoCard, DocumentActionsCard, PartiesCard } from '@/features/documents/ui/panels'
import { getJobLedger } from '@/features/costing/queries'
import { JobLedgerCard } from '@/features/costing/ui/panels'
import { jobEquipmentOptions, jobProofOfDelivery } from '@/features/pod/queries'
import { ProofOfDeliveryCard } from '@/features/pod/ui/panels'
import { DutyEstimateDialog } from '@/features/operations/ui/duty-dialog'
import { releaseDocument } from '@/features/operations/form-actions'
import { can } from '@/lib/permissions'
import { pickName } from '@/lib/named'
import { localInputValue } from '@qabandi/core'
import { MoreMenu } from '@/ui/menu'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>
}): Promise<Metadata> {
  const session = await requireSession()
  const job = await getJobDetail(session.actor, recordId((await params).id))
  const t = await getTranslations('job')
  return { title: job?.reference ?? t('title') }
}

export default async function JobDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const timeZone = await getTimeZone()

  const session = await requireSession()
  const id = recordId((await params).id)
  // Resolved before the reads below: the ledger names its charges in it, and
  // the file names its owner and its free-text fields in it.
  const resolved = await getLocale()
  const locale = isLocale(resolved) ? resolved : DEFAULT_LOCALE
  const job = await getJobDetail(session.actor, id, locale)
  if (!job) notFound()

  // Resolved once rather than per row — the document list can be long and the
  // answer cannot change halfway down it.
  const canRelease = can(session, 'document.release')

  /*
    Three reads, in parallel, and separate from `getJobDetail`.

    Kept out of that query because it returns `JobDetail`, a type the pilot
    fixtures also satisfy — widening it would mean inventing fixture parties
    for twenty demo shipments. These return empty under fixtures and the
    panels say so.
  */
  const [parties, cargo, containerOptions, ledger, podRecords, podEquipment] = await Promise.all([
    listJobParties(session.actor, id),
    listJobCargo(session.actor, id),
    listJobContainers(session.actor, id),
    /*
      The charge ledger and the margin it produces (FR-FN-04, 0014).

      Kept out of `getJobDetail` for the same reason the three above are: that
      query returns `JobDetail`, a type the pilot fixtures also satisfy, and
      widening it would mean inventing a P&L for twenty demo shipments. Returns
      an empty ledger under fixtures and the card says so.
    */
    getJobLedger(session.actor, id, locale),
    /*
      Proof of delivery, and the containers it can name.

      Two queries rather than folding the equipment into the first: the picker
      needs every container on the job, and the delivery records name at most
      the ones already delivered.
    */
    jobProofOfDelivery(session.actor, id),
    jobEquipmentOptions(session.actor, id),
  ])

  const t = await getTranslations('job')
  const tc = await getTranslations('common')
  const tTrack = await getTranslations('track')
  const tMode = await getTranslations('mode')
  const tDirection = await getTranslations('direction')
  const tPartners = await getTranslations('jobPartners')
  const now = Date.now()
  // An empty Arabic name falls back to English rather than rendering blank (F52).
  const nameOf = (en: string, ar: string | null) => pickName(locale, en, ar)

  return (
    <>
      <PageHeader
        eyebrow={
          <span className="inline-flex items-center gap-2">
            <Link href="/jobs" className="hover:text-ink">
              {t('title')}
            </Link>
            <Icon name="chevron-end" size={12} />
            <span>{nameOf(job.customerName, job.customerNameAr)}</span>
          </span>
        }
        title={<span className="ref numeric">{job.reference}</span>}
        description={formatLane(
          nameOf(job.originName, job.originNameAr),
          nameOf(job.destinationName, job.destinationNameAr),
          locale,
        )}
        status={
          <>
            <Badge tone={jobTone(job.status)} dot>
              {t(`statuses.${job.status}` as 'statuses.booked')}
            </Badge>
            {job.customsStatus ? (
              <Badge
                tone={customsTone(job.customsStatus)}
                icon={job.customsStatus === 'held' ? 'hold' : undefined}
              >
                {t(`customsStatuses.${job.customsStatus}` as 'customsStatuses.held')}
              </Badge>
            ) : null}
          </>
        }
        actions={
          <>
            {/*
              The four things somebody actually does from a job file: move the
              shipment on, flag a problem, move customs on, correct the record.
              Moving it on is the one the file exists for, so it is the
              header's single primary button; the other three wait behind More
              in the order they are needed. Each is permission-gated inside its
              own component, so a coordinator sees only what they can act on —
              and `job.hold`, `job.cancel` and `job.close` are separate keys
              that the status dialog's own action checks per status.
            */}
            <JobStatusDialog jobId={job.id} status={job.status} variant="primary" />
            <MoreMenu label={tc('more')}>
              <RaiseExceptionDialog jobId={job.id} variant="secondary" />
              <CustomsDialog
                jobId={job.id}
                variant="secondary"
                defaults={{ status: job.customsStatus ?? 'not_started' }}
              />
              <JobDialog
                variant="ghost"
                defaults={{
                  id: job.id,
                  branchId: job.branchId,
                  customerId: job.customerId,
                  mode: job.mode,
                  tradeDirection: job.direction,
                  ownerId: job.ownerId,
                  quoteId: job.quoteId,
                  originId: job.originId,
                  destinationId: job.destinationId,
                  commodityId: job.commodityId,
                  incoterm: job.incoterm,
                  masterBillNumber: job.masterBillNumber,
                  houseBillNumber: job.houseBillNumber,
                  bookingNumber: job.bookingNumber,
                  // The raw columns, not `vesselOrFlight`: that is the vessel and
                  // voyage joined for display, and saving it back as the vessel
                  // name grew it by the voyage on every save.
                  vesselName: job.vesselName,
                  voyageNumber: job.voyageNumber,
                  flightNumber: job.flightNumber,
                  // In the branch's zone, the one `saveJob` reads them back in,
                  // so a form opened and saved untouched writes the same instant.
                  etd: localInputValue(job.etd, job.branchTimeZone),
                  eta: localInputValue(job.eta, job.branchTimeZone),
                  placeOfReceipt: job.placeOfReceipt,
                  placeOfDelivery: job.placeOfDelivery,
                  customerReference: job.customerReference,
                  grossWeightKg: job.grossWeightKg === null ? null : String(job.grossWeightKg),
                  volumeCbm: job.volumeCbm === null ? null : String(job.volumeCbm),
                  pieces: job.pieces,
                }}
              />
            </MoreMenu>
          </>
        }
      />

      {/* --- the exceptions, first, because they change what happens next */}
      {job.exceptions.length > 0 ? (
        <Card className="mb-4" tone="critical">
          <CardHeader icon="alert" eyebrow={t('exceptions')} title={t('exceptions')} />
          <ul className="mt-3 flex flex-col gap-2">
            {job.exceptions.map((exception) => (
              <li
                key={exception.id}
                className="flex flex-wrap items-start justify-between gap-3 rounded-sm bg-surface-sunken p-3"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-body font-medium text-ink">
                      {nameOf(exception.nameEn, exception.nameAr)}
                    </span>
                    <Badge tone={severityTone(exception.severity)}>
                      {t(`severities.${exception.severity}` as 'severities.high')}
                    </Badge>
                  </div>
                  {exception.description ? (
                    <p dir="auto" className="mt-1 text-body-sm text-ink-muted">
                      {exception.description}
                    </p>
                  ) : null}
                </div>
                <div className="flex max-w-full shrink-0 flex-wrap items-center gap-2">
                  {/* Muted: 11px subtle ink on the exception's tinted row was 4.4:1. */}
                  <div className="text-end text-micro text-ink-muted">
                    <p>
                      {t('openedAt')} {formatRelative(exception.openedAt, locale, now)}
                    </p>
                    {exception.owner ? <p className="mt-0.5">{exception.owner}</p> : null}
                  </div>
                  {/* An exception you cannot close from the screen that shows
                      it is a to-do list somebody keeps somewhere else. */}
                  <CloseExceptionDialog exceptionId={exception.id} />
                </div>
              </li>
            ))}
          </ul>
          {job.customsNote ? (
            // `dir="auto"`: the note is free text in whatever language the
            // broker wrote it. An English note in the Arabic page had its full
            // stop thrown to the start of the line.
            <p dir="auto" className="mt-3 border-t border-line pt-3 text-body-sm text-ink-muted">
              {job.customsNote}
            </p>
          ) : null}
        </Card>
      ) : null}

      <Grid className="mb-4">
        {/* --- the milestone timeline ---------------------------------- */}
        <Card className="@4xl:col-span-5">
          <CardHeader
            icon="tracking"
            eyebrow={t('shipment')}
            title={t('milestones')}
            description={t('milestonesHint')}
            actions={
              <MilestoneDialog
                jobId={job.id}
                milestones={job.milestones.flatMap((m) =>
                  // `id` is optional on the shared view — see `MilestoneView`.
                  // Here it is always present; the filter is what makes that a
                  // type the dialog can rely on rather than an assertion.
                  m.id
                    ? [{ id: m.id, name: nameOf(m.nameEn, m.nameAr), actualAt: m.actualAt }]
                    : [],
                )}
              />
            }
          />
          <div className="mt-5">
            <MilestoneTimeline
              milestones={job.milestones.map((m) => ({
                code: m.code,
                name: nameOf(m.nameEn, m.nameAr),
                plannedAt: m.plannedAt,
                revisedAt: m.revisedAt,
                actualAt: m.actualAt,
                note: m.note ?? null,
              }))}
              formatDate={(date) => formatDateTime(date, locale, timeZone)}
              labels={{
                planned: tTrack('milestoneStates.planned'),
                revised: tTrack('milestoneStates.revised'),
                completed: tTrack('milestoneStates.completed'),
                next: tTrack('milestoneStates.next'),
                pending: tTrack('milestoneStates.pending'),
              }}
            />
          </div>
        </Card>

        <div className="flex flex-col gap-4 @4xl:col-span-7">
          {/* --- the shipment's own facts ----------------------------- */}
          <Card>
            <CardHeader
              icon={modeIcon(job.mode)}
              eyebrow={tMode(job.mode)}
              title={t('shipment')}
              description={`${tDirection(job.direction)} · ${job.owner ?? tc('unassigned')}`}
            />
            <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-4 @xl:grid-cols-3">
              <Field label={t('masterBill')} mono>
                {job.masterBillNumber ?? '—'}
              </Field>
              <Field label={t('houseBill')} mono>
                {job.houseBillNumber ?? '—'}
              </Field>
              <Field label={t('booking')} mono>
                {job.bookingNumber ?? '—'}
              </Field>
              <Field label={t('vessel')}>{job.vesselOrFlight ?? '—'}</Field>
              <Field label={t('etd')}>{formatDate(job.etd, locale, timeZone)}</Field>
              <Field label={job.ata ? t('ata') : t('eta')}>
                {formatDate(job.ata ?? job.eta, locale, timeZone)}
              </Field>
              <Field label={t('customerReference')} mono>
                {job.customerReference ?? '—'}
              </Field>
              <Field label={t('incoterm')}>{job.incoterm ?? '—'}</Field>
              <Field label={t('commodity')}>
                {locale === 'ar' && job.commodityAr ? job.commodityAr : job.commodity}
              </Field>
              <Field label={t('weight')}>
                {/* <bdi> keeps the figure and its unit together in either
                    direction; the unit itself is the reader's — "كغم", not "kg". */}
                {job.grossWeightKg === null ? (
                  '—'
                ) : (
                  <bdi>{t('weightValue', { weight: formatNumber(job.grossWeightKg, locale) })}</bdi>
                )}
              </Field>
              <Field label={t('volume')}>
                {job.volumeCbm === null ? (
                  '—'
                ) : (
                  <bdi>{t('volumeValue', { volume: formatNumber(job.volumeCbm, locale) })}</bdi>
                )}
              </Field>
              <Field label={t('pieces')}>
                {job.pieces === null ? '—' : formatNumber(job.pieces, locale)}
              </Field>
            </dl>
          </Card>

          {/*
            --- the free-time clocks ---------------------------------

            The card renders even with no clock on the shipment, which it did
            not before: starting one had no control anywhere in the product,
            so demurrage accrued on seeded data and on nothing a customer had
            shipped. An operator whose box is sitting at Shuwaikh needs to be
            able to say so.
          */}
          {job.clocks.length > 0 ? (
            /*
              `flex-1` on the last card, not on the column.

              The grid stretches this column to the height of the milestone
              timeline beside it, but a stack of cards keeps its natural
              height — so the leftover fell out of the bottom as a band of
              canvas under the last card, which read as something failing to
              load. The final card absorbs it instead, and the two columns end
              on the same line.
            */
            <Card tone="critical" className="flex-1">
              <CardHeader
                icon="clock"
                eyebrow={t('clocks')}
                title={t('clocksHint')}
                actions={
                  <FreeTimeClockDialog
                    jobId={job.id}
                    containers={containerOptions}
                    // Whoever the days are owed to — the carrier or the
                    // terminal — is a partner already engaged on the job.
                    partners={job.partners.map((partner) => ({
                      value: partner.partnerId,
                      label: nameOf(partner.name, partner.nameAr),
                    }))}
                  />
                }
              />
              <ul className="mt-4 flex flex-col gap-3">
                {job.clocks.map((clock) => (
                  <li key={clock.id}>
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className="flex items-center gap-2">
                        <Badge tone="critical">
                          {t(`clockKinds.${clock.kind}` as 'clockKinds.demurrage')}
                        </Badge>
                        <span className="ref numeric text-body-sm text-ink-muted">
                          {clock.containerNo}
                        </span>
                        {clock.endsOn ? (
                          <Badge tone="muted">
                            {t('clockStopped', {
                              on: formatDate(
                                new Date(`${clock.endsOn}T12:00:00Z`),
                                locale,
                                timeZone,
                              ),
                            })}
                          </Badge>
                        ) : null}
                        {/*
                          Correct or stop this clock (O2). It could only ever
                          be started: nothing rendered the dialog with a
                          clock's values, so nothing set `ends_on`, and the
                          nightly accrual billed until the 730-day guard.
                        */}
                        <FreeTimeClockDialog
                          jobId={job.id}
                          containers={containerOptions}
                          partners={job.partners.map((partner) => ({
                            value: partner.partnerId,
                            label: nameOf(partner.name, partner.nameAr),
                          }))}
                          defaults={{
                            id: clock.id,
                            kind: clock.kind,
                            equipmentId: clock.equipmentId,
                            startsOn: clock.startsOnDay,
                            endsOn: clock.endsOn,
                            freeDays: clock.freeDays,
                            perDiem: clock.perDiemText,
                            currency: clock.perDiem.currency,
                            counterpartyId: clock.counterpartyId,
                          }}
                        />
                      </span>
                      <span className="numeric accruing font-display text-headline leading-none font-semibold text-critical">
                        {formatMoney(clock.accrued, locale)}
                      </span>
                    </div>

                    <Meter
                      className="mt-2.5"
                      value={clock.elapsedDays}
                      max={Math.max(clock.elapsedDays, clock.freeDays)}
                      tone="var(--qb-critical)"
                      label={`${clock.elapsedDays} / ${clock.freeDays}`}
                    />

                    <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-caption text-ink-muted">
                      <span>
                        {t('freeDays', { days: clock.freeDays })} ·{' '}
                        <span className="font-medium text-critical">
                          {t('chargeableDays', { days: clock.chargeableDays })}
                        </span>{' '}
                        · {t('perDiem', { amount: formatMoney(clock.perDiem, locale) })}
                      </span>
                      {clock.counterparty ? (
                        <span>
                          {/* <bdi>: a Latin carrier name after "مستحقة لـ" let
                              the bidi algorithm move the preposition to the
                              far end of the name. */}
                          {t('counterparty')} <bdi>{clock.counterparty}</bdi>
                        </span>
                      ) : null}
                    </div>

                    {/*
                      The beat the demo is built around: nobody had to remember
                      to add this line — the nightly accrual wrote it.
                    */}
                    {clock.chargeLineWritten ? (
                      <p className="mt-2 inline-flex items-center gap-1.5 rounded-sm bg-positive-soft px-2 py-1 text-caption font-medium text-positive">
                        <Icon name="check" size={13} strokeWidth={2.5} />
                        {t('chargeLineWritten')}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            </Card>
          ) : (
            /*
              No clock yet, and the card still renders.

              Hiding it until one exists was how demurrage came to run only on
              seeded data: the control that creates the first clock was inside
              the card that only appeared once a clock existed. The tone is
              neutral rather than critical here — nothing is accruing, and a
              red panel saying so would cry wolf on every shipment.
            */
            // Centred rather than top-aligned: with no clocks to list there is
            // nothing to fill the height with, and a sentence pinned to the top
            // of a tall empty card looks like the rest of it failed to render.
            <Card className="flex flex-1 flex-col justify-center">
              <CardHeader
                icon="clock"
                eyebrow={t('clocks')}
                title={t('noClocks')}
                description={t('noClocksHint')}
                actions={
                  <FreeTimeClockDialog
                    jobId={job.id}
                    containers={containerOptions}
                    partners={job.partners.map((partner) => ({
                      value: partner.partnerId,
                      label: nameOf(partner.name, partner.nameAr),
                    }))}
                    variant="secondary"
                  />
                }
              />
            </Card>
          )}
        </div>
      </Grid>

      <Grid>
        {/* --- the document vault, with release control ---------------- */}
        <Card className="@4xl:col-span-7" padding="none">
          <div className="p-5 pb-3">
            <CardHeader
              icon="document"
              eyebrow={t('documents')}
              title={t('documentVault')}
              description={t('documentsHint')}
            />
          </div>

          {job.documents.length === 0 ? (
            <EmptyState icon="document" title={tTrack('noDocuments')} />
          ) : (
            <ul className="divide-y divide-line border-t border-line">
              {job.documents.map((document) => (
                <li
                  key={document.id}
                  className="flex items-center gap-3 px-5 py-3 transition-colors hover:bg-surface-sunken"
                >
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-sm bg-surface-sunken text-ink-muted">
                    <Icon name="document" size={16} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-body font-medium text-ink">
                      {nameOf(document.nameEn, document.nameAr)}
                    </p>
                    <p className="text-micro text-ink-subtle">
                      {/* Which copy: the English and Arabic ones are otherwise identical rows. */}
                      <span className="font-medium text-ink-muted">
                        {document.locale === 'ar'
                          ? tTrack('documentLanguage.ar')
                          : tTrack('documentLanguage.en')}
                      </span>{' '}
                      · {t('version', { version: document.version })} · {document.sizeKb} KB
                    </p>
                  </div>
                  {/*
                    A draft on the job is not a released document. Conflating
                    the two is how a draft bill of lading reaches a customer.
                  */}
                  {document.releasedAt ? (
                    <Badge tone="positive" icon="check">
                      {t('released')}
                    </Badge>
                  ) : canRelease ? (
                    /*
                      The control the card's own comment has promised since
                      Release One. `released_at` was read by the portal, the
                      register, this page and the download route, and written
                      by nothing — so every document in the system was a
                      permanent draft and the customer could never fetch one.

                      No confirmation step. The button is only rendered for a
                      principal holding `document.release`, the act is audited,
                      and a dialog that asks "are you sure" twenty times a day
                      trains the answer rather than prompting the thought.
                    */
                    <form action={releaseDocument}>
                      <input type="hidden" name="documentId" value={document.id} />
                      <Button size="sm" variant="secondary" icon="check" type="submit">
                        {t('release')}
                      </Button>
                    </form>
                  ) : (
                    <Badge tone="muted">{t('draft')}</Badge>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    icon="download"
                    href={`/api/documents/${document.id}`}
                    download
                    aria-label={tc('download')}
                  />
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* --- who we engaged ---------------------------------------- */}
        <Card className="@4xl:col-span-5" padding="none">
          <div className="p-5 pb-3">
            <CardHeader
              icon="partners"
              eyebrow={tPartners('eyebrow')}
              title={tPartners('title')}
              description={tPartners('hint')}
              actions={<JobPartnerDialog jobId={job.id} branchId={job.branchId} />}
            />
          </div>

          {job.partners.length === 0 ? (
            <EmptyState icon="partners" title={tPartners('none')} />
          ) : (
            <TableShell className="border-t border-line">
              <THead>
                <TR>
                  <TH>{tPartners('partner')}</TH>
                  <TH>{tPartners('role')}</TH>
                  <TH>{tPartners('reference')}</TH>
                </TR>
              </THead>
              <TBody>
                {job.partners.map((partner) => (
                  <TR key={partner.id}>
                    <TD className="font-medium text-ink">{nameOf(partner.name, partner.nameAr)}</TD>
                    <TD>
                      <Badge tone="info">
                        {tPartners(`roles.${partner.role}` as 'roles.carrier')}
                      </Badge>
                    </TD>
                    <TD numeric className="ref text-ink-muted">
                      {partner.reference ?? '—'}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </TableShell>
          )}
        </Card>

        {/* --- containers -------------------------------------------- */}
        <Card className="@4xl:col-span-5" padding="none">
          <div className="p-5 pb-3">
            <CardHeader
              icon="container"
              eyebrow={t('equipment')}
              title={t('equipment')}
              actions={<AddContainerDialog jobId={job.id} />}
            />
          </div>

          {job.containers.length === 0 ? (
            <EmptyState icon="container" title={tc('none')} />
          ) : (
            <TableShell className="border-t border-line">
              <THead>
                <TR>
                  <TH>{t('equipment')}</TH>
                  <TH>{t('sealNo')}</TH>
                  <TH align="end">{t('discharged')}</TH>
                  <TH align="end">{t('gateOut')}</TH>
                </TR>
              </THead>
              <TBody>
                {job.containers.map((container) => (
                  <TR key={container.containerNo}>
                    <TD>
                      <span className="ref numeric font-medium">{container.containerNo}</span>
                      <span className="mt-0.5 block text-micro text-ink-subtle">
                        {container.type}
                      </span>
                    </TD>
                    <TD numeric className="text-ink-muted">
                      {container.sealNo ?? '—'}
                    </TD>
                    <TD align="end" numeric className="text-ink-muted">
                      {formatDate(container.dischargedAt, locale, timeZone)}
                    </TD>
                    <TD align="end" numeric className="text-ink-muted">
                      {formatDate(container.gateOutAt, locale, timeZone)}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </TableShell>
          )}
        </Card>

        {/* --- parties, cargo, and what they produce ------------------- */}
        <PartiesCard jobId={id} parties={parties} className="@4xl:col-span-7" />

        <ProofOfDeliveryCard
          jobId={id}
          records={podRecords}
          equipment={podEquipment}
          branchTimeZone={job.branchTimeZone}
          className="@4xl:col-span-12"
        />

        {/*
          Cargo and the documents it produces, side by side and in that order.

          They were stacked the other way round, and the issue card asked for
          five of twelve columns with a full-width card either side of it — a
          span that can share a row with nothing, so it rendered at two fifths
          of the width with seven columns of nothing beside it. Paired with the
          cargo table it packs the row, and the pairing is the one the card's
          own first line already makes: every document below reads from these
          lines, so the reader should be able to see both at once.
        */}
        <CargoCard
          jobId={id}
          cargo={cargo}
          containers={containerOptions}
          className="@4xl:col-span-7"
        />

        <DocumentActionsCard
          jobId={id}
          hasCargo={cargo.length > 0}
          mode={job.mode}
          houseBillNumber={job.houseBillNumber}
          houseBillSurrenderedAt={job.houseBillSurrenderedAt}
          dutyAction={<DutyEstimateDialog jobId={id} variant="ghost" />}
          className="@4xl:col-span-5"
        />

        {/*
          The P&L last, and deliberately so.

          It is the number the commercial conversation turns on, and putting it
          at the top would make the job file a finance screen. A coordinator
          opens this page to move a shipment; the margin is what they scroll to
          when somebody asks.
        */}
        {ledger ? <JobLedgerCard ledger={ledger} className="@4xl:col-span-12" /> : null}
      </Grid>
    </>
  )
}
