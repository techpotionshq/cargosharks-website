/**
 * Vendor access — the screen that makes a support contract inspectable.
 *
 * The database enforces that support access is granted by the operator,
 * scoped, expiring, revocable and recorded (`0008_support_access.sql`). This
 * page is where the operator exercises all five, and its existence is the
 * difference between a security property and a claim in a sales deck.
 *
 * Two things it deliberately shows that a vendor would rather not surface:
 *
 *   - **Every grant ever issued**, not only the open ones. A revoked grant is
 *     still a record that somebody had access, and hiding closed sessions
 *     would turn the trail into a status display.
 *   - **How many times each grant was actually opened.** A grant nobody used
 *     is evidence nobody looked. A grant with four hundred entries behind a
 *     one-line ticket is a question worth asking, and it is not visible from
 *     the grant row on its own.
 */

import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getLocale, getTranslations } from 'next-intl/server'
import { requireSession } from '@/lib/session'
import { can } from '@/lib/permissions'
import { DEFAULT_LOCALE, isLocale } from '@/i18n/request'
import { formatDateTime, formatRelative } from '@/lib/format'
import { EmptyState, PageHeader } from '@/ui/layout'
import { Badge } from '@/ui/status'
import { TableShell, TBody, TD, TH, THead, TR } from '@/ui/table'
import { getOpenSupportSessions, supportHistory } from '@/features/support/queries'
import { SupportGrantDialog } from '@/features/support/ui/grant-dialog'
import { revokeSupportAccess } from '@/features/support/actions'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('support')
  return { title: t('pageTitle') }
}

export default async function SupportAccessPage() {
  const session = await requireSession()
  /*
    `notFound`, not a forbidden page — the same rule the users screen follows.
    An account that cannot administer access has no business learning that the
    screen exists.
  */
  if (!can(session, 'admin.users.write')) notFound()

  const t = await getTranslations('support')
  const tc = await getTranslations('common')
  const resolved = await getLocale()
  const locale = isLocale(resolved) ? resolved : DEFAULT_LOCALE
  const now = Date.now()

  const [open, history] = await Promise.all([
    getOpenSupportSessions(session.actor),
    supportHistory(session.actor),
  ])

  return (
    <>
      <PageHeader
        eyebrow={t('eyebrow')}
        title={t('pageTitle')}
        description={t('pageDescription')}
        actions={<SupportGrantDialog />}
      />

      {open.length > 0 && (
        <div className="mb-6 rounded-card border border-caution/25 bg-caution-soft p-4">
          <h2 className="mb-3 text-sm font-semibold text-caution">{t('openHeading')}</h2>
          <ul className="flex flex-col gap-2">
            {open.map((grant) => (
              <li
                key={grant.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.8125rem]"
              >
                <Badge tone={grant.scope === 'write' ? 'critical' : 'caution'}>
                  {grant.scope === 'write' ? t('scopeWrite') : t('scopeRead')}
                </Badge>
                <span className="font-medium text-ink">{grant.engineer}</span>
                <span className="text-ink-muted">{grant.reason}</span>
                <span className="text-ink-subtle">
                  {grant.branchCodes.length === 0
                    ? t('scopeAllBranches')
                    : t('scopeBranches', { branches: grant.branchCodes.join(', ') })}
                </span>
                <span className="text-ink-subtle tabular-nums">
                  {t('expires', { time: formatRelative(grant.expiresAt, locale, now) })}
                </span>
                <form action={revokeSupportAccess} className="ms-auto">
                  <input type="hidden" name="grantId" value={grant.id} />
                  <button
                    type="submit"
                    className="rounded-sm px-2.5 py-1 text-[0.8125rem] font-medium text-caution underline-offset-2 hover:underline"
                  >
                    {t('revoke')}
                  </button>
                </form>
              </li>
            ))}
          </ul>
        </div>
      )}

      {history.length === 0 ? (
        <div className="rounded-card border border-line bg-surface">
          <EmptyState icon="audit" title={t('emptyTitle')} description={t('emptyHint')} />
        </div>
      ) : (
        <TableShell>
          <THead>
            <TR>
              <TH>{t('colEngineer')}</TH>
              <TH>{t('colReason')}</TH>
              <TH>{t('colScope')}</TH>
              <TH>{t('colGrantedBy')}</TH>
              <TH>{t('colGranted')}</TH>
              <TH>{t('colState')}</TH>
              <TH align="end">{t('colOpened')}</TH>
            </TR>
          </THead>
          <TBody>
            {history.map((entry) => {
              const expired = entry.expiresAt.getTime() <= now
              const state = entry.revokedAt ? 'revoked' : expired ? 'expired' : 'live'

              return (
                <TR key={entry.id}>
                  <TD>{entry.engineer}</TD>
                  <TD className="text-ink-muted">{entry.reason}</TD>
                  <TD>
                    <Badge tone={entry.scope === 'write' ? 'critical' : 'muted'}>
                      {entry.scope === 'write' ? t('scopeWrite') : t('scopeRead')}
                    </Badge>
                  </TD>
                  <TD className="text-ink-muted">{entry.grantedBy}</TD>
                  <TD className="tabular-nums">{formatDateTime(entry.createdAt, locale)}</TD>
                  <TD>
                    <Badge
                      tone={state === 'live' ? 'caution' : state === 'revoked' ? 'info' : 'muted'}
                    >
                      {t(`state_${state}`)}
                    </Badge>
                  </TD>
                  {/*
                    The count that turns the trail into an audit. Zero is not an
                    absence of data — it is the answer "nobody opened it", and
                    worth reading as such.
                  */}
                  <TD align="end" className="tabular-nums">
                    {entry.accessCount}
                  </TD>
                </TR>
              )
            })}
          </TBody>
        </TableShell>
      )}

      <p className="mt-4 text-[0.8125rem] text-ink-subtle">{tc('auditImmutable')}</p>
    </>
  )
}
