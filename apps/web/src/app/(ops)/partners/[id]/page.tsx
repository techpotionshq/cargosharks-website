/**
 * The partner file.
 *
 * Linked from the register, which pointed at a route that did not exist.
 *
 * The page leads with the two numbers that decide whether a relationship is
 * working — how much you are giving them, and how often something goes wrong
 * on it. Neither is visible from the register, and both are the reason anybody
 * opens a partner in the first place.
 *
 * The exception count is deliberately not framed as fault. A carrier on the
 * Shanghai lane in a bad month carries the delays of that lane, not their own
 * incompetence. It is a prompt for a conversation, and the wording says so.
 */

import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getLocale, getTimeZone, getTranslations } from 'next-intl/server'
import { requireSession } from '@/lib/session'
import { pickName } from '@/lib/named'
import { recordId } from '@/lib/ids'
import { getPartnerDetail, listPartnerCredentials } from '@/features/network/queries'
import {
  PartnerComplianceDialog,
  PartnerContactDialog,
  PartnerCoverageDialog,
  PartnerDialog,
} from '@/features/network/ui/dialogs'
import { getPartnerAccount } from '@/features/payables/queries'
import { PartnerAccountCard } from '@/features/payables/ui/panels'
import { PartnerMailPanel } from '@/features/network/ui/partner-mail-panel'
import { PartnerAccountDialog, PartnerToleranceDialog } from '@/features/payables/ui/dialogs'
import { DEFAULT_LOCALE, isLocale } from '@/i18n/request'
import { formatDate, formatNumber } from '@/lib/format'
import { Icon } from '@/ui/icon'
import { EmptyState, Field, Grid, PageHeader } from '@/ui/layout'
import { Metric } from '@/ui/metric'
import { Panel } from '@/ui/panel'
import { Badge, jobTone } from '@/ui/status'
import { TableShell, TBody, TD, TH, THead, TR } from '@/ui/table'
import { MoreMenu } from '@/ui/menu'
import { Breakable } from '@/ui/breakable'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>
}): Promise<Metadata> {
  const session = await requireSession()
  const id = recordId((await params).id)
  const resolved = await getLocale()
  const locale = isLocale(resolved) ? resolved : DEFAULT_LOCALE
  const partner = await getPartnerDetail(session.actor, id, locale)
  if (!partner) return { title: (await getTranslations('nav'))('partners') }
  // The tab says what the heading says; partners carry no Arabic name yet, so
  // this is English until one is entered.
  return {
    title: locale === 'ar' && partner.legalNameAr ? partner.legalNameAr : partner.legalNameEn,
  }
}

