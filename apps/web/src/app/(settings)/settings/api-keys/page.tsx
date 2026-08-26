/**
 * Keys a customer's own systems read this deployment with — FR-AD-05.
 *
 * The SRS calls the read-only REST API a Must and says a customer developer
 * should integrate against the published documentation without our help. Every
 * part of that existed except the first step: `apps/service` authenticated
 * keys on every request, `admin.api_keys.write` sat in the permission matrix,
 * and nothing could issue one.
 *
 * Revoked keys stay on the list. "Was that key live, and when did it stop" is
 * asked during exactly one kind of conversation, and the answer has to survive
 * it (§5.5).
 */

import type { Metadata } from 'next'
import { getLocale, getTimeZone, getTranslations } from 'next-intl/server'
import { requireSession } from '@/lib/session'
import { assertCan } from '@/lib/permissions'
import { listApiKeys, listWebhookEndpoints } from '@/features/admin/api-keys'
import {
  CreateApiKeyForm,
  CreateWebhookForm,
  RevokeApiKeyButton,
  ToggleWebhookButton,
} from '@/features/admin/ui/api-key-dialogs'
import { loadOptions } from '@/lib/options'
import { DEFAULT_LOCALE, isLocale } from '@/i18n/request'
import { formatDate } from '@/lib/format'
import { EmptyState, PageHeader } from '@/ui/layout'
import { Badge } from '@/ui/status'
import { TableShell, TBody, TD, TH, THead, TR } from '@/ui/table'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('apiKeys')
  return { title: t('title') }
}

