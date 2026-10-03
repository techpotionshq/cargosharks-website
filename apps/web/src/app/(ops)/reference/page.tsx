/**
 * Reference data — the tables the engines read.
 *
 * This screen exists because an empty reference table is a *silent* failure.
 * Rating cannot resolve a charge type that does not exist, and the error
 * surfaces three screens away as "no rate found" on a quotation. Showing the
 * counts turns a mystery into a missing row.
 *
 * Read-only: these are seeded by `pnpm db:seed` and changed by migration, so
 * that a deployment is reproducible rather than dependent on someone having
 * typed the right thing into a form.
 */

import type { Metadata } from 'next'
import { Fragment } from 'react'
import { getLocale, getTranslations } from 'next-intl/server'
import { requireSession } from '@/lib/session'
import {
  listCalendars,
  listChargeTypes,
  listDutyRates,
  listFxRates,
  listEngineRules,
  listMilestoneTemplates,
  listReferenceRecords,
  listReferenceSample,
  referenceCounts,
} from '@/features/admin/queries'
import { DEFAULT_LOCALE, isLocale } from '@/i18n/request'
import { Card, CardHeader } from '@/ui/card'
import { EmptyState, Grid, PageHeader } from '@/ui/layout'
import { Badge } from '@/ui/status'
import { Icon } from '@/ui/icon'
import { TableShell, TBody, TD, TH, THead, TR } from '@/ui/table'
import { ReferenceDialog } from '@/features/admin/ui/dialogs'
import {
  ChargeableRuleDialog,
  DutyRateDialog,
  FxRateDialog,
  FreeTimeRuleDialog,
  HolidayDialog,
  MilestoneTemplateDialog,
  WorkingCalendarDialog,
} from '@/features/admin/ui/reference-dialogs'
import { formatMoney, formatNumber, trimDecimal } from '@/lib/format'

/**
 * One height for every register on this page — 34rem.
 *
 * Picked against what the tables actually hold rather than against how a
 * window happens to look. A row is about 40px, so the seeded registers lay out
 * flat at roughly: charge types 21 rows (~54rem), milestone templates 43
 * (~110rem), document types 11, exception codes 9, working calendars 4, and a
 * duty tariff that is three lines seeded and the national schedule in a real
 * deployment. The short side of the first row is the fixed one — four
 * calendars above nine exception codes comes to about this — so the cap is set
 * there: the stack ends up full, the charge register scrolls, and no single
 * table gets to decide that the page is two thousand pixels tall.
 *
 * The cards are flex columns so their bodies can claim whatever is left below
 * the header; that is what keeps the last row against the card's bottom edge
 * instead of floating above a slab of empty canvas.
 */
const PANEL = 'flex max-h-136 flex-col'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('reference')
  return { title: t('title') }
}

const BASES = [
  'flat',
  'per_unit',
  'per_kg',
  'per_cbm',
  'per_wm',
  'per_container',
  'per_day',
  'percent',
] as const

/** The categories the seed writes; an administrator may add others. */
const CATEGORIES = [
  'freight',
  'origin',
  'destination',
  'customs',
  'transport',
  'documentation',
  'special',
  'other',
  'commercial',
  'compliance',
  'partner_compliance',
] as const

/** The key each editable catalogue's name is filed under in `reference.tables`. */
const CATALOGUE_KEYS = {
  charge_type: 'charge_types',
  commodity: 'commodities',
  document_type: 'document_types',
  exception_code: 'exception_codes',
} as const

