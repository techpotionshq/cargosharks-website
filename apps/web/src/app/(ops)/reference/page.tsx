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
import { getLocale, getTranslations } from 'next-intl/server'
import { requireSession } from '@/lib/session'
import { listChargeTypes, listReferenceSample, referenceCounts } from '@/features/admin/queries'
import { DEFAULT_LOCALE, isLocale } from '@/i18n/request'
import { Card, CardHeader } from '@/ui/card'
import { Grid, PageHeader } from '@/ui/layout'
import { Badge } from '@/ui/status'
import { Icon } from '@/ui/icon'
import { TableShell, TBody, TD, TH, THead, TR } from '@/ui/table'
import { ReferenceDialog } from '@/features/admin/ui/dialogs'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('reference')
  return { title: t('title') }
}

export default async function ReferencePage() {
  const session = await requireSession()
  const t = await getTranslations('reference')
  const resolved = await getLocale()
  const locale = isLocale(resolved) ? resolved : DEFAULT_LOCALE

  const [counts, charges, sample] = await Promise.all([
    referenceCounts(session.actor),
    listChargeTypes(session.actor),
    listReferenceSample(session.actor),
  ])

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
        <p className="mb-4 flex items-center gap-2 rounded-md bg-caution-soft px-3 py-2 text-[0.8125rem] font-medium text-caution ring-1 ring-caution/25 ring-inset">
          <Icon name="alert" size={16} />
          {t('emptyWarning', { tables: empty.map((row) => t(`tables.${row.key}`)).join(', ') })}
        </p>
      ) : null}

      {/* The counts first — this is the screen's actual job. */}
      <div className="mb-5 grid grid-cols-2 gap-px overflow-hidden rounded-card border border-line bg-line sm:grid-cols-3 lg:grid-cols-6">
        {counts.map((row) => (
          <div key={row.key} className="bg-surface px-4 py-3">
            <p className="eyebrow truncate">{t(`tables.${row.key}`)}</p>
            <p
              className={`numeric mt-1 text-[1.375rem] font-semibold ${
                row.count === 0 ? 'text-caution' : 'text-ink'
              }`}
            >
              {row.count}
            </p>
          </div>
        ))}
      </div>

      <Grid className="mb-4">
        <Card className="lg:col-span-7" padding="none">
          <div className="p-5 pb-3">
            <CardHeader
              icon="finance"
              eyebrow={t('eyebrow')}
              title={t('chargeTypes')}
              description={t('chargeTypesHint')}
            />
          </div>
          <TableShell minWidth="none" className="border-t border-line">
            <THead>
              <TR>
                <TH>{t('key')}</TH>
                <TH>{t('name')}</TH>
                <TH>{t('category')}</TH>
                <TH>{t('basis')}</TH>
                <TH>{t('accounts')}</TH>
              </TR>
            </THead>
            <TBody>
              {charges.map((row) => (
                <TR key={row.key}>
                  <TD className="ref whitespace-nowrap text-ink">{row.key}</TD>
                  <TD className="text-ink">{locale === 'ar' ? row.nameAr : row.nameEn}</TD>
                  <TD>
                    <Badge tone="muted">{row.category}</Badge>
                  </TD>
                  <TD className="ref text-ink-muted">{row.basis}</TD>
                  {/*
                    Unmapped is the state that stops a period closing, and this
                    is the screen where it gets fixed — so it is shown here
                    rather than only inside the export's refusal.
                  */}
                  <TD className="ref whitespace-nowrap">
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

        <div className="flex flex-col gap-4 lg:col-span-5">
          <Card>
            <CardHeader icon="calendar" eyebrow={t('eyebrow')} title={t('calendars')} />
            <p className="mt-1 mb-4 text-[0.8125rem] text-ink-muted">{t('calendarsHint')}</p>
            <ul className="flex flex-col gap-2">
              {sample.calendars.map((calendar) => (
                <li
                  key={calendar.key}
                  className="flex items-center justify-between border-b border-line pb-2 last:border-0 last:pb-0"
                >
                  <span className="text-[0.875rem] text-ink">{calendar.nameEn}</span>
                  <span className="ref text-[0.75rem] text-ink-subtle">{calendar.timeZone}</span>
                </li>
              ))}
            </ul>
          </Card>

          <Card>
            <CardHeader icon="alert" eyebrow={t('eyebrow')} title={t('exceptionCodes')} />
            <ul className="mt-4 flex flex-col gap-2">
              {sample.exceptions.map((code) => (
                <li
                  key={code.code}
                  className="flex items-center justify-between gap-3 border-b border-line pb-2 last:border-0 last:pb-0"
                >
                  <span className="min-w-0 text-[0.875rem] text-ink">
                    {code.nameEn}
                    <span className="ref ms-2 text-[0.75rem] text-ink-subtle">{code.code}</span>
                  </span>
                  <span className="numeric shrink-0 text-[0.75rem] text-ink-muted">
                    {code.slaHours === null ? '—' : t('slaHours', { hours: code.slaHours })}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </Grid>

      <Grid>
        <Card className="lg:col-span-4">
          <CardHeader icon="jobs" eyebrow={t('eyebrow')} title={t('containers')} />
          <ul className="mt-4 flex flex-col gap-1.5">
            {sample.containers.map((row) => (
              <li key={row.code} className="flex items-center justify-between text-[0.875rem]">
                <span className="ref text-ink">{row.code}</span>
                <span className="text-ink-muted">{row.nameEn}</span>
              </li>
            ))}
          </ul>
        </Card>

        <Card className="lg:col-span-4">
          <CardHeader icon="rates" eyebrow={t('eyebrow')} title={t('incoterms')} />
          <ul className="mt-4 grid grid-cols-2 gap-1.5">
            {sample.incoterms.map((row) => (
              <li key={row.code} className="flex flex-col text-[0.8125rem]">
                <span className="ref text-ink">{row.code}</span>
                <span className="truncate text-[0.75rem] text-ink-subtle">{row.nameEn}</span>
              </li>
            ))}
          </ul>
        </Card>

        <Card className="lg:col-span-4">
          <CardHeader icon="document" eyebrow={t('eyebrow')} title={t('documentTypes')} />
          <ul className="mt-4 flex flex-col gap-1.5">
            {sample.documents.map((row) => (
              <li key={row.code} className="flex items-center justify-between text-[0.8125rem]">
                <span className="text-ink">{row.nameEn}</span>
                <Badge tone="muted">{row.category}</Badge>
              </li>
            ))}
          </ul>
        </Card>
      </Grid>
    </>
  )
}
