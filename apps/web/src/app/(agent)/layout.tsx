/**
 * The agent shell — one of four audiences served as route groups (§3).
 *
 * An overseas agent is neither staff nor a customer: they see a job because
 * their partner is named on it, which is one arm of one RLS policy (§5.3) and
 * not a separate application. What they need from a shell is therefore small
 * — where they are, which agency they are signed in as, and the way out.
 *
 * Without this file the group had no shell at all. That mattered twice: the
 * page rendered on the bare root layout with no chrome, and its
 * `requireSession()` *threw* for a signed-out visitor rather than sending them
 * to the form — an unauthenticated hit on `/agent` produced the error page.
 * The guard belongs here for the same reason it lives in the other three
 * shells: every route in the group inherits it, including ones added later.
 *
 * The agency name sits in the header rather than the person's. An agent office
 * shares a mailbox and often a login, and "Gulf Freight Dubai" is what tells
 * whoever is looking at the screen which side of the shipment they are on.
 */

import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getLocale, getTranslations } from 'next-intl/server'
import { getSession, homeFor } from '@/lib/session'
import { getBrand } from '@/lib/brand'
import { DEFAULT_LOCALE, isLocale } from '@/i18n/request'
import { signOut } from '@/features/auth/actions'
import { agentPartnerName } from '@/features/network/queries'
import { Logo } from '@/ui/logo'
import { Icon } from '@/ui/icon'
import { LanguageSwitch } from '@/ui/preferences'

export default async function AgentLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession()
  if (!session) redirect('/sign-in')

  /*
    A convenience redirect, not the boundary — the same argument the ops shell
    makes. An internal principal who reached `/agent` would see nothing here
    anyway, because the query behind it filters on `app.partner_id()` and
    theirs is empty. Sending them to their own shell beats an empty page.
  */
  if (session.actor.type !== 'agent_contact') redirect(homeFor(session))

  const brand = getBrand()
  const resolved = await getLocale()
  const locale = isLocale(resolved) ? resolved : DEFAULT_LOCALE
  const t = await getTranslations('nav')
  const tc = await getTranslations('common')

  const partnerName = await agentPartnerName(session.actor, locale)

  return (
    <div className="flex min-h-dvh flex-col bg-canvas">
      <header className="sticky top-0 z-20 border-b border-line bg-surface/85 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-4xl items-center gap-4 px-4 sm:px-6">
          <Link href="/agent" className="min-w-0 rounded-sm outline-offset-4">
            <Logo brand={brand} locale={locale} size="md" />
          </Link>

          {partnerName ? (
            <>
              <span className="hidden h-6 w-px bg-line sm:block" />
              <span className="hidden truncate text-body-sm font-medium text-ink-muted sm:block">
                {partnerName}
              </span>
            </>
          ) : null}

          <nav className="ms-auto flex items-center gap-1">
            <Link
              href="/agent"
              className="inline-flex h-9 items-center gap-1.5 rounded-sm px-3 text-body font-medium text-ink-muted transition-colors hover:bg-surface-sunken hover:text-ink"
            >
              <Icon name="jobs" size={16} />
              <span className="hidden sm:inline">{t('agent')}</span>
            </Link>
            <LanguageSwitch />
            <span className="mx-1 hidden h-6 w-px bg-line sm:block" />
            {/*
              A form and a server action, not a link to `/sign-in`.

              The sign-in page redirects anyone who already has a session, so a
              link there is a round trip back to this page — the session cookie
              has to actually be cleared, and only the action does that.
            */}
            <form action={signOut}>
              <button
                type="submit"
                title={tc('signOut')}
                aria-label={tc('signOut')}
                className="inline-flex h-9 items-center gap-1.5 rounded-sm px-3 text-body font-medium text-ink-muted transition-colors hover:bg-surface-sunken hover:text-critical"
              >
                <Icon name="sign-out" size={16} />
                <span className="hidden sm:inline">{tc('signOut')}</span>
              </button>
            </form>
          </nav>
        </div>
      </header>

      <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-8 sm:px-6">{children}</main>
    </div>
  )
}
