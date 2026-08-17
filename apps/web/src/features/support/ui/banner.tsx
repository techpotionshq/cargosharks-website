import { getTranslations } from 'next-intl/server'
import { Icon } from '@/ui/icon'
import { can } from '@/lib/permissions'
import type { Session } from '@/lib/session'
import { getOpenSupportSessions } from '../queries'
import { revokeSupportAccess } from '../actions'

/**
 * "Support has access to your data right now."
 *
 * Rendered in the operations layout, so it is on screen wherever the operator
 * happens to be working rather than on a page they would have to think to
 * visit. That placement is the feature: `0008` makes vendor access granted,
 * scoped and expiring, and this is what turns those properties into something
 * the customer experiences rather than something they would have to audit for.
 *
 * `caution`, not `critical`. An open support session is a normal part of being
 * supported — it is happening because someone asked us for help. Colouring it
 * as an incident would train people to dismiss it, and the one that matters is
 * the session nobody remembers authorising.
 */
export async function SupportAccessBanner({ session }: { session: Session }) {
  const open = await getOpenSupportSessions(session.actor)
  if (open.length === 0) return null

  const t = await getTranslations('support')
  const mayRevoke = can(session, 'admin.users.write')

  return (
    <div className="border-b border-caution/25 bg-caution-soft">
      {open.map((grant) => (
        <div
          key={grant.id}
          className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-2.5 text-[0.8125rem] text-caution"
        >
          <Icon name="audit" size={15} className="shrink-0" />

          <span className="font-medium">
            {grant.scope === 'write' ? t('bannerWrite') : t('bannerRead')}
          </span>

          <span className="text-ink-muted">
            {grant.engineer} · {grant.reason}
          </span>

          <span className="text-ink-subtle">
            {/*
              Scope stated in the sentence rather than left to be inferred.
              "Every branch" is the case worth naming out loud, because it is
              the one an operator would want to question.
            */}
            {grant.branchCodes.length === 0
              ? t('scopeAllBranches')
              : t('scopeBranches', { branches: grant.branchCodes.join(', ') })}
          </span>

          <time dateTime={grant.expiresAt.toISOString()} className="text-ink-subtle tabular-nums">
            {t('expires', {
              time: grant.expiresAt.toLocaleTimeString('en-GB', {
                hour: '2-digit',
                minute: '2-digit',
                timeZone: 'Asia/Kuwait',
              }),
            })}
          </time>

          {mayRevoke && (
            <form action={revokeSupportAccess} className="ms-auto">
              <input type="hidden" name="grantId" value={grant.id} />
              <button
                type="submit"
                className="rounded-sm px-2.5 py-1 font-medium text-caution underline-offset-2 hover:underline"
              >
                {t('revoke')}
              </button>
            </form>
          )}
        </div>
      ))}
    </div>
  )
}
