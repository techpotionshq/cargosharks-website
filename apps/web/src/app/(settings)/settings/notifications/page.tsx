/**
 * What the product says when it writes to somebody — FR-NT-01, FR-NT-03.
 *
 * Thirteen events, two languages, and until this page existed every one of
 * them was wording only a developer could change. The seed's own docstring
 * promised otherwise: *"nothing here is compiled into the application, and
 * that is the whole design: configuration is rows, not classes"* — which was
 * true of the rows and untrue of the product, because nothing rendered them.
 *
 * Grouped by event rather than listed flat. An administrator does not think
 * "show me the twenty-six templates"; they think "what do we say when an
 * invoice goes overdue", and the answer is a pair of languages and whatever
 * branch overrides exist beneath them.
 */

import type { Metadata } from 'next'
import { getLocale, getTranslations } from 'next-intl/server'
import { requireSession } from '@/lib/session'
import { assertCan } from '@/lib/permissions'
import { listDeliveries, listTemplates } from '@/features/admin/notifications'
import { NotificationTemplateDialog } from '@/features/admin/ui/dialogs'
import { loadOptions } from '@/lib/options'
import { DEFAULT_LOCALE, isLocale } from '@/i18n/request'
import { formatDateTime } from '@/lib/format'
import { Card, CardHeader } from '@/ui/card'
import { EmptyState, PageHeader } from '@/ui/layout'
import { Badge } from '@/ui/status'
import { TableShell, TBody, TD, TH, THead, TR } from '@/ui/table'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('notificationTemplates')
  return { title: t('pageTitle') }
}

