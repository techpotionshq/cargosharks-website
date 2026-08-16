/**
 * The internal application — one of four audiences served as route groups (§3).
 *
 * The guard here is a convenience, not the boundary. A customer contact who
 * reached an ops route would see nothing anyway: every query runs under their
 * principal, and the `internal` arm of each RLS policy would not apply to
 * them. This redirect exists so they get a sensible page rather than an empty
 * one.
 *
 * The chrome is cut from the brand's *secondary* — navy, not the corporate red
 * — and that is a deliberate whitelabel decision (see `brands/qabandi.ts`).
 * The operator's colour frames the product, the product's surfaces stay
 * neutral, and red is spent only where it means something.
 */

import Link from 'next/link'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { getLocale, getTranslations } from 'next-intl/server'
import { getSession } from '@/lib/session'
import { getBrand } from '@/lib/brand'
import { DEFAULT_LOCALE, isLocale } from '@/i18n/request'
import { THEME_COOKIE, isThemeChoice } from '@/lib/theme'
import { usePilotFixtures } from '@/lib/pilot/source'
import { can } from '@/lib/permissions'
import { getNavCounts } from '@/features/dashboard/nav-counts'
import { signOut } from '@/features/auth/actions'
import { Logo } from '@/ui/logo'
import { Icon } from '@/ui/icon'
import { MobileNav, SidebarNav, type NavSection } from '@/ui/nav'
import { LanguageSwitch, ThemeSwitch } from '@/ui/preferences'

