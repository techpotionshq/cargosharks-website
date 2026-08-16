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

import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getLocale, getTranslations } from 'next-intl/server'
import { requireSession } from '@/lib/session'
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
import { CloseExceptionDialog, CustomsDialog, RaiseExceptionDialog } from '@/features/operations/ui/dialogs'
import { JobDialog } from '@/features/jobs/ui/dialogs'

export default async function JobDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession()
  const { id } = await params
  const job = await getJobDetail(session.actor, id)
  if (!job) notFound()

  const t = await getTranslations('job')
  const tc = await getTranslations('common')
  const tTrack = await getTranslations('track')
  const tMode = await getTranslations('mode')
  const tDirection = await getTranslations('direction')
  const resolved = await getLocale()
  const locale = isLocale(resolved) ? resolved : DEFAULT_LOCALE
  const now = Date.now()
  const nameOf = (en: string, ar: string) => (locale === 'ar' ? ar : en)

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
        )}
        actions={
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
            {/*
              The three things somebody actually does from a job file, in the
              order they are needed: flag a problem, move customs on, correct
              the record. Each is permission-gated inside its own component, so
              a coordinator sees only what they can act on.
            */}
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
                status: job.status,
                originId: job.originId,
                destinationId: job.destinationId,
                incoterm: job.incoterm,
                masterBillNumber: job.masterBillNumber,
                houseBillNumber: job.houseBillNumber,
                vesselName: job.vesselOrFlight,
                customerReference: job.customerReference,
                grossWeightKg: job.grossWeightKg === null ? null : String(job.grossWeightKg),
                volumeCbm: job.volumeCbm === null ? null : String(job.volumeCbm),
                pieces: job.pieces,
              }}
            />
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
                    <span className="text-[0.875rem] font-medium text-ink">
                      {nameOf(exception.nameEn, exception.nameAr)}
                    </span>
                    <Badge tone={severityTone(exception.severity)}>
                      {t(`severities.${exception.severity}` as 'severities.high')}
                    </Badge>
                  </div>
                  {exception.description ? (
                    <p className="mt-1 text-[0.8125rem] text-ink-muted">{exception.description}</p>
                  ) : null}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <div className="text-end text-[0.6875rem] text-ink-subtle">
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
            <p className="mt-3 border-t border-line pt-3 text-[0.8125rem] text-ink-muted">
              {job.customsNote}
            </p>
          ) : null}
        </Card>
      ) : null}

      <Grid className="mb-4">
        {/* --- the milestone timeline ---------------------------------- */}
        <Card className="lg:col-span-5">
          <CardHeader
            icon="tracking"
            eyebrow={t('shipment')}
            title={t('milestones')}
            description={t('milestonesHint')}
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
              formatDate={(date) => formatDateTime(date, locale)}
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

        <div className="flex flex-col gap-4 lg:col-span-7">
          {/* --- the shipment's own facts ----------------------------- */}
          <Card>
            <CardHeader
              icon={modeIcon(job.mode)}
              eyebrow={tMode(job.mode)}
              title={t('shipment')}
              description={`${tDirection(job.direction)} · ${job.owner ?? tc('unassigned')}`}
            />
            <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3">
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
              <Field label={t('etd')}>{formatDate(job.etd, locale)}</Field>
              <Field label={job.ata ? t('ata') : t('eta')}>
                {formatDate(job.ata ?? job.eta, locale)}
              </Field>
              <Field label={t('customerReference')} mono>
                {job.customerReference ?? '—'}
              </Field>
              <Field label={t('incoterm')}>{job.incoterm ?? '—'}</Field>
              <Field label={t('commodity')}>{job.commodity}</Field>
              <Field label={t('weight')}>
                {job.grossWeightKg === null ? '—' : `${formatNumber(job.grossWeightKg, locale)} kg`}
              </Field>
              <Field label={t('volume')}>
                {job.volumeCbm === null ? '—' : `${formatNumber(job.volumeCbm, locale)} cbm`}
              </Field>
              <Field label={t('pieces')}>
                {job.pieces === null ? '—' : formatNumber(job.pieces, locale)}
              </Field>
            </dl>
          </Card>

          {/* --- the free-time clocks --------------------------------- */}
          {job.clocks.length > 0 ? (
            <Card tone="critical">
              <CardHeader icon="clock" eyebrow={t('clocks')} title={t('clocksHint')} />
              <ul className="mt-4 flex flex-col gap-3">
                {job.clocks.map((clock) => (
                  <li key={clock.id}>
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className="flex items-center gap-2">
                        <Badge tone="critical">
                          {t(`clockKinds.${clock.kind}` as 'clockKinds.demurrage')}
                        </Badge>
                        <span className="ref numeric text-[0.8125rem] text-ink-muted">
                          {clock.containerNo}
                        </span>
                      </span>
                      <span className="numeric accruing font-display text-[1.375rem] leading-none font-semibold text-critical">
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

                    <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[0.75rem] text-ink-muted">
                      <span>
                        {t('freeDays', { days: clock.freeDays })} ·{' '}
                        <span className="font-medium text-critical">
                          {t('chargeableDays', { days: clock.chargeableDays })}
                        </span>{' '}
                        · {t('perDiem', { amount: formatMoney(clock.perDiem, locale) })}
                      </span>
                      {clock.counterparty ? (
                        <span>
                          {t('counterparty')} {clock.counterparty}
                        </span>
                      ) : null}
                    </div>

                    {/*
                      The beat the demo is built around: nobody had to remember
                      to add this line — the nightly accrual wrote it.
                    */}
                    {clock.chargeLineWritten ? (
                      <p className="mt-2 inline-flex items-center gap-1.5 rounded-sm bg-positive-soft px-2 py-1 text-[0.75rem] font-medium text-positive">
                        <Icon name="check" size={13} strokeWidth={2.5} />
                        {t('chargeLineWritten')}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
        </div>
      </Grid>

      <Grid>
        {/* --- the document vault, with release control ---------------- */}
        <Card className="lg:col-span-7" padding="none">
          <div className="p-5 pb-3">
            <CardHeader
              icon="document"
              eyebrow={t('documents')}
              title={t('documents')}
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
                    <p className="truncate text-[0.875rem] font-medium text-ink">
                      {nameOf(document.nameEn, document.nameAr)}
                    </p>
                    <p className="text-[0.6875rem] text-ink-subtle">
                      {t('version', { version: document.version })} · {document.sizeKb} KB
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
                  ) : (
                    <Badge tone="muted">{t('draft')}</Badge>
                  )}
                  <Button size="sm" variant="ghost" icon="download" aria-label={tc('download')} />
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* --- containers -------------------------------------------- */}
        <Card className="lg:col-span-5" padding="none">
          <div className="p-5 pb-3">
            <CardHeader icon="container" eyebrow={t('equipment')} title={t('equipment')} />
          </div>

          {job.containers.length === 0 ? (
            <EmptyState icon="container" title={tc('none')} />
          ) : (
            <TableShell className="border-t border-line" minWidth="none">
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
                      <span className="mt-0.5 block text-[0.6875rem] text-ink-subtle">
                        {container.type}
                      </span>
                    </TD>
                    <TD numeric className="text-ink-muted">
                      {container.sealNo ?? '—'}
                    </TD>
                    <TD align="end" numeric className="text-ink-muted">
                      {formatDate(container.dischargedAt, locale)}
                    </TD>
                    <TD align="end" numeric className="text-ink-muted">
                      {formatDate(container.gateOutAt, locale)}
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
