/**
 * Settings — administration, given its own shell.
 *
 * These four screens used to sit in the operations sidebar under a heading
 * called "Administration", which was wrong in both directions. An operator
 * scanned past "Audit log" and "Brand" forty times a day to reach Shipments,
 * and an administrator opening the audit trail because a customer disputed a
 * charge had to find it among twenty operational links. Neither audience was
 * served by the compromise.
 *
 * So administration is a *place you go*, not a section you scroll past. It has
 * its own navigation, no badges, no counts, and a single way back — the point
 * being that nothing here is urgent and nothing here is part of a shipment.
 *
 * **The guard is real, unlike the one in `(ops)`.** There, a customer contact
 * reaching an operations route would see an empty page anyway, because RLS
 * would not match a single row. Here that is not true: branches, roles and the
 * audit trail are readable by any *internal* principal under their policies, so
 * a coordinator who typed `/settings/branches` would have seen the invoice
 * series for every branch they operate in. The permission check below is what
 * stops that, which is why it rejects rather than merely redirecting tidily.
 *
 * Reference data is not here. Adding a port when a new lane opens is
 * operational work an operations manager does daily, and it stayed at
 * `/reference` in the operations shell where that work happens.
 */

import Link from 'next/link'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { getLocale, getTranslations } from 'next-intl/server'
import { getSession } from '@/lib/session'
import { needsTwoFactorEnrolment } from '@/features/auth/enrolment'
import { getBrand } from '@/lib/brand'
import { DEFAULT_LOCALE, isLocale } from '@/i18n/request'
import { THEME_COOKIE, isThemeChoice } from '@/lib/theme'
import { settingsAreasFor } from '@/lib/permissions'
import { signOut } from '@/features/auth/actions'
import { Logo } from '@/ui/logo'
import { Icon } from '@/ui/icon'
import { MobileNav, SidebarNav, type NavSection } from '@/ui/nav'
import { LanguageSwitch, ThemeSwitch, TimeZoneSwitch } from '@/ui/preferences'

