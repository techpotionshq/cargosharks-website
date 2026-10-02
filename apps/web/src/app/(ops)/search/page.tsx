/**
 * Search results — what the box in the topbar answers.
 *
 * Three groups in the order an operator most often wants them: the shipment,
 * the box it is in, and the company it belongs to. Grouping rather than one
 * ranked list is deliberate — the three are different kinds of thing, and a
 * single list would have to invent a score to interleave them, which is a
 * ranking nobody asked for and nobody can predict.
 *
 * The page renders on fixtures as well as on a database, because the demo runs
 * with no database at all and a search box is the first thing anyone touches.
 */

import Link from 'next/link'
import { redirect } from 'next/navigation'
import type { Metadata, Route } from 'next'
import { getLocale, getTimeZone, getTranslations } from 'next-intl/server'
import { requireSession } from '@/lib/session'
import { MIN_QUERY_LENGTH, recordHref, search, totalHits } from '@/features/search/queries'
import { DEFAULT_LOCALE, isLocale } from '@/i18n/request'
import { formatDay } from '@/lib/format'
import { Card } from '@/ui/card'
import { EmptyState, Lane, PageHeader } from '@/ui/layout'
import { Panel } from '@/ui/panel'
import { Badge, jobTone } from '@/ui/status'
import { Icon, modeIcon } from '@/ui/icon'
import { TBody, TD, TH, THead, TR, TableShell } from '@/ui/table'
import { pickName } from '@/lib/named'
import { FOCUS_RING } from '@/ui/control'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('search')
  return { title: t('title') }
}

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>
}) {
  const timeZone = await getTimeZone()

  const session = await requireSession()
  const { q } = await searchParams
  const query = (q ?? '').trim()

  const t = await getTranslations('search')
  const tc = await getTranslations('common')
  const tJob = await getTranslations('job')
  const tMode = await getTranslations('mode')
  const resolved = await getLocale()
  const locale = isLocale(resolved) ? resolved : DEFAULT_LOCALE

  const results = query.length >= MIN_QUERY_LENGTH ? await search(session.actor, query) : null
  const count = results ? totalHits(results) : 0

  /*
    One exact identifier, and the operator is taken straight to the record.

    Someone who pastes a container number off a gate pass is not asking to see
    a list with one row in it — they are asking to open the job. The test is
    deliberately exactness rather than uniqueness: a single *partial* match is
    a coincidence of how little has been typed, and jumping on it would move
    the page out from under someone still typing.
  */
  if (results && count === 1) {
    const exactJob = results.jobs.find((job) => equalsLoosely(job.matchedValue, query))
    const exactContainer = results.containers.find((row) => equalsLoosely(row.containerNo, query))
    const target = exactJob?.id ?? exactContainer?.jobId
    if (target) redirect(`/jobs/${target}`)
    // The same for an enquiry, quote, invoice or consolidation reference (U4).
    const exactRecord = results.records.find((row) =>
      equalsLoosely(row.matchedValue ?? row.reference, query),
    )
    if (exactRecord) redirect(recordHref(exactRecord.kind, exactRecord.id) as Route)
  }

  return (
    <>
      <PageHeader eyebrow={tc('operations')} title={t('title')} description={t('subtitle')} />

      {/*
        The box again, carrying the query.

        A results page that cannot be corrected in place sends the operator
        back to the topbar to retype the whole thing, and the topbar's box is
        hidden below the `sm` breakpoint — so on a phone this is the only one.
      */}
      <form action="/search" className="relative mb-4 max-w-lg">
        <Icon
          name="search"
          size={16}
          className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-ink-subtle"
        />
        <input
          type="search"
          name="q"
          defaultValue={query}
          autoFocus
          placeholder={tc('searchPlaceholder')}
          aria-label={tc('search')}
          className={`h-10 w-full rounded-full border border-line-strong bg-surface-sunken ps-9 pe-3 text-[0.875rem] text-ink placeholder:text-ink-subtle focus:bg-surface ${FOCUS_RING}`}
        />
      </form>

      {results === null ? (
        <Card>
          <EmptyState icon="search" title={t('prompt')} description={t('promptHint')} />
        </Card>
      ) : count === 0 ? (
        <Card>
          <EmptyState icon="search" title={t('empty', { query })} description={t('emptyHint')} />
        </Card>
      ) : (
        <div className="flex flex-col gap-4">
          <p className="text-[0.8125rem] text-ink-subtle">{t('found', { count })}</p>

          {results.jobs.length > 0 ? (
            <Panel padding="none" icon="jobs" title={t('jobs')}>
              <TableShell minWidth="none">
                <THead>
                  <TR>
                    <TH>{tJob('reference')}</TH>
                    <TH>{tJob('customer')}</TH>
                    <TH>{tJob('route')}</TH>
                    <TH>{tJob('status')}</TH>
                    <TH align="end">{tJob('eta')}</TH>
                  </TR>
                </THead>
                <TBody>
                  {results.jobs.map((job) => (
                    <TR key={job.id}>
                      <TD className="whitespace-nowrap">
                        <Link
                          href={`/jobs/${job.id}`}
                          className="ref numeric font-medium text-ink hover:text-accent hover:underline"
                        >
                          {job.reference}
                        </Link>
                        <span className="mt-0.5 flex items-center gap-1 text-[0.6875rem] text-ink-subtle">
                          <Icon name={modeIcon(job.mode)} size={12} />
                          {tMode(job.mode)}
                          {/*
                            Why this row is here, when the term is nowhere in
                            the reference the operator is looking at.
                          */}
                          {job.matchedOn === 'reference' ? null : (
                            <span className="ref numeric">
                              · {t(`fields.${job.matchedOn}` as 'fields.booking')}{' '}
                              {job.matchedValue}
                            </span>
                          )}
                        </span>
                      </TD>
                      <TD className="max-w-52 truncate">
                        {pickName(locale, job.customerName, job.customerNameAr)}
                      </TD>
                      <TD className="text-ink-muted">
                        <Lane
                          origin={pickName(locale, job.originName, job.originNameAr)}
                          destination={pickName(locale, job.destinationName, job.destinationNameAr)}
                        />
                      </TD>
                      <TD>
                        <Badge tone={jobTone(job.status)} dot>
                          {tJob(`statuses.${job.status}` as 'statuses.booked')}
                        </Badge>
                      </TD>
                      <TD align="end" numeric>
                        {formatDay(job.eta, locale, timeZone)}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </TableShell>
            </Panel>
          ) : null}

          {results.records.length > 0 ? (
            /*
              Enquiries, quotes, invoices and consolidations by their own
              references, and consolidations by their master bill (U4).
            */
            <Panel padding="none" icon="document" title={t('records')}>
              <TableShell minWidth="none">
                <THead>
                  <TR>
                    <TH>{tJob('reference')}</TH>
                    <TH>{t('kind')}</TH>
                  </TR>
                </THead>
                <TBody>
                  {results.records.map((row) => (
                    <TR key={`${row.kind}-${row.id}`}>
                      <TD className="whitespace-nowrap">
                        <Link
                          href={recordHref(row.kind, row.id) as Route}
                          className="ref numeric font-medium text-ink hover:text-accent hover:underline"
                        >
                          {row.reference}
                        </Link>
                        {row.matchedValue ? (
                          <span className="ref numeric mt-0.5 block text-[0.6875rem] text-ink-subtle">
                            {t('fields.masterBill')} {row.matchedValue}
                          </span>
                        ) : null}
                      </TD>
                      <TD className="text-ink-muted">
                        {t(`kinds.${row.kind}` as 'kinds.enquiry')}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </TableShell>
            </Panel>
          ) : null}

          {results.containers.length > 0 ? (
            <Panel padding="none" icon="container" title={t('containers')}>
              <TableShell minWidth="none">
                <THead>
                  <TR>
                    <TH>{tc('container')}</TH>
                    <TH>{t('containerType')}</TH>
                    <TH>{tJob('reference')}</TH>
                    <TH>{tJob('status')}</TH>
                  </TR>
                </THead>
                <TBody>
                  {results.containers.map((row) => (
                    <TR key={`${row.jobId}-${row.containerNo}`}>
                      <TD className="ref numeric whitespace-nowrap font-medium">
                        {row.containerNo}
                      </TD>
                      <TD className="text-ink-muted">{row.type}</TD>
                      <TD>
                        <Link
                          href={`/jobs/${row.jobId}`}
                          className="ref numeric font-medium text-ink hover:text-accent hover:underline"
                        >
                          {row.jobReference}
                        </Link>
                      </TD>
                      <TD>
                        <Badge tone={jobTone(row.jobStatus)} dot>
                          {tJob(`statuses.${row.jobStatus}` as 'statuses.booked')}
                        </Badge>
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </TableShell>
            </Panel>
          ) : null}

          {results.customers.length > 0 ? (
            <Panel padding="none" icon="customers" title={t('customers')}>
              <TableShell minWidth="none">
                <THead>
                  <TR>
                    <TH>{tc('customer')}</TH>
                    <TH>{t('code')}</TH>
                    <TH align="end">{t('openJobs')}</TH>
                  </TR>
                </THead>
                <TBody>
                  {results.customers.map((customer) => {
                    const name =
                      locale === 'ar' && customer.legalNameAr
                        ? customer.legalNameAr
                        : customer.legalNameEn
                    return (
                      <TR key={customer.id ?? customer.legalNameEn}>
                        <TD className="font-medium">
                          {/*
                            Unlinked where there is no record behind the name —
                            the pilot dataset carries customers as a column on
                            a job, and a link would open nothing.
                          */}
                          {customer.id ? (
                            <Link
                              href={`/customers/${customer.id}`}
                              className="text-accent hover:underline"
                            >
                              {name}
                            </Link>
                          ) : (
                            name
                          )}
                        </TD>
                        <TD className="ref numeric text-ink-muted">{customer.code ?? '—'}</TD>
                        <TD align="end" numeric>
                          {customer.openJobs}
                        </TD>
                      </TR>
                    )
                  })}
                </TBody>
              </TableShell>
            </Panel>
          ) : null}
        </div>
      )}
    </>
  )
}

/** Spaces and case are how a reference is typed, not what it is. */
function equalsLoosely(value: string, query: string): boolean {
  return value.toUpperCase().replace(/\s+/g, '') === query.toUpperCase().replace(/\s+/g, '')
}
