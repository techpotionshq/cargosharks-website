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
import { getLocale, getTimeZone, getTranslations } from 'next-intl/server'
import { INTEGRATION_GROUPS } from '@qabandi/core'
import { requireSession } from '@/lib/session'
import { can } from '@/lib/permissions'
import { integrationKeyProblem, listIntegrations } from '@/features/admin/integrations'
import { SECRET_KEY_COMMAND } from '@qabandi/db'
import { IntegrationDialog, ToggleIntegrationButton } from '@/features/admin/ui/integration-dialogs'
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
  const timeZone = await getTimeZone()

  const session = await requireSession()
  /*
    Its own key, and a stricter one than the rest of settings. A row here is
    the credential this deployment reaches its suppliers with, and it is not
    branch-scoped — there is no such thing as changing the SMTP relay for
    Kuwait only, so an operations manager who can add a port must not be able
    to redirect the mail for every office.
  */
  if (!can(session, 'admin.integrations.write')) notFound()

  const [integrations, keyProblem, t, tc, tv] = await Promise.all([
    listIntegrations(),
    integrationKeyProblem(),
    getTranslations('integrations'),
    getTranslations('common'),
    getTranslations('adminValidation'),
  ])

  const resolved = await getLocale()
  const locale = isLocale(resolved) ? resolved : DEFAULT_LOCALE

  const failing = integrations.filter((row) => row.lastError).length

  // The reason in the reader's language, for the banner and for each dialog.
  const keyProblemText = keyProblem
    ? keyProblem.reason === 'missing'
      ? tv('keyMissing')
      : tv('keyWrongLength', { bytes: keyProblem.bytes, expected: keyProblem.expected })
    : null

  return (
    <>
      <PageHeader eyebrow={t('eyebrow')} title={t('title')} description={t('subtitle')} />

      {/*
        The reason, not "unconfigured".

        A key that is *set but the wrong shape* — a passphrase where 32 base64
        bytes belong, which is the common way in — used to be reported as "not
        set on this deployment". That sends somebody to check whether a
        variable exists when it plainly does. The message from `secrets.ts`
        carries the byte count and the command that generates a valid key.
      */}
      {keyProblem ? (
        /*
          The reason from the catalogue and the command on a line of its own
          (U1, U2). This printed `secrets.ts`'s English message whole, command
          included, so the Arabic page carried a paragraph of English and the
          one long unbreakable line pushed the page 63px past a phone's width.
          The command scrolls inside its own box; the page does not.
        */
        <div className="mb-5 min-w-0 rounded-sm border border-critical/30 bg-critical-soft p-3">
          <p className="text-body-sm font-medium text-ink">{t('noKeyBanner')}</p>
          <p className="mt-1 text-body-sm text-ink-muted">{keyProblemText}</p>
          <p className="mt-2 text-caption text-ink-muted">{t('keyCommand')}</p>
          <pre
            dir="ltr"
            className="ref mt-1 max-w-full overflow-x-auto rounded-sm bg-surface p-2 text-caption text-ink"
          >
            {SECRET_KEY_COMMAND}
          </pre>
        </div>
      ) : null}

      {failing > 0 ? <p className="mb-4 text-body text-muted">{t('failingHint')}</p> : null}

      <div className="space-y-8">
        {INTEGRATION_GROUPS.map((group) => {
          const inGroup = integrations.filter((row) => row.group === group)
          if (inGroup.length === 0) return null

          return (
            <section key={group}>
              {/*
                A heading per group rather than twelve cards in a column.

                The grouping is not decoration: these are owned by different
                people. Storage and mail are the platform's, the carriers are
                operations', money is finance's, and the model is a spend
                somebody signs off — so an administrator looking for one of
                them is looking inside one of four short lists rather than
                scanning all twelve.
              */}
              <h2 className="mb-1 text-body-sm font-semibold tracking-wide text-ink uppercase">
                {t(`groups.${group}` as 'groups.platform')}
              </h2>
              <p className="mb-3 text-body-sm text-ink-muted">
                {t(`groupHints.${group}` as 'groupHints.platform')}
              </p>

              <div className="space-y-4">
                {inGroup.map((integration) => {
                  const name = t(`keys.${integration.key}` as 'keys.smtp')

                  /*
                    One status badge, never two.

                    The driver used to sit beside the status as a second pill of
                    the same weight, so "Typed by hand" and "From the
                    environment" read as one undifferentiated row of chips and
                    neither answered the question the screen exists for. The
                    driver is a *setting* — it belongs in the body with the
                    other settings — and the header carries the single thing
                    somebody scanning a column of twelve cards wants: is this
                    working.
                  */
                  const status = !integration.isActive
                    ? { tone: 'muted' as const, label: t('notInUse') }
                    : integration.lastError
                      ? { tone: 'critical' as const, label: t('erroring') }
                      : integration.missing.length > 0
                        ? { tone: 'caution' as const, label: t('incomplete') }
                        : !integration.live
                          ? { tone: 'muted' as const, label: t('off') }
                          : integration.hasRow
                            ? { tone: 'positive' as const, label: tc('active') }
                            : { tone: 'info' as const, label: t('fromEnvironment') }

                  const driverLabel = integration.driver
                    ? t(`drivers.${integration.key}.${integration.driver}` as 'drivers.smtp.smtp')
                    : null

                  return (
                    <Card key={integration.key}>
                      <CardHeader
                        icon="admin"
                        title={name}
                        description={t(`descriptions.${integration.key}` as 'descriptions.smtp')}
                        actions={
                          <div className="flex max-w-full shrink-0 flex-wrap items-center gap-2">
                            <Badge tone={status.tone}>{status.label}</Badge>
                            <IntegrationDialog
                              integration={integration}
                              keyProblem={keyProblemText}
                              variant="secondary"
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

                      {/*
                        The body is indented to the header's text, not to the
                        card. `CardHeader` offsets its content by the icon, so a
                        grid starting at the card's own padding sits to the left
                        of the title it belongs to — which is what made the
                        fields look like they had escaped the card.
                      */}
                      <div className="mt-4 ms-11">
                        {integration.live ? (
                          <Grid className="gap-y-3">
                            {driverLabel ? (
                              <Field label={t('driver')} className="lg:col-span-3">
                                {driverLabel}
                              </Field>
                            ) : null}

                            {integration.fields.map((field) => (
                              <Field
                                key={field.name}
                                label={t(
                                  `fields.${integration.key}.${field.name}` as 'fields.smtp.host',
                                )}
                                className="lg:col-span-3"
                              >
                                <span className="flex flex-wrap items-baseline gap-1.5">
                                  <span className={field.value ? '' : 'text-muted'}>
                                    {field.value ?? '—'}
                                  </span>
                                  {/*
                                    Which layer answered, per field rather than
                                    per card: a deployment mid-migration
                                    legitimately holds half of an integration in
                                    each place, and one badge for the card would
                                    be a lie about the other half.

                                    Only the environment is marked. A saved
                                    value is the expected case on this screen,
                                    and a badge on every row is a badge nobody
                                    reads.
                                  */}
                                  {field.source === 'env' ? (
                                    <span className="text-micro text-ink-subtle">
                                      {t('sourceEnv')}
                                    </span>
                                  ) : null}
                                </span>
                              </Field>
                            ))}

                            {integration.secrets.map((secret) => (
                              <Field
                                key={secret.name}
                                label={t(
                                  `secrets.${integration.key}.${secret.name}` as 'secrets.smtp.password',
                                )}
                                className="lg:col-span-3"
                              >
                                {/* Whether it is set, never what it is. */}
                                <Badge tone={secret.isSet ? 'positive' : 'muted'}>
                                  {secret.isSet ? t('secretSet') : t('secretUnset')}
                                </Badge>
                              </Field>
                            ))}

                            {integration.callsPerHour !== null ? (
                              <Field label={t('callsPerHour')} className="lg:col-span-3">
                                <span className="numeric">{integration.callsPerHour}</span>
                              </Field>
                            ) : integration.key === 'carrierPoll' ? (
                              <Field label={t('callsPerHour')} className="lg:col-span-3">
                                <span className="text-muted">{t('callsUnknown')}</span>
                              </Field>
                            ) : null}

                            {integration.lastOkAt ? (
                              <Field label={t('lastOk')} className="lg:col-span-3">
                                {formatDateTime(integration.lastOkAt, locale, timeZone)}
                              </Field>
                            ) : null}
                          </Grid>
                        ) : (
                          /*
                            An integration that is off says one line, not a grid
                            of dashes.

                            Most cards are off on a fresh deployment, and
                            rendering "FEED URL —" beside "API KEY Not set" for
                            each of them fills the screen with the absence of
                            things nobody has bought. The mode is the only fact
                            worth showing, and it is the fact that explains the
                            emptiness.
                          */
                          <p className="text-body-sm text-ink-muted">
                            {driverLabel
                              ? t('offHint', { driver: driverLabel })
                              : t('offHintPlain')}
                          </p>
                        )}

                        {integration.missing.length > 0 && !integration.lastError ? (
                          <p className="mt-3 text-body-sm text-ink-muted">
                            {t('missingHint', { fields: integration.missing.join(', ') })}
                          </p>
                        ) : null}

                        {integration.lastError ? (
                          /*
                            The reason, not a generic "failed". "Authentication
                            failed" and "certificate expired" have different
                            fixes and different owners, and an administrator who
                            must open a service log to tell them apart opens a
                            support ticket instead. The text is the provider's,
                            so it is rendered as data — never as markup.
                          */
                          <p className="mt-3 text-body-sm text-critical">{integration.lastError}</p>
                        ) : null}
                      </div>
                    </Card>
                  )
                })}
              </div>
            </section>
          )
        })}
      </div>
    </>
  )
}
