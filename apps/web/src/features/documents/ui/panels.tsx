/**
 * The three panels the job file was missing.
 *
 * Parties and cargo are data entry; the third is the point of the other two —
 * a row of buttons that turn a shipment into the documents it has to produce.
 *
 * ## Preview is a link, issue is a form
 *
 * That distinction is the whole design. A preview is a `GET` that renders and
 * streams and changes nothing, so it can be a link somebody opens in a tab. An
 * issue is a `POST` that stores the bytes and versions the previous copy, so
 * it is a form with a permission behind it — a `GET` that writes would mean a
 * link preview in somebody's chat client issuing a bill of lading.
 */

import type { ReactNode } from 'react'
import { dec } from '@qabandi/core'
import { getLocale, getTimeZone, getTranslations } from 'next-intl/server'
import { requireSession } from '@/lib/session'
import { formatDate, formatMeasure } from '@/lib/format'
import { DEFAULT_LOCALE, isLocale } from '@/i18n/request'
import { can } from '@/lib/permissions'
import { Card, CardHeader } from '@/ui/card'
import { Button, EmptyState } from '@/ui/layout'
import { Icon } from '@/ui/icon'
import { TBody, TD, TH, THead, TR, TableShell } from '@/ui/table'
import { CargoDialog, PartyDialog } from './dialogs'
import { IssueDocumentButton, SurrenderBillButton } from './document-buttons'
import { issueLocales } from '../issue-locale'
import type { CargoRow, PartyRow } from '../queries'

export async function PartiesCard({
  jobId,
  parties,
  className,
}: {
  readonly jobId: string
  readonly parties: readonly PartyRow[]
  readonly className?: string
}) {
  const t = await getTranslations('parties')
  const tc = await getTranslations('common')

  return (
    <Card className={className} padding="none">
      <div className="flex items-start justify-between gap-3 p-5 pb-3">
        <CardHeader icon="partners" eyebrow={t('eyebrow')} title={t('title')} />
        <PartyDialog jobId={jobId} variant="ghost" />
      </div>

      {parties.length === 0 ? (
        <EmptyState icon="partners" title={t('none')} description={t('noneHint')} />
      ) : (
        <TableShell className="border-t border-line">
          <THead>
            <TR>
              <TH>{t('role')}</TH>
              <TH>{t('name')}</TH>
              {/* The city follows the name on a phone (below). */}
              <TH priority="low">{t('where')}</TH>
              <TH align="end">{tc('actions')}</TH>
            </TR>
          </THead>
          <TBody>
            {parties.map((party) => (
              <TR key={party.id}>
                <TD className="text-ink-muted">{t(`roles.${party.role}` as 'roles.shipper')}</TD>
                <TD>
                  <span className="font-medium">{party.nameEn}</span>
                  {party.nameAr ? (
                    <span className="mt-0.5 block text-micro text-ink-subtle">{party.nameAr}</span>
                  ) : null}
                  {party.city || party.country ? (
                    <span className="mt-0.5 block text-micro text-ink-muted @3xl:hidden">
                      {[party.city, party.country].filter(Boolean).join(', ')}
                    </span>
                  ) : null}
                </TD>
                <TD priority="low" className="text-ink-muted">
                  {[party.city, party.country].filter(Boolean).join(', ') || '—'}
                </TD>
                <TD align="end">
                  <PartyDialog
                    jobId={jobId}
                    variant="ghost"
                    iconOnly
                    defaults={{
                      id: party.id,
                      role: party.role,
                      nameEn: party.nameEn,
                      nameAr: party.nameAr,
                      address: party.address,
                      city: party.city,
                      country: party.country,
                      contactName: party.contactName,
                      phone: party.phone,
                      email: party.email,
                      taxId: party.taxId,
                    }}
                  />
                </TD>
              </TR>
            ))}
          </TBody>
        </TableShell>
      )}
    </Card>
  )
}

