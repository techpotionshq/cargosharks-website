/**
 * How this deployment reaches the outside world — FR-AD-03, §10.
 *
 * SRS §3 says of the mailboxes that they were *"the single most telling
 * finding"*. This page is the same finding one level up: every integration in
 * the product — the relay that sends the mail, the carrier registrations that
 * feed the board, the provider that will transmit the e-invoices — was an
 * environment variable, and therefore a redeploy, and therefore something that
 * waited for whoever held the deploy keys rather than for the client who held
 * the credential.
 *
 * ## What each card has to answer
 *
 * Three questions, and the third is the one a settings screen usually gets
 * wrong:
 *
 *   1. **Is it on?** The driver, in a badge.
 *   2. **Is it working?** `lastError` and `lastOkAt`, written by the service
 *      when it resolved the integration — because "off" and "on but failing"
 *      look identical from outside, and a carrier key that has stopped working
 *      produces no error anywhere an operator looks. The board just shows
 *      shipments that have not moved.
 *   3. **Which layer is answering?** A row overrides a variable and both are
 *      legitimate, so a screen that shows a value without saying where it came
 *      from cannot answer "I changed it and nothing happened".
 */

import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getLocale, getTranslations } from 'next-intl/server'
import { requireSession } from '@/lib/session'
import { can } from '@/lib/permissions'
import { integrationKeyConfigured, listIntegrations } from '@/features/admin/integrations'
import {
  IntegrationDialog,
  ToggleIntegrationButton,
} from '@/features/admin/ui/integration-dialogs'
import { DEFAULT_LOCALE, isLocale } from '@/i18n/request'
import { formatDateTime } from '@/lib/format'
import { Card, CardHeader } from '@/ui/card'
import { Field, Grid, PageHeader } from '@/ui/layout'
import { Badge } from '@/ui/status'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('integrations')
  return { title: t('title') }
}

export default async function IntegrationsPage() {
  const session = await requireSession()
  /*
    Its own key, and a stricter one than the rest of settings. A row here is
    the credential this deployment reaches its suppliers with, and it is not
    branch-scoped — there is no such thing as changing the SMTP relay for
    Kuwait only, so an operations manager who can add a port must not be able
    to redirect the mail for every office.
  */
  if (!can(session, 'admin.integrations.write')) notFound()

  const [integrations, keyConfigured, t, tc] = await Promise.all([
    listIntegrations(),
    integrationKeyConfigured(),
    getTranslations('integrations'),
    getTranslations('common'),
  ])

  const resolved = await getLocale()
  const locale = isLocale(resolved) ? resolved : DEFAULT_LOCALE

  const failing = integrations.filter((row) => row.lastError).length

  return (
    <>
      <PageHeader eyebrow={t('eyebrow')} title={t('title')} description={t('subtitle')} />

      {keyConfigured ? null : (
        <div className="mb-4">
          <Badge tone="critical">{t('noKeyBanner')}</Badge>
        </div>
      )}

      {failing > 0 ? <p className="mb-4 text-sm text-muted">{t('failingHint')}</p> : null}

      <div className="space-y-4">
        {integrations.map((integration) => {
          const name = t(`keys.${integration.key}` as 'keys.smtp')

          return (
            <Card key={integration.key}>
              <CardHeader
                icon="admin"
                eyebrow={integration.key}
                title={name}
                description={t(`descriptions.${integration.key}` as 'descriptions.smtp')}
                actions={
                  <div className="flex flex-wrap items-center gap-2">
                    {integration.driver ? (
                      <Badge tone={integration.live ? 'brand' : 'muted'}>
                        {t(
                          `drivers.${integration.key}.${integration.driver}` as 'drivers.smtp.smtp',
                        )}
                      </Badge>
                    ) : null}

                    {!integration.isActive ? (
                      <Badge tone="muted">{tc('inactive')}</Badge>
                    ) : integration.lastError ? (
                      <Badge tone="critical">{t('erroring')}</Badge>
                    ) : integration.missing.length > 0 ? (
                      <Badge tone="caution">{t('incomplete')}</Badge>
                    ) : integration.hasRow ? (
                      <Badge tone="positive">{tc('active')}</Badge>
                    ) : (
                      /*
                        "No row" is a real and common state, not an error. It
                        is every deployment before its first save, and it is
                        the correct state for an integration nobody has bought.
                      */
                      <Badge tone="muted">{t('fromEnvironment')}</Badge>
                    )}

                    <IntegrationDialog
                      integration={integration}
                      keyConfigured={keyConfigured}
                      variant="ghost"
                      iconOnly
                    />

                    {integration.hasRow ? (
                      <ToggleIntegrationButton
                        integrationKey={integration.key}
                        isActive={integration.isActive}
                      />
                    ) : null}
                  </div>
                }
              />

              <Grid>
                {integration.fields.map((field) => (
                  <Field
                    key={field.name}
                    label={t(`fields.${integration.key}.${field.name}` as 'fields.smtp.host')}
                  >
                    <span className="flex flex-wrap items-baseline gap-2">
                      <span className={field.value ? 'numeric' : 'text-muted'}>
                        {field.value ?? '—'}
                      </span>
                      {/*
                        Which layer answered, per field rather than per card.
                        A deployment mid-migration legitimately holds some of
                        an integration in each place, and the card-level answer
                        would be a lie about half of it.
                      */}
                      {field.source === 'env' ? (
                        <Badge tone="muted">{t('sourceEnv')}</Badge>
                      ) : field.source === 'row' ? (
                        <Badge tone="info">{t('sourceRow')}</Badge>
                      ) : null}
                    </span>
                  </Field>
                ))}

                {integration.secrets.map((secret) => (
                  <Field
                    key={secret.name}
                    label={t(`secrets.${integration.key}.${secret.name}` as 'secrets.smtp.password')}
                  >
                    {/* Whether it is set, never what it is. */}
                    <Badge tone={secret.isSet ? 'positive' : 'muted'}>
                      {secret.isSet ? t('secretSet') : t('secretUnset')}
                    </Badge>
                  </Field>
                ))}

                {/*
                  The carrier poll's arithmetic, shown rather than left to be
                  done by hand. `batch × runs-per-hour` is what has to stay
                  under the carrier's cap, and the cap differs per contract —
                  so this shows the number a person compares, and says when it
                  cannot work the number out rather than inventing one.
                */}
                {integration.callsPerHour !== null ? (
                  <Field label={t('callsPerHour')}>
                    <span className="numeric">{integration.callsPerHour}</span>
                  </Field>
                ) : integration.key === 'carrierPoll' ? (
                  <Field label={t('callsPerHour')}>
                    <span className="text-muted">{t('callsUnknown')}</span>
                  </Field>
                ) : null}

                {integration.lastOkAt ? (
                  <Field label={t('lastOk')}>
                    {formatDateTime(integration.lastOkAt, locale)}
                  </Field>
                ) : null}
              </Grid>

              {integration.missing.length > 0 && !integration.lastError ? (
                <p className="mt-3 text-sm text-muted">
                  {t('missingHint', { fields: integration.missing.join(', ') })}
                </p>
              ) : null}

              {integration.lastError ? (
                /*
                  The reason, not a generic "failed".

                  "Authentication failed" and "certificate expired" have
                  different fixes and different owners, and an administrator
                  who must open a service log to tell them apart opens a
                  support ticket instead. The text comes from the provider, so
                  it is rendered as data — never as markup.
                */
                <p className="mt-3 text-sm text-critical">{integration.lastError}</p>
              ) : null}
            </Card>
          )
        })}
      </div>
    </>
  )
}
