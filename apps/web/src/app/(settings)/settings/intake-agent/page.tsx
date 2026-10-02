/**
 * The intake agent, per branch — FR-EQ-02, FR-AD-03.
 *
 * The WhatsApp numbers and mailboxes screens decide which doors feed a
 * branch's board; this one decides how the agent behind those doors talks to
 * the customers who come through them: whether it answers at all, how long it
 * waits for a customer to finish typing, how often it may ask, when it hands
 * an enquiry to a person, and what a complete enquiry must state.
 *
 * One row per branch the administrator administers. A branch with no row of
 * its own shows the defaults it inherits, and its first save gives it its own.
 */

import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getLocale, getTranslations } from 'next-intl/server'
import { requireSession } from '@/lib/session'
import { can } from '@/lib/permissions'
import { listIntakeSettings } from '@/features/admin/intake-settings'
import { IntakeSettingsDialog } from '@/features/admin/ui/intake-settings-dialog'
import { DEFAULT_LOCALE, isLocale } from '@/i18n/request'
import { Register } from '@/ui/register'
import { Badge } from '@/ui/status'
import { TableShell, TBody, TD, TH, THead, TR } from '@/ui/table'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('intakeSettings')
  return { title: t('title') }
}

export default async function IntakeAgentSettingsPage() {
  const session = await requireSession()
  // The authority that decides which doors feed a branch decides how its agent answers.
  if (!can(session, 'admin.mailboxes.write')) notFound()

  const [rows, t, tc, tAgent, tMode, resolved] = await Promise.all([
    listIntakeSettings(),
    getTranslations('intakeSettings'),
    getTranslations('common'),
    getTranslations('intakeAgent'),
    getTranslations('mode'),
    getLocale(),
  ])
  const locale = isLocale(resolved) ? resolved : DEFAULT_LOCALE
  const on = rows.filter((row) => row.enabled).length
  const separator = locale === 'ar' ? '، ' : ', '

  return (
    <Register
      eyebrow={t('eyebrow')}
      title={t('title')}
      description={t('subtitle')}
      summary={[
        { label: t('branches'), value: rows.length },
        { label: t('agentOn'), value: on },
      ]}
      isEmpty={rows.length === 0}
      empty={{ icon: 'assistant', title: t('noneYet'), description: t('noneYetHint') }}
    >
      <TableShell>
        <THead>
          <TR>
            <TH>{t('branch')}</TH>
            <TH>{tc('status')}</TH>
            <TH priority="low">{t('quietWindow')}</TH>
            <TH priority="low">{t('patience')}</TH>
            <TH priority="low">{t('required')}</TH>
            <TH align="end">{tc('actions')}</TH>
          </TR>
        </THead>
        <TBody>
          {rows.map((row) => (
            <TR key={row.branchId}>
              <TD>
                {row.branchCode}
                {row.inherited ? (
                  <span className="block text-caption text-ink-muted">{t('inherited')}</span>
                ) : null}
              </TD>
              <TD>
                <Badge tone={row.enabled ? 'positive' : 'muted'}>
                  {row.enabled ? t('agentOn') : t('agentOff')}
                </Badge>
              </TD>
              <TD priority="low">
                <span className="numeric">
                  {t('windowSummary', {
                    whatsapp: row.whatsappQuietSeconds,
                    email: row.emailQuietSeconds,
                  })}
                </span>
              </TD>
              <TD priority="low">
                {t('patienceSummary', {
                  cap: row.clarifyCap,
                  cooldown: row.clarifyCooldownHours,
                  takeover: row.humanTakeoverHours,
                })}
              </TD>
              <TD priority="low">
                <span className="text-body-sm text-ink-muted">
                  {row.requirements
                    .map(
                      (r) =>
                        (r.mode ? `${tMode(r.mode as 'sea_fcl')}: ` : '') +
                        tAgent(`requirements.${r.key}` as 'requirements.mode'),
                    )
                    .join(separator)}
                </span>
              </TD>
              <TD align="end">
                <IntakeSettingsDialog row={row} />
              </TD>
            </TR>
          ))}
        </TBody>
      </TableShell>
    </Register>
  )
}