export default async function PartnerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const timeZone = await getTimeZone()

  const session = await requireSession()
  const id = recordId((await params).id)
  const resolved = await getLocale()
  const locale = isLocale(resolved) ? resolved : DEFAULT_LOCALE
  const partner = await getPartnerDetail(session.actor, id, locale)
  if (!partner) notFound()

  const account = await getPartnerAccount(session.actor, id, undefined, locale)
  const credentials = await listPartnerCredentials(session.actor, id, locale)

  /** Live certificates, as options for a renewal to point back at. */
  const renewable = credentials.compliance
    .filter((row) => row.supersededById === null)
    .map((row) => ({
      value: row.id,
      label: `${row.documentType}${row.reference ? ` · ${row.reference}` : ''}`,
    }))

  const t = await getTranslations('partnerDetail')
  const tc = await getTranslations('common')
  const tp = await getTranslations('partners')
  const tf = await getTranslations('partnerForm')
  const tJob = await getTranslations('job')
  const tMode = await getTranslations('mode')

  const displayName =
    locale === 'ar' && partner.legalNameAr ? partner.legalNameAr : partner.legalNameEn

  return (
    <>
      <PageHeader
        eyebrow={
          <span className="inline-flex items-center gap-2">
            <Link href="/partners" className="hover:text-ink">
              {tp('title')}
            </Link>
            <Icon name="chevron-end" size={12} />
            <span className="ref">{partner.code}</span>
          </span>
        }
        title={displayName}
        description={tf(`types.${partner.type}` as 'types.carrier')}
        status={
          <Badge tone={partner.isActive ? 'positive' : 'muted'} dot>
            {partner.isActive ? tc('active') : tc('inactive')}
          </Badge>
        }
        actions={
          <>
            <PartnerDialog
              variant="secondary"
              defaults={{
                id: partner.id,
                code: partner.code,
                type: partner.type,
                legalNameEn: partner.legalNameEn,
                legalNameAr: partner.legalNameAr,
                countryCode: partner.countryCode,
                currency: partner.currency,
                paymentTermsDays: partner.paymentTermsDays,
                scac: partner.scac,
                isActive: partner.isActive,
              }}
            />
            {/*
              Two pieces of configuration that live on the partner and change
              what the payables screens do (0014): how far their bills may
              drift before somebody has to look, and which customer record
              they invoice us as — without which no set-off can be run.
            */}
            <MoreMenu label={tc('more')}>
              <PartnerToleranceDialog
                partnerId={partner.id}
                defaults={{
                  percent: partner.varianceTolerancePercent,
                  absolute: partner.varianceToleranceAbsolute,
                }}
              />
              <PartnerAccountDialog
                partnerId={partner.id}
                defaults={{
                  settlementCustomerId: partner.settlementCustomerId,
                  settlementCurrency: partner.settlementCurrency,
                }}
              />
            </MoreMenu>
          </>
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-4 @3xl:grid-cols-4">
        <Metric
          label={t('openJobs')}
          value={formatNumber(partner.openJobs, locale)}
          icon="jobs"
          tone="brand"
          hint={t('openJobsHint')}
        />
        <Metric
          label={t('totalJobs')}
          value={formatNumber(partner.totalJobs, locale)}
          icon="audit"
          hint={t('totalJobsHint')}
        />
        <Metric
          label={t('openExceptions')}
          value={formatNumber(partner.openExceptions, locale)}
          icon="alert"
          tone={partner.openExceptions > 0 ? 'caution' : 'positive'}
          hint={t('openExceptionsHint')}
          href="/exceptions"
        />
        <Metric
          label={t('terms')}
          value={
            partner.paymentTermsDays === null
              ? '—'
              : tp('days', { count: partner.paymentTermsDays })
          }
          icon="finance"
          hint={t('termsHint')}
        />
      </div>

      <Grid>
        <Panel
          className="@4xl:col-span-8"
          padding="none"
          icon="ship"
          title={t('shipments')}
          explain={t('shipmentsExplain')}
          footerHref="/jobs"
          footerLabel={tJob('title')}
        >
          {partner.jobs.length === 0 ? (
            <EmptyState icon="ship" title={t('noJobs')} description={t('noJobsHint')} />
          ) : (
            <TableShell>
              <THead>
                <TR>
                  <TH>{t('reference')}</TH>
                  {/* Reference, status and arrival on a phone. */}
                  <TH priority="low">{t('customer')}</TH>
                  <TH priority="low">{t('role')}</TH>
                  <TH>{tc('status')}</TH>
                  <TH>{t('eta')}</TH>
                </TR>
              </THead>
              <TBody>
                {partner.jobs.map((job) => (
                  <TR key={`${job.id}-${job.role}`}>
                    <TD>
                      <Link
                        href={`/jobs/${job.id}`}
                        className="ref numeric font-medium text-ink hover:text-accent hover:underline"
                      >
                        {job.reference}
                      </Link>
                      {job.lane ? (
                        <span className="block text-caption text-ink-subtle">{job.lane}</span>
                      ) : null}
                    </TD>
                    <TD priority="low" className="text-ink-muted">
                      {job.customerName ?? '—'}
                    </TD>
                    <TD priority="low" className="text-ink-muted">
                      {t(`roles.${job.role}` as 'roles.carrier')}
                    </TD>
                    <TD>
                      <Badge tone={jobTone(job.status)} dot>
                        {tJob(`statuses.${job.status}` as 'statuses.booked')}
                      </Badge>
                    </TD>
                    <TD className="whitespace-nowrap text-ink-muted">
                      {job.eta ? formatDate(job.eta, locale, timeZone) : '—'}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </TableShell>
          )}
        </Panel>

        <div className="flex flex-col gap-4 @4xl:col-span-4">
          <Panel icon="partners" title={t('about')}>
            <dl className="grid grid-cols-2 gap-4">
              <Field label={tf('code')} mono>
                {partner.code}
              </Field>
              <Field label={tf('type')}>{tf(`types.${partner.type}` as 'types.carrier')}</Field>
              <Field label={tf('country')}>{partner.countryCode ?? '—'}</Field>
              <Field label={tf('currency')}>{partner.currency ?? '—'}</Field>
              <Field label={tf('legalNameAr')} className="col-span-2">
                {partner.legalNameAr ?? '—'}
              </Field>
            </dl>
          </Panel>

          <Panel
            padding="none"
            icon="users"
            title={t('contacts')}
            explain={t('contactsExplain')}
            actions={<PartnerContactDialog partnerId={id} />}
          >
            {partner.contacts.length === 0 ? (
              <EmptyState icon="users" title={t('noContacts')} description={t('noContactsHint')} />
            ) : (
              <ul className="divide-y divide-line">
                {partner.contacts.map((contact) => (
                  <li key={contact.id} className="px-5 py-3">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-body font-medium text-ink">
                        {pickName(locale, contact.nameEn, contact.nameAr)}
                      </p>
                      <PartnerContactDialog partnerId={id} defaults={contact} />
                    </div>
                    {contact.role ? (
                      <p className="text-caption text-ink-subtle">{contact.role}</p>
                    ) : null}
                    <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-caption text-ink-muted">
                      {contact.email ? (
                        <a href={`mailto:${contact.email}`} className="hover:text-accent">
                          <Breakable text={contact.email} />
                        </a>
                      ) : null}
                      {contact.phone ? (
                        <a
                          href={`tel:${contact.phone}`}
                          dir="ltr"
                          className="numeric hover:text-accent"
                        >
                          {contact.phone}
                        </a>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>

        {/*
          Where they go, and what they hold.

          Two tables that existed from Release One and were read by nothing:
          coverage is what RFQ routing is meant to consult (FR-RT-10), and
          compliance is what the nightly expiry warning sweeps (FR-MD-05) —
          which would have swept an empty table, because nothing could put a
          certificate in it.
        */}
        <Panel
          className="@4xl:col-span-6"
          padding="none"
          icon="globe"
          title={t('coverage')}
          explain={t('coverageExplain')}
          actions={<PartnerCoverageDialog partnerId={id} />}
        >
          {credentials.coverage.length === 0 ? (
            <EmptyState icon="globe" title={t('noCoverage')} description={t('noCoverageHint')} />
          ) : (
            <TableShell>
              <THead>
                <TR>
                  <TH>{t('mode')}</TH>
                  <TH>{t('lane')}</TH>
                  <TH align="end">{t('transit')}</TH>
                </TR>
              </THead>
              <TBody>
                {credentials.coverage.map((row) => (
                  <TR key={row.id}>
                    <TD>
                      <Badge tone={row.isActive ? 'info' : 'muted'}>
                        {/* The translated mode, as every other screen shows it;
                            the raw enum is a fallback for a value with no label. */}
                        {tMode.has(row.mode as 'air') ? tMode(row.mode as 'air') : row.mode}
                      </Badge>
                    </TD>
                    <TD className="text-ink">{row.lane}</TD>
                    <TD align="end" numeric className="text-ink-muted">
                      {row.transitDays === null ? '—' : t('days', { days: row.transitDays })}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </TableShell>
          )}
        </Panel>

        <Panel
          className="@4xl:col-span-6"
          padding="none"
          icon="document"
          title={t('compliance')}
          explain={t('complianceExplain')}
          actions={<PartnerComplianceDialog partnerId={id} supersedes={renewable} />}
        >
          {credentials.compliance.length === 0 ? (
            <EmptyState
              icon="document"
              title={t('noCompliance')}
              description={t('noComplianceHint')}
            />
          ) : (
            <TableShell>
              <THead>
                <TR>
                  <TH>{t('document')}</TH>
                  <TH>{t('reference')}</TH>
                  <TH align="end">{t('expires')}</TH>
                </TR>
              </THead>
              <TBody>
                {credentials.compliance.map((row) => {
                  // Superseded rows stay — the certificate current on the day
                  // a shipment moved is the one anybody ever asks about.
                  const superseded = row.supersededById !== null
                  const lapsed = row.daysRemaining !== null && row.daysRemaining < 0
                  return (
                    <TR key={row.id}>
                      <TD className={superseded ? 'text-ink-subtle' : 'text-ink'}>
                        {row.documentType}
                        {superseded ? (
                          <Badge tone="muted" className="ms-2">
                            {t('renewed')}
                          </Badge>
                        ) : null}
                      </TD>
                      <TD className="ref text-ink-muted">{row.reference ?? '—'}</TD>
                      <TD align="end" className="whitespace-nowrap">
                        {row.expiresOn === null ? (
                          <span className="text-ink-subtle">—</span>
                        ) : superseded ? (
                          <span className="text-ink-subtle">
                            {formatDate(new Date(row.expiresOn), locale, timeZone)}
                          </span>
                        ) : (
                          <Badge
                            tone={
                              lapsed ? 'critical' : row.daysRemaining! <= 60 ? 'caution' : 'muted'
                            }
                          >
                            {formatDate(new Date(row.expiresOn), locale, timeZone)}
                          </Badge>
                        )}
                      </TD>
                    </TR>
                  )
                })}
              </TBody>
            </TableShell>
          )}
        </Panel>

        {/*
          The current account, both directions (0014).

          Its own card at full width rather than a figure in the header,
          because it is a ledger rather than a statistic: the balance means
          nothing without the documents that make it up, and a partner nobody
          runs an account with says so instead of showing a zero.
        */}
        {account ? <PartnerAccountCard account={account} className="@4xl:col-span-12" /> : null}

        {/*
          This supplier's mail that the intake filed on no record — not a
          customer enquiry, and not a bill it could read — waiting for a person.
        */}
        <PartnerMailPanel partnerId={id} className="@4xl:col-span-12" />
      </Grid>
    </>
  )
}