export async function CargoCard({
  jobId,
  cargo,
  containers,
  className,
}: {
  readonly jobId: string
  readonly cargo: readonly CargoRow[]
  readonly containers: readonly { value: string; label: string }[]
  readonly className?: string
}) {
  const t = await getTranslations('cargo')
  const tc = await getTranslations('common')
  const resolved = await getLocale()
  const locale = isLocale(resolved) ? resolved : DEFAULT_LOCALE

  // Summed as decimals, the columns' own type, so the total is the rows' sum.
  const totals = cargo.reduce(
    (acc, line) => ({
      packages: acc.packages + (line.packageCount ?? 0),
      gross: acc.gross.plus(line.grossWeightKg ?? 0),
      volume: acc.volume.plus(line.volumeCbm ?? 0),
    }),
    { packages: 0, gross: dec(0), volume: dec(0) },
  )

  return (
    <Card className={className} padding="none">
      <div className="flex items-start justify-between gap-3 p-5 pb-3">
        <CardHeader icon="container" eyebrow={t('eyebrow')} title={t('title')} />
        <CargoDialog jobId={jobId} containers={containers} variant="ghost" />
      </div>

      {cargo.length === 0 ? (
        <EmptyState icon="container" title={t('none')} description={t('noneHint')} />
      ) : (
        <TableShell className="border-t border-line">
          <THead>
            <TR>
              <TH>{t('description')}</TH>
              {/* Weight and volume stay across a phone; the package count
                  follows the description there (below). */}
              <TH priority="low" align="end">
                {t('packages')}
              </TH>
              <TH align="end">{t('grossKg')}</TH>
              <TH align="end">{t('volumeCbm')}</TH>
              <TH align="end">{tc('actions')}</TH>
            </TR>
          </THead>
          <TBody>
            {cargo.map((line) => (
              <TR key={line.id}>
                <TD>
                  <span className="font-medium">{line.descriptionEn}</span>
                  <span className="mt-0.5 block text-micro text-ink-subtle">
                    {[line.hsCode, line.containerNo].filter(Boolean).join(' · ') ||
                      t('unclassified')}
                  </span>
                  {line.packageCount ? (
                    <span className="numeric block text-micro text-ink-muted @3xl:hidden">
                      {line.packageCount} {line.packageType ?? ''}
                    </span>
                  ) : null}
                </TD>
                <TD priority="low" align="end" numeric className="text-ink-muted">
                  {line.packageCount ?? '—'} {line.packageType ?? ''}
                </TD>
                {/* Read at a sensible precision per unit, not as stored (R13). */}
                <TD align="end" numeric className="text-ink-muted">
                  {formatMeasure(line.grossWeightKg, 'kg', locale)}
                </TD>
                <TD align="end" numeric className="text-ink-muted">
                  {formatMeasure(line.volumeCbm, 'cbm', locale)}
                </TD>
                <TD align="end">
                  <CargoDialog
                    jobId={jobId}
                    containers={containers}
                    variant="ghost"
                    iconOnly
                    defaults={{
                      id: line.id,
                      marksAndNumbers: line.marksAndNumbers,
                      packageCount: line.packageCount,
                      packageType: line.packageType,
                      descriptionEn: line.descriptionEn,
                      descriptionAr: line.descriptionAr,
                      hsCode: line.hsCode,
                      grossWeightKg: line.grossWeightKg,
                      netWeightKg: line.netWeightKg,
                      volumeCbm: line.volumeCbm,
                      equipmentId: line.equipmentId,
                    }}
                  />
                </TD>
              </TR>
            ))}
            <TR>
              <TD className="font-semibold">{t('totals')}</TD>
              <TD priority="low" align="end" numeric className="font-semibold">
                {totals.packages}
              </TD>
              <TD align="end" numeric className="font-semibold">
                {formatMeasure(totals.gross.toFixed(), 'kg', locale)}
              </TD>
              <TD align="end" numeric className="font-semibold">
                {formatMeasure(totals.volume.toFixed(), 'cbm', locale)}
              </TD>
              <TD />
            </TR>
          </TBody>
        </TableShell>
      )}
    </Card>
  )
}

const KINDS = ['house_bill', 'delivery_order', 'packing_list', 'customs_pack'] as const