export default async function OpsLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession()
  if (!session) redirect('/sign-in')
  if (session.actor.type === 'customer_contact') redirect('/portal')
  if (session.actor.type === 'agent_contact') redirect('/agent')

  const t = await getTranslations('nav')
  const tc = await getTranslations('common')
  const tApp = await getTranslations('app')
  const brand = getBrand()
  const resolved = await getLocale()
  const locale = isLocale(resolved) ? resolved : DEFAULT_LOCALE
  const themeCookie = (await cookies()).get(THEME_COOKIE)?.value
  const theme = isThemeChoice(themeCookie) ? themeCookie : 'system'

  // The two counts worth interrupting someone for. Everything else is a page
  // you go to; these are things that are wrong right now.
  const counts = await getNavCounts(session.actor)

  /**
   * The navigation, grouped the way the business is: what you sell, what you
   * move, who you move it with, what you bill, and the settings behind all of
   * it. Administration is filtered by permission rather than hidden by role,
   * so a finance user sees the ledger and not the user table.
   */
  const sections: NavSection[] = [
    {
      label: t('sections.commercial'),
      items: [
        { href: '/dashboard', label: t('dashboard'), icon: 'dashboard' },
        {
          href: '/enquiries',
          label: t('enquiries'),
          icon: 'enquiries',
          badge: counts.openEnquiries,
        },
        { href: '/quotes', label: t('quotes'), icon: 'quotes' },
        { href: '/customers', label: t('customers'), icon: 'customers' },
        { href: '/rates', label: t('rates'), icon: 'rates' },
      ],
    },
    {
      label: t('sections.operations'),
      items: [
        { href: '/jobs', label: t('jobs'), icon: 'jobs' },
        {
          href: '/exceptions',
          label: t('exceptions'),
          icon: 'alert',
          badge: counts.openExceptions,
        },
        { href: '/customs', label: t('customs'), icon: 'customs' },
        { href: '/documents', label: t('documents'), icon: 'document' },
      ],
    },
    {
      label: t('sections.network'),
      items: [
        { href: '/partners', label: t('partners'), icon: 'partners' },
        { href: '/locations', label: t('locations'), icon: 'locations' },
      ],
    },
    {
      label: t('sections.finance'),
      items: [
        { href: '/finance', label: t('finance'), icon: 'finance' },
        { href: '/invoices', label: t('invoices'), icon: 'invoices' },
        { href: '/payments', label: t('payments'), icon: 'payments' },
      ],
    },
    {
      label: t('sections.settings'),
      items: [
        ...(can(session, 'admin.users.write')
          ? [{ href: '/admin/users', label: t('users'), icon: 'users' as const }]
          : []),
        { href: '/admin/branches', label: t('branches'), icon: 'branches' },
        { href: '/admin/reference', label: t('reference'), icon: 'reference' },
        ...(can(session, 'admin.audit.read')
          ? [{ href: '/admin/audit', label: t('audit'), icon: 'audit' as const }]
          : []),
        { href: '/admin', label: t('brand'), icon: 'admin' },
      ],
    },
  ]

  const displayName =
    locale === 'ar' && session.principal.nameAr
      ? session.principal.nameAr
      : session.principal.nameEn

  const initials = session.principal.nameEn
    .split(' ')
    .map((part) => part[0])
    .slice(0, 2)
    .join('')

  const roleKey = [...session.branchRoles.values()][0] ?? 'read_only'
  const branchCodes = session.branchRoles.size

  return (
    <div className="flex min-h-dvh bg-canvas">
      {/*
        Two elements rather than one: the outer column carries the chrome
        colour for the *whole* page height, and the inner nav sticks to the
        viewport. A single sticky element would leave the chrome ending
        mid-scroll on a long board, with the canvas showing beneath it.

        `border-e` is logical: the sidebar sits at the inline start, which is
        the right-hand side in Arabic, with no conditional.
      */}
      <div className="hidden w-62 shrink-0 border-e border-chrome-line bg-chrome md:block">
        <nav className="sticky top-0 flex h-dvh flex-col">
          <div className="border-b border-chrome-line px-4 py-3.5">
            <Link href="/dashboard" className="block rounded-sm outline-offset-4">
              <Logo brand={brand} locale={locale} tone="chrome" size="sm" />
            </Link>
          </div>

          <SidebarNav sections={sections} />

          {/*
            The customer-facing surface, reachable from the inside — an
            operator checking what their customer actually sees.
          */}
          <div className="border-t border-chrome-line px-3 py-2">
            <Link
              href="/track"
              className="flex items-center gap-2.5 rounded-sm px-3 py-2 text-[0.8125rem] font-medium text-chrome-ink-muted transition-colors hover:bg-surface-sunken hover:text-chrome-ink"
            >
              <Icon name="tracking" size={16} className="text-ink-subtle" />
              {t('tracking')}
              <Icon name="external" size={13} className="ms-auto opacity-50" />
            </Link>
          </div>

          {/* Who you are signed in as, and the way out. */}
          <div className="border-t border-chrome-line p-3">
            <div className="flex items-center gap-2.5 rounded-sm bg-surface-sunken/70 p-2">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-brand text-[0.75rem] font-semibold text-on-brand">
                {initials}
              </span>
              <span className="flex min-w-0 flex-col leading-tight">
                <span className="truncate text-[0.8125rem] font-medium text-chrome-ink">
                  {displayName}
                </span>
                <span className="truncate text-[0.6875rem] text-chrome-ink-muted">
                  {t(`roles.${roleKey}`)} · {tc('branchCount', { count: branchCodes })}
                </span>
              </span>
              <form action={signOut} className="ms-auto">
                <button
                  type="submit"
                  title={t('signOut')}
                  aria-label={t('signOut')}
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
          {/* On a phone the sidebar collapses to the mark alone. */}
          <Link href="/dashboard" className="md:hidden">
            <Logo brand={brand} locale={locale} size="sm" markOnly />
          </Link>

          <form action="/jobs" className="relative hidden max-w-sm flex-1 sm:block">
            <Icon
              name="search"
              size={16}
              className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-ink-subtle"
            />
            <input
              type="search"
              name="q"
              placeholder={tc('searchPlaceholder')}
              aria-label={tc('search')}
              className="h-9 w-full rounded-full border border-line bg-surface-sunken ps-9 pe-3 text-[0.8125rem] text-ink placeholder:text-ink-subtle focus:border-brand focus:bg-surface focus:outline-none"
            />
          </form>

          <div className="ms-auto flex items-center gap-1.5">
            {usePilotFixtures() ? (
              <span
                className="hidden items-center gap-1.5 rounded-full bg-caution-soft px-2.5 py-1 text-[0.6875rem] font-semibold text-caution ring-1 ring-caution/25 ring-inset lg:inline-flex"
                title="Seeded pilot data — replaced by the client's own job files and rate card."
              >
                <Icon name="dot" size={9} />
                {tApp('pilot')}
              </span>
            ) : null}
            <ThemeSwitch current={theme} />
            <LanguageSwitch />
          </div>
        </header>

        {/*
          The sidebar is desktop-only, so a phone would otherwise have no way
          out of the current screen. A scrolling strip is not a compromise
          here — an operations manager checking the board from a terminal yard
          is a real use, and a hamburger would need JavaScript to open.
        */}
        <MobileNav sections={sections} />

        <main className="flex-1 px-4 py-6 md:px-6 lg:px-8">{children}</main>
      </div>
    </div>
  )
}