export default async function ReferencePage() {
  const session = await requireSession()
  const t = await getTranslations('reference')
  const tc = await getTranslations('common')
  const resolved = await getLocale()
  const locale = isLocale(resolved) ? resolved : DEFAULT_LOCALE

  /*
    Codes as words — U1. The basis is an enum and every value has a label;
    a category is a column an administrator writes, so the seeded ones are
    translated and one somebody invented is shown as they typed it, which is
    the only honest thing to show for it.
  */
  const basisLabel = (basis: string) =>
    (BASES as readonly string[]).includes(basis) ? t(`bases.${basis}` as 'bases.flat') : basis
  const categoryLabel = (category: string) =>
    (CATEGORIES as readonly string[]).includes(category)
      ? t(`categories.${category}` as 'categories.other')
      : category

  const [counts, charges, sample, milestones, calendars, duties, rules, fx, records] =
    await Promise.all([
      referenceCounts(session.actor),
      listChargeTypes(session.actor),
      listReferenceSample(session.actor, locale),
      listMilestoneTemplates(session.actor),
      listCalendars(session.actor),
      listDutyRates(session.actor),
      listEngineRules(session.actor),
      listFxRates(session.actor),
      listReferenceRecords(session.actor),
    ])

  /*
    The engine rules, worded here rather than in the read.

    The query used to return `sea_fcl`, `demurrage`, `KWI · sea_fcl · 40HC` and
    "10 days · 32 KWD · calendar" as finished strings, in English, so the
    Arabic page printed the enum values and the sentence verbatim. The rows
    are data; the words are the catalogue's.
  */
  const tMode = await getTranslations('mode')
  const tDirection = await getTranslations('direction')
  const tFree = await getTranslations('freeTimeRuleForm')
  const tNav = await getTranslations('nav')
  const modeLabel = (mode: unknown) =>
    typeof mode === 'string' && tMode.has(mode) ? tMode(mode as 'air') : String(mode ?? '')
  // A seeded role by its name; a role an administrator invented, as typed.
  const roleLabel = (key: string) =>
    tNav.has(`roles.${key}`) ? tNav(`roles.${key}` as 'roles.coordinator') : key
  const chargeableScope = (raw: Record<string, unknown>) =>
    (raw.branchCode as string | null) ?? t('everywhere')
  // As the trade states it: a divisor, an increment, a floor. No divisor is
  // FCL, billed per container and never by volume.
  const chargeableDetail = (raw: Record<string, unknown>) =>
    raw.divisorCm3PerKg === null || raw.divisorCm3PerKg === undefined
      ? t('perContainer')
      : t('chargeableDetail', {
          divisor: formatNumber(Number(raw.divisorCm3PerKg), locale),
          roundUp: formatNumber(Number(raw.roundUpToKg), locale),
          minimum: formatNumber(Number(raw.minimumKg), locale),
        })
  const freeTimeKind = (raw: Record<string, unknown>) =>
    ['demurrage', 'detention', 'storage'].includes(raw.kind as string)
      ? tFree(`kinds.${raw.kind as 'demurrage'}`)
      : String(raw.kind)
  // Absence is how a rule widens, so an empty scope is "everywhere".
  const freeTimeScope = (raw: Record<string, unknown>) =>
    [raw.branchCode as string | null, raw.mode ? modeLabel(raw.mode) : null, raw.containerType]
      .filter(Boolean)
      .join(' · ') || t('everywhere')
  const freeTimeDetail = (raw: Record<string, unknown>) =>
    t('freeTimeDetail', {
      days: formatNumber(Number(raw.freeDays), locale),
      perDiem: formatMoney({ amount: String(raw.perDiem), currency: String(raw.currency) }, locale),
      basis: raw.dayBasis === 'working' ? tFree('working') : tFree('calendar'),
    })

  /** `480` reads as `08:00` — the column is minutes from local midnight. */
  const clock = (minutes: number) =>
    `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`

  // Named in the reader's language, as the rows beside it are (F27).
  const calendarOptions = calendars.map((row) => ({
    value: row.id,
    label: locale === 'ar' && row.nameAr ? row.nameAr : row.nameEn,
  }))

  const empty = counts.filter((row) => row.count === 0)

  return (
    <>
      <PageHeader
        eyebrow={t('eyebrow')}
        title={t('title')}
        description={t('subtitle')}
        /*
          All four catalogues are creatable from here, because these are the
          tables that make the product *theirs*. A forwarder whose charge list
          and exception codes match how they actually work is using their own
          system; one who has to live with the seeded list is using ours.
        */
        actions={
          <>
            <ReferenceDialog table="charge_type" variant="secondary" />
            <ReferenceDialog table="commodity" variant="secondary" />
            <ReferenceDialog table="document_type" variant="secondary" />
            <ReferenceDialog table="exception_code" variant="primary" />
          </>
        }
      />

      {empty.length ? (
        <p className="mb-4 flex items-center gap-2 rounded-md bg-caution-soft px-3 py-2 text-body-sm font-medium text-caution ring-1 ring-caution/25 ring-inset">
          <Icon name="alert" size={16} />
          {t('emptyWarning', { tables: empty.map((row) => t(`tables.${row.key}`)).join(', ') })}
        </p>
      ) : null}

      {/*
        The counts first — this is the screen's actual job.

        The separators are the `bg-line` container showing through a one-pixel
        gap, which is cheap and correct right up to the moment the last row
        runs short: the cells that were never rendered leave the container
        itself on display, and a slab of line-grey at the end of the strip
        reads as a tile that failed to load. Padding the list to a multiple of
        six covers it at all three breakpoints at once, since six divides by
        both two and three.
      */}
      <div className="mb-5 grid grid-cols-2 gap-px overflow-hidden rounded-card border border-line bg-line @xl:grid-cols-3 @4xl:grid-cols-6">
        {counts.map((row) => (
          <div key={row.key} className="bg-surface px-4 py-3">
            <p className="eyebrow truncate">{t(`tables.${row.key}`)}</p>
            <p
              className={`numeric mt-1 text-headline font-semibold ${
                row.count === 0 ? 'text-caution' : 'text-ink'
              }`}
            >
              {row.count}
            </p>
          </div>
        ))}
        {Array.from({ length: (6 - (counts.length % 6)) % 6 }, (_, index) => (
          <div key={`pad-${index}`} aria-hidden className="bg-surface" />
        ))}
      </div>

      <Grid className="mb-4">
        <Card className={`${PANEL} @4xl:col-span-7`} padding="none">
          <div className="p-5 pb-3">
            <CardHeader
              icon="finance"
              eyebrow={t('eyebrow')}
              title={t('chargeTypes')}
              description={t('chargeTypesHint')}
            />
          </div>
          <TableShell scroll="fill" className="border-t border-line">
            <THead>
              <TR>
                <TH>{t('key')}</TH>
                <TH>{t('name')}</TH>
                {/* Key, name and whether it is mapped — the last is the state
                    that stops a period closing, so it is what a phone keeps. */}
                <TH priority="low">{t('category')}</TH>
                <TH priority="low">{t('basis')}</TH>
                <TH>{t('accounts')}</TH>
              </TR>
            </THead>
            <TBody>
              {charges.map((row) => (
                <TR key={row.key}>
                  {/* A key may break anywhere on a phone — `customs_clearance_fee`
                      has no space to break at, and held whole it was the
                      column that pushed the mapping off-screen. Wider, it
                      breaks only after an underscore (a `<wbr>`, so a copied
                      key is still the key): whole, it held this half-width
                      card 9px past its edge at 1280. */}
                  <TD className="ref text-ink wrap-anywhere md:wrap-normal">
                    {row.key.split('_').map((part, i) => (
                      <Fragment key={i}>
                        {i > 0 ? (
                          <>
                            _<wbr />
                          </>
                        ) : null}
                        {part}
                      </Fragment>
                    ))}
                  </TD>
                  <TD className="text-ink">{locale === 'ar' ? row.nameAr : row.nameEn}</TD>
                  <TD priority="low">
                    <Badge tone="muted">{categoryLabel(row.category)}</Badge>
                  </TD>
                  <TD priority="low" className="text-ink-muted">
                    {basisLabel(row.basis)}
                  </TD>
                  {/*
                    Unmapped is the state that stops a period closing, and this
                    is the screen where it gets fixed — so it is shown here
                    rather than only inside the export's refusal.
                  */}
                  {/* May break after the slash, revenue over cost: held to
                      one line it was the 37px by which this card scrolled
                      at 1280, sharing the row with the milestone panel. */}
                  <TD className="ref">
                    {row.revenueAccountCode || row.costAccountCode ? (
                      <span className="text-ink-muted">
                        {row.revenueAccountCode ?? '—'} / {row.costAccountCode ?? '—'}
                      </span>
                    ) : (
                      <Badge tone="caution">{t('unmapped')}</Badge>
                    )}
                  </TD>
                </TR>
              ))}
            </TBody>
          </TableShell>
        </Card>

        <div className={`${PANEL} gap-4 @4xl:col-span-5`}>
          {/*
            `shrink-0`: a forwarder has four working calendars and will never
            have forty, so this card keeps its natural height and the card
            below it absorbs whatever the row's cap leaves over.
          */}
          <Card className="shrink-0">
            <CardHeader icon="calendar" eyebrow={t('eyebrow')} title={t('calendarsGlance')} />
            <p className="mt-1 mb-4 text-body-sm text-ink-muted">{t('calendarsHint')}</p>
            <ul className="flex flex-col gap-2">
              {sample.calendars.map((calendar) => (
                <li
                  key={calendar.key}
                  className="flex items-center justify-between border-b border-line pb-2 last:border-0 last:pb-0"
                >
                  <span className="text-body text-ink">{calendar.name}</span>
                  <span className="ref text-caption text-ink-subtle">{calendar.timeZone}</span>
                </li>
              ))}
            </ul>
          </Card>

          {/*
            `flex-1` and its own scroll, for the same reason the register has
            one: the grid stretches this column to the row's height but a stack
            of cards keeps its natural one, so the remainder fell out of the
            bottom as bare canvas. The last card takes it, and the list inside
            scrolls rather than deciding how tall the row is.
          */}
          <Card className="flex min-h-0 flex-1 flex-col">
            <CardHeader icon="alert" eyebrow={t('eyebrow')} title={t('exceptionCodes')} />
            <ul className="qb-scroll mt-4 flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
              {sample.exceptions.map((code) => (
                <li
                  key={code.code}
                  className="flex items-center justify-between gap-3 border-b border-line pb-2 last:border-0 last:pb-0"
                >
                  {/* The name, not the key beside it (`customs_hold`): an
                      identifier on both languages' screens, read by nobody. */}
                  <span className="min-w-0 text-body text-ink">{code.name}</span>
                  <span className="numeric shrink-0 text-caption text-ink-muted">
                    {code.slaHours === null ? '—' : t('slaHours', { hours: code.slaHours })}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </Grid>

      <Grid>
        <Card className={`${PANEL} @4xl:col-span-4`}>
          <CardHeader icon="jobs" eyebrow={t('eyebrow')} title={t('containers')} />
          <ul className="qb-scroll mt-4 flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto">
            {sample.containers.map((row) => (
              <li key={row.code} className="flex items-center justify-between text-body">
                <span className="ref text-ink">{row.code}</span>
                <span className="text-ink-muted">{row.name}</span>
              </li>
            ))}
          </ul>
        </Card>

        <Card className={`${PANEL} @4xl:col-span-4`}>
          <CardHeader icon="rates" eyebrow={t('eyebrow')} title={t('incoterms')} />
          {/* `content-start`: a two-column grid given spare height spreads its
              rows down it, which would undo the point of the fill. */}
          <ul className="qb-scroll mt-4 grid min-h-0 flex-1 auto-rows-min grid-cols-2 content-start gap-1.5 overflow-y-auto">
            {sample.incoterms.map((row) => (
              <li key={row.code} className="flex flex-col text-body-sm">
                <span className="ref text-ink">{row.code}</span>
                <span className="truncate text-caption text-ink-subtle">{row.name}</span>
              </li>
            ))}
          </ul>
        </Card>

        <Card className={`${PANEL} @4xl:col-span-4`}>
          <CardHeader icon="document" eyebrow={t('eyebrow')} title={t('documentTypes')} />
          <ul className="qb-scroll mt-4 flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto">
            {sample.documents.map((row) => (
              <li key={row.code} className="flex items-center justify-between text-body-sm">
                <span className="text-ink">{row.name}</span>
                <Badge tone="muted">{categoryLabel(row.category)}</Badge>
              </li>
            ))}
          </ul>
        </Card>
      </Grid>

      {/*
        Every row of the four catalogues, editable — QA P2-13.

        The screen could add to these and change nothing: the lists above
        carry no ids and leave inactive rows out, and commodities were not
        listed at all. Retiring is the edit dialog's Active switch, because
        nothing here is deleted and a retired row must be findable to bring
        back. Offline the list is empty — the pilot writes nothing.
      */}
      {records.length > 0 ? (
        <section className="mt-4">
          <div className="mb-3">
            <h2 className="text-title font-semibold text-ink">{t('editCatalogues')}</h2>
            <p className="mt-0.5 text-body-sm text-ink-muted">{t('editCataloguesHint')}</p>
          </div>
          <Grid>
            {(['charge_type', 'commodity', 'document_type', 'exception_code'] as const).map(
              (table) => (
                <Card key={table} className={`${PANEL} @4xl:col-span-6`} padding="none">
                  <div className="p-5 pb-3">
                    <CardHeader
                      icon="reference"
                      eyebrow={t('eyebrow')}
                      title={t(`tables.${CATALOGUE_KEYS[table]}`)}
                    />
                  </div>
                  <TableShell className="border-t border-line" scroll="fill">
                    <TBody>
                      {records
                        .filter((row) => row.table === table)
                        .map((row) => (
                          <TR key={row.id}>
                            <TD>
                              <span className={row.isActive ? 'text-ink' : 'text-ink-subtle'}>
                                {locale === 'ar' && row.nameAr ? row.nameAr : row.nameEn}
                              </span>
                              <span className="ref block text-micro text-ink-subtle wrap-anywhere">
                                {row.code}
                              </span>
                            </TD>
                            <TD>
                              <Badge tone={row.isActive ? 'positive' : 'muted'}>
                                {row.isActive ? tc('active') : tc('inactive')}
                              </Badge>
                            </TD>
                            <TD align="end">
                              <ReferenceDialog
                                table={table}
                                variant="ghost"
                                iconOnly
                                defaults={row}
                              />
                            </TD>
                          </TR>
                        ))}
                    </TBody>
                  </TableShell>
                </Card>
              ),
            )}
          </Grid>
        </section>
      ) : null}

      {/*
        The three the engines read, and the three CLAUDE.md named as an
        administrator's edit while they were seed-only: what steps a job gets,
        which days are working days, and what a tariff line charges.

        Below the catalogues rather than above, because these are read far less
        often — but on this page rather than in settings, because they are the
        same kind of thing as a charge type: rows the product runs on.
      */}
      <Grid className="mt-4">
        <Card className={`${PANEL} @4xl:col-span-12`} padding="none">
          <div className="p-5 pb-3">
            <CardHeader
              icon="tracking"
              eyebrow={t('eyebrow')}
              title={t('milestoneTemplates')}
              description={t('milestoneTemplatesHint')}
              actions={<MilestoneTemplateDialog />}
            />
          </div>

          {milestones.length === 0 ? (
            <EmptyState icon="tracking" title={t('noMilestones')} />
          ) : (
            <TableShell className="border-t border-line" scroll="fill">
              <THead>
                <TR>
                  <TH>{t('shape')}</TH>
                  <TH align="end">{t('seq')}</TH>
                  <TH>{t('step')}</TH>
                  <TH priority="low">{t('owner')}</TH>
                  <TH align="end" />
                </TR>
              </THead>
              <TBody>
                {milestones.map((row) => (
                  <TR key={row.id}>
                    <TD className="@3xl:whitespace-nowrap">
                      <Badge tone="muted">{modeLabel(row.mode)}</Badge>
                      <span className="block text-caption text-ink-subtle @3xl:ms-1.5 @3xl:inline">
                        {tDirection(row.direction as 'import')}
                      </span>
                    </TD>
                    <TD align="end" numeric>
                      {row.seq}
                    </TD>
                    <TD>
                      <span className="font-medium text-ink">
                        {locale === 'ar' ? row.nameAr : row.nameEn}
                      </span>
                      {row.customerVisible ? null : (
                        <Badge tone="muted" className="ms-2">
                          {t('internalOnly')}
                        </Badge>
                      )}
                    </TD>
                    <TD priority="low" className="text-ink-muted">
                      {row.ownerRole ? roleLabel(row.ownerRole) : '—'}
                    </TD>
                    <TD align="end">
                      <MilestoneTemplateDialog defaults={row} />
                    </TD>
                  </TR>
                ))}
              </TBody>
            </TableShell>
          )}
        </Card>

        {/*
          The pair where the row is sized by the *shorter* card, not the taller.

          A forwarder has three or four working calendars and, once the
          national tariff is loaded, several hundred duty lines. Stretching the
          calendars to the tariff's cap gives four rows above a slab of
          emptiness; letting each end where its data ends leaves the tariff
          hanging a couple of hundred pixels below its neighbour. Neither is a
          grid.

          So the calendars keep their natural height and set the row, and the
          tariff beside them takes `h-0 min-h-full` — a grid item with no
          height of its own contributes nothing to the row's measurement, then
          fills whatever the row turns out to be. The tariff scrolls inside it.
          Both cards end on the same line, neither is padded, and the height
          follows the data rather than a number chosen here.
        */}
        <Card className={`${PANEL} @4xl:col-span-6`} padding="none">
          <div className="p-5 pb-3">
            <CardHeader
              icon="calendar"
              eyebrow={t('eyebrow')}
              title={t('calendars')}
              description={t('calendarsHint')}
              actions={
                <span className="flex gap-2">
                  <HolidayDialog calendars={calendarOptions} />
                  <WorkingCalendarDialog />
                </span>
              }
            />
          </div>

          <TableShell className="border-t border-line" scroll="fill">
            <THead>
              <TR>
                <TH>{t('calendar')}</TH>
                <TH priority="low">{t('weekend')}</TH>
                <TH>{t('hours')}</TH>
                <TH align="end">{t('holidays')}</TH>
                <TH align="end" />
              </TR>
            </THead>
            <TBody>
              {calendars.map((row) => (
                <TR key={row.id}>
                  <TD>
                    <span className="font-medium text-ink">
                      {locale === 'ar' ? row.nameAr : row.nameEn}
                    </span>
                    {/* Under the name at every width: beside it, "Kuwait
                        Asia/Kuwait" made the column wider than this
                        half-width card could give it. */}
                    <span className="ref block text-micro text-ink-subtle">{row.timeZone}</span>
                  </TD>
                  <TD priority="low" className="text-ink-muted">
                    {row.weekend.map((day) => t(`weekdays.${day}` as 'weekdays.0')).join(', ')}
                  </TD>
                  <TD numeric className="whitespace-nowrap text-ink-muted">
                    {clock(row.dayStartMinute)}–{clock(row.dayEndMinute)}
                  </TD>
                  <TD align="end" numeric>
                    {row.holidays}
                  </TD>
                  <TD align="end">
                    <WorkingCalendarDialog defaults={row} />
                  </TD>
                </TR>
              ))}
            </TBody>
          </TableShell>
        </Card>

        <Card className={`${PANEL} h-0 min-h-full @4xl:col-span-6`} padding="none">
          <div className="p-5 pb-3">
            <CardHeader
              icon="customs"
              eyebrow={t('eyebrow')}
              title={t('dutyRates')}
              description={t('dutyRatesHint')}
              actions={<DutyRateDialog />}
            />
          </div>

          {duties.length === 0 ? (
            <EmptyState icon="customs" title={t('noDuties')} description={t('noDutiesHint')} />
          ) : (
            <TableShell className="border-t border-line" scroll="fill">
              <THead>
                <TR>
                  <TH>{t('hsPrefix')}</TH>
                  <TH>{t('description')}</TH>
                  <TH align="end">{t('rate')}</TH>
                  <TH align="end" />
                </TR>
              </THead>
              <TBody>
                {/*
                  Every row the query returns, not the first 25 it used to
                  show. A silent slice was survivable while the panel ended
                  where the data did; now that it scrolls, the last visible row
                  *is* the claim that there is nothing after it, and a
                  truncation nothing announces makes the panel lie. The real
                  ceiling stays where it belongs, in `listDutyRates`.
                */}
                {duties.map((row) => (
                  <TR key={row.id}>
                    <TD className="ref whitespace-nowrap">
                      {row.hsPrefix}
                      <span className="ms-1.5 text-micro text-ink-subtle">{row.country}</span>
                    </TD>
                    <TD className="text-ink">
                      {locale === 'ar' && row.descriptionAr ? row.descriptionAr : row.descriptionEn}
                    </TD>
                    <TD align="end" numeric className="font-semibold">
                      {trimDecimal(row.ratePercent)}%
                    </TD>
                    <TD align="end">
                      <DutyRateDialog defaults={row} />
                    </TD>
                  </TR>
                ))}
              </TBody>
            </TableShell>
          )}
        </Card>
      </Grid>

      {/*
        What the engines measure with.

        Both tables are read by `packages/db` and by nothing in this
        application, which is why neither had a screen: the divisor a shipment
        is billed on and the days before demurrage starts were configuration
        with no way to configure it.
      */}
      <Grid className="mt-4">
        <Card className={`${PANEL} @4xl:col-span-6`} padding="none">
          <div className="p-5 pb-3">
            <CardHeader
              icon="rates"
              eyebrow={t('eyebrow')}
              title={t('chargeableRules')}
              description={t('chargeableRulesHint')}
              actions={<ChargeableRuleDialog />}
            />
          </div>
          <TableShell className="border-t border-line" scroll="fill">
            <THead>
              <TR>
                <TH>{t('mode')}</TH>
                <TH>{t('scope')}</TH>
                <TH>{t('rule')}</TH>
                <TH align="end" />
              </TR>
            </THead>
            <TBody>
              {rules.chargeable.map((row) => (
                <TR key={row.id}>
                  <TD className="font-medium text-ink">{modeLabel(row.raw.mode)}</TD>
                  <TD className="text-ink-muted">{chargeableScope(row.raw)}</TD>
                  <TD className="text-body-sm text-ink-muted">{chargeableDetail(row.raw)}</TD>
                  <TD align="end">
                    <ChargeableRuleDialog defaults={row.raw as never} />
                  </TD>
                </TR>
              ))}
            </TBody>
          </TableShell>
        </Card>

        <Card className={`${PANEL} @4xl:col-span-6`} padding="none">
          <div className="p-5 pb-3">
            <CardHeader
              icon="clock"
              eyebrow={t('eyebrow')}
              title={t('freeTimeRules')}
              description={t('freeTimeRulesHint')}
              actions={<FreeTimeRuleDialog />}
            />
          </div>
          {rules.freeTime.length === 0 ? (
            <EmptyState
              icon="clock"
              title={t('noFreeTimeRules')}
              description={t('noFreeTimeRulesHint')}
            />
          ) : (
            <TableShell className="border-t border-line" scroll="fill">
              <THead>
                <TR>
                  <TH>{t('kind')}</TH>
                  <TH>{t('scope')}</TH>
                  <TH>{t('terms')}</TH>
                  <TH align="end" />
                </TR>
              </THead>
              <TBody>
                {rules.freeTime.map((row) => (
                  <TR key={row.id}>
                    <TD className="font-medium text-ink">{freeTimeKind(row.raw)}</TD>
                    <TD className="text-ink-muted">{freeTimeScope(row.raw)}</TD>
                    <TD className="text-body-sm text-ink-muted">{freeTimeDetail(row.raw)}</TD>
                    <TD align="end">
                      <FreeTimeRuleDialog defaults={row.raw as never} />
                    </TD>
                  </TR>
                ))}
              </TBody>
            </TableShell>
          )}
        </Card>
      </Grid>

      {/*
        Exchange rates (S12). Pricing converts every card into the branch
        currency and refuses without a rate; with no FX feed configured, a
        fresh instance had no rates and no screen to enter one, so every sea
        enquiry refused "Price it".
      */}
      <Grid className="mt-4">
        <Card className={`${PANEL} @4xl:col-span-6`} padding="none">
          <div className="p-5 pb-3">
            <CardHeader
              icon="finance"
              eyebrow={t('eyebrow')}
              title={t('fxRates')}
              description={t('fxRatesHint')}
              actions={<FxRateDialog />}
            />
          </div>
          {fx.length === 0 ? (
            <EmptyState icon="finance" title={t('noFxRates')} description={t('noFxRatesHint')} />
          ) : (
            <TableShell className="border-t border-line" scroll="fill">
              <THead>
                <TR>
                  <TH>{t('fxPair')}</TH>
                  <TH align="end">{t('rate')}</TH>
                  <TH>{t('fxEffective')}</TH>
                  <TH priority="low">{t('fxSource')}</TH>
                  <TH align="end" />
                </TR>
              </THead>
              <TBody>
                {fx.map((row) => (
                  <TR key={`${row.fromCurrency}-${row.toCurrency}`}>
                    <TD className="ref whitespace-nowrap">
                      {/* Codes read left to right in both languages. */}
                      <bdi dir="ltr">
                        {row.fromCurrency} → {row.toCurrency}
                      </bdi>
                    </TD>
                    <TD align="end" numeric className="font-semibold">
                      {trimDecimal(row.rate)}
                    </TD>
                    <TD className="numeric text-ink-muted">{row.effectiveOn}</TD>
                    <TD priority="low" className="text-ink-muted">
                      {row.source === 'manual' ? t('fxManual') : row.source}
                    </TD>
                    <TD align="end">
                      <FxRateDialog
                        defaults={{
                          fromCurrency: row.fromCurrency,
                          toCurrency: row.toCurrency,
                          rate: trimDecimal(row.rate) ?? row.rate,
                        }}
                      />
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