export default async function NotificationsPage() {
  const session = await requireSession()
  assertCan(session, 'admin.reference.write')

  const [events, deliveries, options, t, tc] = await Promise.all([
    listTemplates(session.actor),
    listDeliveries(session.actor),
    loadOptions(session.actor),
    getTranslations('notificationTemplates'),
    getTranslations('common'),
  ])

  const resolved = await getLocale()
  const locale = isLocale(resolved) ? resolved : DEFAULT_LOCALE

  return (
    <>
      <PageHeader
        eyebrow={t('eyebrow')}
        title={t('pageTitle')}
        description={t('pageSubtitle')}
      />

      <div className="space-y-4">
        {events.map((event) => (
          <Card key={event.key}>
            <CardHeader
              icon="bell"
              eyebrow={event.key}
              title={t(`events.${event.key}` as 'events.job.created')}
              description={event.summary}
              actions={
                <Badge tone={event.audience === 'customer' ? 'info' : 'muted'}>
                  {t(`audiences.${event.audience}` as 'audiences.customer')}
                </Badge>
              }
            />

            {/*
              An event with no template at all is the state that used to send
              `failed: no adapter` to nobody, so it is shown loudly rather than
              omitted from a list driven by the table.
            */}
            {event.templates.length === 0 ? (
              <EmptyState icon="alert" title={t('none')} description={t('noneHint')} />
            ) : (
              <ul className="mt-4 space-y-3">
                {event.templates.map((template) => (
                  <li
                    key={template.id}
                    className="flex flex-wrap items-start justify-between gap-3 border-b border-line pb-3 last:border-0"
                  >
                    <div className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <Badge tone="muted">{template.locale.toUpperCase()}</Badge>
                        {/* A branch row overrides the default beneath it. */}
                        {template.branchCode ? (
                          <Badge tone="brand">{template.branchCode}</Badge>
                        ) : (
                          <span className="text-[0.6875rem] text-ink-subtle">
                            {t('allBranches')}
                          </span>
                        )}
                        {template.isActive ? null : (
                          <Badge tone="muted">{tc('inactive')}</Badge>
                        )}
                      </span>
                      {template.subject ? (
                        <span className="mt-1 block text-[0.875rem] font-medium text-ink">
                          {template.subject}
                        </span>
                      ) : null}
                      <p
                        className="mt-1 line-clamp-2 text-[0.8125rem] whitespace-pre-line text-ink-muted"
                        dir={template.locale === 'ar' ? 'rtl' : 'ltr'}
                      >
                        {template.body}
                      </p>
                    </div>

                    <NotificationTemplateDialog
                      eventKey={event.key}
                      locale={template.locale}
                      mergeFields={event.mergeFields}
                      template={template}
                      branches={options.branches}
                    />
                  </li>
                ))}
              </ul>
            )}

            {/*
              One override button per language, because an override is created
              for a language rather than for an event — Kuwait may reword the
              Arabic and leave the English alone.
            */}
            <div className="mt-4 flex flex-wrap gap-2 border-t border-line pt-3">
              {(['en', 'ar'] as const).map((lang) => (
                <NotificationTemplateDialog
                  key={lang}
                  eventKey={event.key}
                  locale={lang}
                  mergeFields={event.mergeFields}
                  template={{
                    body: event.templates.find(
                      (row) => row.locale === lang && row.branchId === null,
                    )?.body,
                    subject: event.templates.find(
                      (row) => row.locale === lang && row.branchId === null,
                    )?.subject,
                  }}
                  branches={options.branches}
                  variant="secondary"
                />
              ))}
            </div>
          </Card>
        ))}
      </div>

      {/*
        What actually left the building — FR-NT-06.

        `attempts`, `last_error`, `deferred_until` and `suppressed_reason` have
        been written by the dispatcher since it was built and read by nobody.
        The requirement is a delivery log, and a log nothing renders is a
        table.

        Failures sort first whatever their age: a send that failed last week is
        more interesting than one that succeeded this morning, and `suppressed`
        is a *deliberate* outcome — quiet hours and opt-outs — rather than a
        failure, so it reads differently.
      */}
      <Card className="mt-6" padding="none">
        <div className="p-5 pb-3">
          <CardHeader
            icon="bell"
            eyebrow={t('log')}
            title={t('logTitle')}
            description={t('logHint')}
          />
        </div>

        {deliveries.length === 0 ? (
          <EmptyState icon="bell" title={t('noDeliveries')} description={t('noDeliveriesHint')} />
        ) : (
          <TableShell className="border-t border-line">
            <THead>
              <TR>
                <TH>{t('event')}</TH>
                <TH>{t('recipient')}</TH>
                <TH>{t('when')}</TH>
                <TH>{t('outcome')}</TH>
              </TR>
            </THead>
            <TBody>
              {deliveries.map((row) => (
                <TR key={row.id}>
                  <TD className="ref whitespace-nowrap text-ink">{row.eventKey}</TD>
                  <TD className="max-w-xs truncate text-ink-muted">{row.recipient ?? '—'}</TD>
                  <TD className="whitespace-nowrap text-ink-muted">
                    {formatDateTime(row.sentAt ?? row.createdAt, locale)}
                  </TD>
                  <TD>
                    <span className="flex flex-col gap-0.5">
                      <span className="flex items-center gap-2">
                        <Badge
                          tone={
                            row.status === 'failed'
                              ? 'critical'
                              : row.status === 'suppressed'
                                ? 'muted'
                                : row.status === 'queued'
                                  ? 'caution'
                                  : 'positive'
                          }
                        >
                          {t(`deliveryStates.${row.status}` as 'deliveryStates.sent')}
                        </Badge>
                        {row.attempts > 1 ? (
                          <span className="text-[0.6875rem] text-ink-subtle">
                            {t('attempts', { count: row.attempts })}
                          </span>
                        ) : null}
                      </span>
                      {/* The reason, where there is one — that is the whole
                          value of a delivery log. */}
                      {row.lastError ?? row.suppressedReason ? (
                        <span className="text-[0.6875rem] text-ink-subtle">
                          {row.lastError ?? row.suppressedReason}
                        </span>
                      ) : null}
                    </span>
                  </TD>
                </TR>
              ))}
            </TBody>
          </TableShell>
        )}
      </Card>

      <p className="mt-4 text-[0.75rem] text-ink-subtle">{t('footnote', { locale })}</p>
    </>
  )
}