export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession()
  if (!session) redirect('/sign-in')
  if (session.actor.type === 'customer_contact') redirect('/portal')
  if (session.actor.type === 'agent_contact') redirect('/agent')

  /*
    The second factor, enforced — FR-ID-06.

    Before the navigation is built and before any query runs, because an
    administrator who has not enrolled must not reach a screen at all. Until
    now this was a label: `requiresTwoFactor` was computed on every request,
    drawn as an icon on the users screen, and read by nothing that could stop
    anybody.

    The predicate is shared with `(settings)` and with the enrolment page
    itself (`features/auth/enrolment.ts`), so the guard and the screen it
    guards cannot drift apart.
  */
  if (await needsTwoFactorEnrolment(session)) redirect('/two-factor/enrol')

  /**
   * The areas this principal can actually open.
   *
   * An empty list means the account holds no administration key at all, and
   * the honest answer is to send them back to work rather than to render a
   * shell around nothing. Each page asserts its own permission as well — this
   * decides what the navigation offers, not what the server will serve.
   */
  const areas = settingsAreasFor(session)
  if (areas.length === 0) redirect('/dashboard')

  const t = await getTranslations('settings')
  const tNav = await getTranslations('nav')
  const tc = await getTranslations('common')
  const brand = getBrand()
  const resolved = await getLocale()
  const locale = isLocale(resolved) ? resolved : DEFAULT_LOCALE
  const themeCookie = (await cookies()).get(THEME_COOKIE)?.value
  const theme = isThemeChoice(themeCookie) ? themeCookie : 'system'

  /*
    One section, no badges. A count chip here would be claiming that something
    in administration needs attention now, and nothing in administration ever
    does — that is the difference between this shell and the operations one.
  */
  const sections: NavSection[] = [
    {
      label: t('sections.administration'),
      items: areas.map((area) => ({
        href: area.href,
        label: t(`areas.${area.key}.title` as 'areas.users.title'),
        icon: area.icon,
      })),
    },
  ]

  const displayName =
    locale === 'ar' && session.principal.nameAr
      ? session.principal.nameAr
      : session.principal.nameEn

  return (
    <div className="flex min-h-dvh bg-canvas">
      <div className="hidden w-62 shrink-0 border-e border-chrome-line bg-chrome md:block">
        <nav className="sticky top-0 flex h-dvh flex-col">
          {/* The topbar's height exactly, so the two hairlines meet at the
              seam — see the same block in `app/(ops)/layout.tsx`. */}
          <div className="flex h-14 items-center border-b border-chrome-line px-4">
            <Link href="/dashboard" className="block min-w-0 rounded-sm outline-offset-4">
              <Logo brand={brand} locale={locale} tone="chrome" size="sm" />
            </Link>
          </div>

          {/*
            The way out, at the top rather than the bottom.

            Administration is somewhere you visit to answer one question and
            then leave, so the exit belongs where the eye lands first. It uses
            the dashboard's own icon rather than a back arrow because an arrow
            has to be mirrored under Arabic and a gauge does not.
          */}
          <div className="border-b border-chrome-line px-3 py-2">
            <Link
              href="/dashboard"
              className="flex items-center gap-2.5 rounded-sm px-3 py-2 text-[0.8125rem] font-medium text-chrome-ink-muted transition-colors hover:bg-surface-sunken hover:text-chrome-ink"
            >
              <Icon name="dashboard" size={16} className="text-ink-subtle" />
              {t('backToOperations')}
            </Link>
          </div>

          <SidebarNav sections={sections} />

          <div className="border-t border-chrome-line p-3">
            <div className="flex items-center gap-2.5 rounded-sm bg-surface-sunken/70 p-2">
              <span className="flex min-w-0 flex-col leading-tight">
                <span className="truncate text-[0.8125rem] font-medium text-chrome-ink">
                  {displayName}
                </span>
                <span className="truncate text-[0.6875rem] text-chrome-ink-muted">
                  {t('signedInAs')}
                </span>
              </span>
              <form action={signOut} className="ms-auto">
                <button
                  type="submit"
                  title={tNav('signOut')}
                  aria-label={tNav('signOut')}
                  className="flex size-7 items-center justify-center rounded-sm text-chrome-ink-muted transition-colors hover:bg-surface hover:text-critical"
                >
                  <Icon name="sign-out" size={15} />
                </button>
              </form>
            </div>
          </div>
        </nav>
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-line bg-surface/85 px-4 backdrop-blur-md md:px-6">
          <Link href="/dashboard" className="md:hidden">
            <Logo brand={brand} locale={locale} size="sm" markOnly />
          </Link>

          {/*
            A standing label rather than a page title. The screens below carry
            their own headings, and this says which building you are in — which
            matters more here than in operations, because the two shells share
            a palette and differ only in what they contain.
          */}
          <span className="flex items-center gap-2 text-[0.8125rem] font-semibold text-ink">
            <Icon name="settings" size={16} className="text-ink-subtle" />
            {t('title')}
          </span>

          <div className="ms-auto flex items-center gap-1.5">
            <Link
              href="/dashboard"
              className="hidden items-center gap-1.5 rounded-full border border-line px-3 py-1.5 text-[0.75rem] font-medium text-ink-muted transition-colors hover:border-brand hover:text-accent sm:inline-flex"
            >
              <Icon name="dashboard" size={14} />
              {tc('operations')}
            </Link>
            <TimeZoneSwitch current={session.principal.timezone} />
            <ThemeSwitch current={theme} />
            <LanguageSwitch />
          </div>
        </header>

        <MobileNav sections={sections} />

        <main className="flex-1 px-4 py-6 md:px-6 lg:px-8">{children}</main>
      </div>
    </div>
  )
}