export async function DocumentActionsCard({
  jobId,
  hasCargo,
  mode,
  houseBillNumber,
  houseBillSurrenderedAt,
  dutyAction,
  className,
}: {
  readonly jobId: string
  readonly hasCargo: boolean
  /**
   * Whether there is a bill to surrender, and whether it already was.
   *
   * A telex release is offered only on a numbered sea bill: an unnumbered one
   * was never issued, and an air waybill has no originals to hand back. Once
   * surrendered the button gives way to the date, because there is no way
   * back — see `surrenderHouseBill`.
   */
  readonly houseBillNumber: string | null
  readonly houseBillSurrenderedAt: Date | null
  /**
   * The shipment's mode, for the label only.
   *
   * `house_bill` is one kind producing two documents — a bill of lading by sea
   * and an air waybill by air, decided in the service by the same mode. The
   * key stays `house_bill` everywhere it is stored; this only stops the button
   * offering an air customer a bill of lading they will never receive.
   */
  readonly mode: string
  /**
   * The duty estimate, passed in rather than imported.
   *
   * It belongs to the operations slice and slices do not import each other
   * (§4) — the page composes them. It sits on this card because it is what
   * makes the customs pack above worth printing: a declaration pack with an
   * empty duty column is a form, not an answer.
   */
  readonly dutyAction?: ReactNode
  readonly className?: string
}) {
  const timeZone = await getTimeZone()

  const session = await requireSession()
  const [t, locale] = await Promise.all([getTranslations('documentActions'), getLocale()])
  const lang = isLocale(locale) ? locale : DEFAULT_LOCALE
  const issueIn = issueLocales(locale)
  const mayIssue = can(session, 'document.generate')
  const mayRelease = can(session, 'document.release')
  const surrenderable = mode !== 'air' && houseBillNumber !== null

  return (
    <Card className={className}>
      <CardHeader icon="document" eyebrow={t('eyebrow')} title={t('title')} />

      {!hasCargo ? (
        <p className="mt-3 rounded-sm bg-surface-sunken px-3 py-2 text-body-sm text-ink-muted">
          {t('needsCargo')}
        </p>
      ) : null}

      <ul className="mt-4 space-y-2.5">
        {KINDS.map((kind) => {
          /*
            Built here rather than inline in `href`, because `check-links.mjs`
            probes an interpolated href by its literal prefix and cannot see
            past the first `${` — `/api/jobs/$` is not a route, and the route
            it stands for is two segments further on.
          */
          const preview = `/api/jobs/${jobId}/documents/${kind}`
          const label = kind === 'house_bill' && mode === 'air' ? 'air_waybill' : kind
          return (
            <li
              key={kind}
              className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-2.5 last:border-0"
            >
              <div className="min-w-0">
                <span className="block text-body font-medium text-ink">
                  {t(`kinds.${label}` as 'kinds.house_bill')}
                </span>
                <span className="block text-micro text-ink-subtle">
                  {t(`hints.${label}` as 'hints.house_bill')}
                </span>
              </div>

              <div className="flex max-w-full shrink-0 flex-wrap items-center gap-2">
                {/*
                  Both languages, as links. A `GET` renders and streams and
                  stores nothing, so opening one in a tab is safe and sharing
                  the URL costs nothing but a render.

                  One control in two languages, so it is drawn as one control.
                  The glyph used to hang off EN alone, which made the pair read
                  as a download and then some other thing called AR — two
                  buttons of apparently different kinds for what is a single
                  choice of language. It now sits ahead of both, inside the
                  group it governs, and each link carries the language name for
                  a reader who hears the page rather than sees it.
                */}
                <span className="inline-flex items-center rounded-sm border border-line ps-2">
                  <Icon name="download" size={14} className="shrink-0 text-ink-subtle" />
                  <Button
                    size="sm"
                    variant="ghost"
                    href={preview}
                    download
                    aria-label={t('previewEn')}
                  >
                    EN
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    href={`${preview}?locale=ar`}
                    download
                    aria-label={t('previewAr')}
                  >
                    AR
                  </Button>
                </span>

                {mayIssue ? (
                  <IssueDocumentButton
                    jobId={jobId}
                    kind={kind}
                    label={t('issue')}
                    locale={issueIn.primary}
                    other={issueIn.other}
                    otherLabel={t('issueIn', { language: issueIn.other })}
                  />
                ) : null}
              </div>

              {/*
                The telex release sits under the bill it applies to, not in
                the list of documents — it is not a document, it is a fact
                about this one. The date replaces the button once recorded,
                because the act is not reversible and a button that fails
                silently is worse than none.
              */}
              {kind === 'house_bill' && surrenderable ? (
                <div className="flex w-full flex-wrap items-center justify-between gap-2 rounded-sm bg-surface-sunken px-3 py-1.5">
                  <span className="text-caption text-ink-muted">
                    {houseBillSurrenderedAt
                      ? t('surrenderedOn', {
                          date: formatDate(houseBillSurrenderedAt, lang, timeZone),
                        })
                      : t('surrenderHint')}
                  </span>
                  {!houseBillSurrenderedAt && mayRelease ? (
                    <SurrenderBillButton jobId={jobId} label={t('surrender')} />
                  ) : null}
                </div>
              ) : null}
            </li>
          )
        })}
      </ul>

      {/*
        The duty estimate belongs *to* the list above, not after it.

        Under a rule it read as an orphaned footer stranded between the
        documents and the fine print — a divider says "a different subject
        follows", and this is the same subject: the customs pack one line up
        is a form until somebody puts a number in the duty column. Tinted and
        attached, it reads as the last thing the list offers.
      */}
      {dutyAction ? (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-sm bg-surface-sunken px-3 py-2">
          <span className="text-body-sm text-ink-muted">{t('dutyPrompt')}</span>
          {dutyAction}
        </div>
      ) : null}

      <p className="mt-4 border-t border-line pt-3 text-micro leading-relaxed text-ink-subtle">
        {t('issueNote')}
      </p>
    </Card>
  )
}
