/**
 * The customer portal shell — `FR-CP-01`, `FR-CP-03`.
 *
 * A customer must see nothing that identifies a third-party product, so the
 * chrome here is the operator's, exactly as on the public site. The difference
 * from the operations shell is what is *absent*: no branch switcher, no
 * margin, no exception queue. A customer's view is a projection, not a
 * permission-filtered copy of the internal one.
 */

import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getLocale, getTranslations } from 'next-intl/server'
import { getSession, homeFor } from '@/lib/session'
import { useDemoLogin, usePilotFixtures } from '@/lib/pilot/source'
import { getBrand } from '@/lib/brand'
import { DEFAULT_LOCALE, isLocale } from '@/i18n/request'
import { signOut } from '@/features/auth/actions'
import { Logo } from '@/ui/logo'
import { Icon } from '@/ui/icon'
import { LanguageSwitch } from '@/ui/preferences'

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession()
  if (!session) redirect('/sign-in')

  /*
    The portal is the customer's — A9.

    This checked only that *somebody* was signed in, so an agent contact saw
    the portal's list of every job their partner is named on, and internal
    staff saw it with no customer scoping at all (RLS gives staff every job in
    their branches). Each audience is sent to its own shell, as the agent
    shell already does for everyone who is not an agent.

    The one exception is the fixture deployment with no demo login, where the
    only principal there is is the internal pilot persona: the offline sweep
    and the hosted walkthrough preview the portal through it, and there is no
    customer to sign in as instead.
  */
  if (session.actor.type !== 'customer_contact' && !(usePilotFixtures() && !useDemoLogin())) {
    redirect(homeFor(session))
  }

  const brand = getBrand()
  const resolved = await getLocale()
  const locale = isLocale(resolved) ? resolved : DEFAULT_LOCALE
  const t = await getTranslations('nav')
  const tc = await getTranslations('common')

  return (
    <div className="flex min-h-dvh flex-col bg-canvas">
      <header className="sticky top-0 z-20 border-b border-line bg-surface/85 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-5xl items-center gap-4 px-4 sm:px-6">
          <Link href="/portal" className="min-w-0 rounded-sm outline-offset-4">
            <Logo brand={brand} locale={locale} size="md" />
          </Link>

          <nav className="ms-auto flex items-center gap-1">
            <Link
              href="/portal"
              className="inline-flex h-9 items-center gap-1.5 rounded-sm px-3 text-[0.875rem] font-medium text-ink-muted transition-colors hover:bg-surface-sunken hover:text-ink"
            >
              <Icon name="jobs" size={16} />
              <span className="hidden sm:inline">{t('portal')}</span>
            </Link>
            <Link
              href="/track"
              className="inline-flex h-9 items-center gap-1.5 rounded-sm px-3 text-[0.875rem] font-medium text-ink-muted transition-colors hover:bg-surface-sunken hover:text-ink"
            >
              <Icon name="tracking" size={16} />
              <span className="hidden sm:inline">{t('tracking')}</span>
            </Link>
            <LanguageSwitch />
            <span className="mx-1 hidden h-6 w-px bg-line sm:block" />
            {/*
              A form and a server action, not a link to `/sign-in` — the same
              correction the agent shell already carries, and this was the last
              shell still linking.

              The sign-in page redirects anyone who already has a session, so
              the link was a round trip straight back to the portal: the button
              said "sign out" and nothing was signed out. Only the action
              clears the cookie.
            */}
            <form action={signOut}>
              <button
                type="submit"
                title={tc('signOut')}
                aria-label={tc('signOut')}
                className="inline-flex h-9 items-center gap-1.5 rounded-sm px-3 text-[0.875rem] font-medium text-ink-muted transition-colors hover:bg-surface-sunken hover:text-critical"
              >
                <Icon name="sign-out" size={16} />
                <span className="hidden sm:inline">{tc('signOut')}</span>
              </button>
            </form>
          </nav>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6">{children}</main>
    </div>
  )
}