export default async function ApiKeysPage() {
  const timeZone = await getTimeZone()

  const session = await requireSession()
  assertCan(session, 'admin.api_keys.write')

  const [keys, endpoints, options, t, tc] = await Promise.all([
    listApiKeys(),
    listWebhookEndpoints(),
    loadOptions(session.actor),
    getTranslations('apiKeys'),
    getTranslations('common'),
  ])

  const resolved = await getLocale()
  const locale = isLocale(resolved) ? resolved : DEFAULT_LOCALE

  return (
    <>
      <PageHeader eyebrow={t('eyebrow')} title={t('title')} description={t('subtitle')} />

      <div className="mb-5">
        <CreateApiKeyForm
          customers={options.customers}
          branches={options.branches}
          labels={{
            name: t('name'),
            namePlaceholder: t('namePlaceholder'),
            customer: t('customer'),
            branch: t('branch'),
            expires: t('expires'),
            expiresHint: t('expiresHint'),
            issue: t('issue'),
            choose: tc('choose'),
            onceOnly: t('onceOnly'),
          }}
        />
      </div>

      {keys.length === 0 ? (
        <EmptyState icon="globe" title={t('none')} description={t('noneHint')} />
      ) : (
        <TableShell>
          <THead>
            <TR>
              <TH>{t('key')}</TH>
              <TH>{t('customer')}</TH>
              <TH>{t('lastUsed')}</TH>
              <TH>{t('expires')}</TH>
              <TH>{tc('status')}</TH>
              <TH align="end" />
            </TR>
          </THead>
          <TBody>
            {keys.map((key) => {
              const expired = key.expiresAt !== null && key.expiresAt.getTime() < Date.now()
              return (
                <TR key={key.id}>
                  <TD>
                    <span className="block font-medium text-ink">{key.name}</span>
                    {/* The prefix is stored in clear precisely so a key is
                        identifiable in a list without being usable from one. */}
                    <span className="ref text-[0.6875rem] text-ink-subtle">{key.prefix}…</span>
                  </TD>
                  <TD className="text-ink-muted">{key.customerName ?? '—'}</TD>
                  <TD className="whitespace-nowrap text-ink-muted">
                    {key.lastUsedAt ? formatDate(key.lastUsedAt, locale, timeZone) : t('neverUsed')}
                  </TD>
                  <TD className="whitespace-nowrap text-ink-muted">
                    {key.expiresAt ? formatDate(key.expiresAt, locale, timeZone) : t('noExpiry')}
                  </TD>
                  <TD>
                    {key.revokedAt ? (
                      <Badge tone="muted">{t('revoked')}</Badge>
                    ) : expired ? (
                      <Badge tone="caution">{t('expired')}</Badge>
                    ) : (
                      <Badge tone="positive" dot>
                        {t('live')}
                      </Badge>
                    )}
                  </TD>
                  <TD align="end">
                    {key.revokedAt ? null : (
                      <RevokeApiKeyButton keyId={key.id} label={t('revoke')} />
                    )}
                  </TD>
                </TR>
              )
            })}
          </TBody>
        </TableShell>
      )}

      <p className="mt-4 text-[0.75rem] text-ink-subtle">{t('footnote')}</p>

      {/*
        The other half of integration — FR-AD-06.

        Keys are how a customer's system asks; webhooks are how it is told. The
        two live on one screen because they are one conversation with the same
        person, and because an integrator setting up a key almost always wants
        both.

        The delivery counts are the point of the list. An endpoint that exists
        is not an endpoint that works, and the worker disables one that has
        landed nothing for a week — this is where somebody sees why.
      */}
      <div className="mt-8">
        <h2 className="text-[1.0625rem] font-semibold text-ink">{t('webhooks')}</h2>
        <p className="mt-1 mb-4 text-[0.8125rem] text-ink-muted">{t('webhooksHint')}</p>

        <div className="mb-5">
          <CreateWebhookForm
            customers={options.customers}
            branches={options.branches}
            labels={{
              url: t('url'),
              urlHint: t('urlHint'),
              customer: t('customer'),
              everyCustomer: t('everyCustomer'),
              branch: t('branch'),
              everyBranch: t('everyBranch'),
              events: t('events'),
              eventsHint: t('eventsHint'),
              subscribe: t('subscribe'),
              secretOnce: t('secretOnce'),
            }}
          />
        </div>

        {endpoints.length === 0 ? (
          <EmptyState icon="globe" title={t('noEndpoints')} description={t('noEndpointsHint')} />
        ) : (
          <TableShell>
            <THead>
              <TR>
                <TH>{t('url')}</TH>
                <TH>{t('customer')}</TH>
                <TH>{t('events')}</TH>
                <TH align="end">{t('deliveries')}</TH>
                <TH>{tc('status')}</TH>
                <TH align="end" />
              </TR>
            </THead>
            <TBody>
              {endpoints.map((endpoint) => (
                <TR key={endpoint.id}>
                  <TD className="ref max-w-xs truncate text-ink">{endpoint.url}</TD>
                  <TD className="text-ink-muted">{endpoint.customerName ?? t('everyCustomer')}</TD>
                  <TD className="text-[0.75rem] text-ink-muted">
                    {endpoint.events.length === 0 ? t('allEvents') : endpoint.events.join(', ')}
                  </TD>
                  <TD align="end" numeric className="whitespace-nowrap">
                    {endpoint.failed > 0 ? (
                      <span className="font-semibold text-critical">
                        {t('failedCount', { count: endpoint.failed })}
                      </span>
                    ) : endpoint.lastDeliveredAt ? (
                      <span className="text-ink-muted">
                        {formatDate(endpoint.lastDeliveredAt, locale, timeZone)}
                      </span>
                    ) : (
                      <span className="text-ink-subtle">{t('nothingYet')}</span>
                    )}
                  </TD>
                  <TD>
                    {endpoint.isActive ? (
                      <Badge tone="positive" dot>
                        {t('live')}
                      </Badge>
                    ) : (
                      <span className="flex flex-col gap-0.5">
                        <Badge tone="muted">{t('off')}</Badge>
                        {endpoint.disabledReason ? (
                          <span className="text-[0.6875rem] text-ink-subtle">
                            {endpoint.disabledReason}
                          </span>
                        ) : null}
                      </span>
                    )}
                  </TD>
                  <TD align="end">
                    <ToggleWebhookButton
                      endpointId={endpoint.id}
                      isActive={endpoint.isActive}
                      labels={{ enable: t('enable'), disable: t('disable') }}
                    />
                  </TD>
                </TR>
              ))}
            </TBody>
          </TableShell>
        )}
      </div>
    </>
  )
}
