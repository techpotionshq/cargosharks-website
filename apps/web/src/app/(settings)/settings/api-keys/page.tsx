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
import { Breakable } from '@/ui/breakable'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('apiKeys')
  return { title: t('title') }
}

export default async function ApiKeysPage() {
  const timeZone = await getTimeZone()

  const session = await requireSession()
  assertCan(session, 'admin.api_keys.write')

  const [keys, endpoints, options, t, tc] = await Promise.all([
    getLocale().then((locale) => listApiKeys(locale === 'ar' ? 'ar' : 'en')),
    listWebhookEndpoints(),
    getLocale().then((locale) => loadOptions(session.actor, locale === 'ar' ? 'ar' : 'en')),
    getTranslations('apiKeys'),
    getTranslations('common'),
  ])

  const resolved = await getLocale()
  const locale = isLocale(resolved) ? resolved : DEFAULT_LOCALE

  /*
    Why an endpoint is off, translated here rather than stored as a sentence
    (U1). The row holds a code — `switched_off`, or `no_delivery_since:<day>`
    from the service's dead-endpoint sweep — because a sentence written into
    the database is in whichever language its writer spoke, which was English
    on an Arabic page. A reason written before that change is shown as it was
    stored rather than hidden.
  */
  const disabledReasonText = (reason: string): string => {
    const [code, day] = reason.split(':', 2)
    if (code === 'switched_off') return t('disabledReasons.switchedOff')
    if (code === 'no_delivery_since' && day) {
      return t('disabledReasons.noDeliverySince', {
        day: formatDate(new Date(`${day}T00:00:00Z`), locale, timeZone),
      })
    }
    return reason
  }

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
              {/* A phone keeps the key, whether it is live, and the revoke
                  button — the reason to open this screen in a hurry. Whose
                  data it reads follows the key's name there (below). */}
              <TH priority="low">{t('customer')}</TH>
              <TH priority="low">{t('lastUsed')}</TH>
              <TH priority="low">{t('expires')}</TH>
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
                    <span className="ref text-micro text-ink-subtle">{key.prefix}…</span>
                    <span className="block text-caption text-ink-muted @3xl:hidden">
                      {(locale === 'ar' && key.customerNameAr) || key.customerName || '—'}
                    </span>
                  </TD>
                  <TD priority="low" className="text-ink-muted">
                    {(locale === 'ar' && key.customerNameAr) || key.customerName || '—'}
                  </TD>
                  <TD priority="low" className="whitespace-nowrap text-ink-muted">
                    {key.lastUsedAt ? formatDate(key.lastUsedAt, locale, timeZone) : t('neverUsed')}
                  </TD>
                  <TD priority="low" className="whitespace-nowrap text-ink-muted">
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

      <p className="mt-4 text-caption text-ink-subtle">{t('footnote')}</p>

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
        <h2 className="text-heading font-semibold text-ink">{t('webhooks')}</h2>
        <p className="mt-1 mb-4 text-body-sm text-ink-muted">{t('webhooksHint')}</p>

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
                <TH priority="low">{t('customer')}</TH>
                <TH priority="low">{t('events')}</TH>
                <TH align="end">{t('deliveries')}</TH>
                <TH>{tc('status')}</TH>
                <TH align="end" />
              </TR>
            </THead>
            <TBody>
              {endpoints.map((endpoint) => (
                <TR key={endpoint.id}>
                  {/* Wraps anywhere on a phone: a URL has no spaces, and
                      truncated to a phone's column it is only "https://". */}
                  {/* At its seams on a narrow table; one line with an ellipsis,
                      and the whole address on hover, once there is room. */}
                  <TD className="ref text-ink">
                    <Breakable text={endpoint.url} className="@3xl:hidden" />
                    <span
                      dir="ltr"
                      title={endpoint.url}
                      className="hidden max-w-xs truncate @3xl:block"
                    >
                      {endpoint.url}
                    </span>
                  </TD>
                  <TD priority="low" className="text-ink-muted">
                    {(locale === 'ar' && endpoint.customerNameAr) ||
                      endpoint.customerName ||
                      t('everyCustomer')}
                  </TD>
                  <TD priority="low" className="text-caption text-ink-muted">
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
                          <span className="text-micro text-ink-subtle">
                            {disabledReasonText(endpoint.disabledReason)}
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
