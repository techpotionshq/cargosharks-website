/**
 * The internal application — one of four audiences served as route groups (§3).
 *
 * The guard here is a convenience, not the boundary. A customer contact who
 * reached an ops route would see nothing anyway: every query runs under their
 * principal, and the `internal` arm of each RLS policy would not apply to
 * them. This redirect exists so they get a sensible page rather than an empty
 * one.
 *
 * The chrome is brand-coloured rather than neutral, and that is a deliberate
 * whitelabel decision: the operator's colour frames the product, and the
 * product's own surfaces stay neutral so their data is what carries colour.
 * Re-skinning changes the frame, not the legibility of the board.
 */

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { getLocale, getTranslations } from 'next-intl/server'
import { getSession } from '@/lib/session'
import { getBrand } from '@/lib/brand'
import { DEFAULT_LOCALE, isLocale } from '@/i18n/request'
import { THEME_COOKIE, isThemeChoice } from '@/lib/theme'
import { usePilotFixtures } from '@/lib/pilot/source'
import { Logo } from '@/ui/logo'
import { Icon, type IconName } from '@/ui/icon'
import { LanguageSwitch, ThemeSwitch } from '@/ui/preferences'

interface NavItem {
  readonly href: string
  readonly key: 'dashboard' | 'enquiries' | 'jobs' | 'rates' | 'finance' | 'admin'
  readonly icon: IconName
}

const SECTIONS: readonly { key: 'commercial' | 'operations' | 'settings'; items: NavItem[] }[] = [
  {
    key: 'commercial',
    items: [
      { href: '/dashboard', key: 'dashboard', icon: 'dashboard' },
      { href: '/enquiries', key: 'enquiries', icon: 'enquiries' },
      { href: '/rates', key: 'rates', icon: 'rates' },
    ],
  },
  {
    key: 'operations',
    items: [{ href: '/jobs', key: 'jobs', icon: 'jobs' }],
  },
  {
    key: 'settings',
    items: [
      { href: '/finance', key: 'finance', icon: 'finance' },
      { href: '/admin', key: 'admin', icon: 'admin' },
    ],
  },
]

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

  const initials = session.principal.nameEn
    .split(' ')
    .map((part) => part[0])
    .slice(0, 2)
    .join('')

  return (
    <div className="flex min-h-dvh bg-canvas">
      {/*
        Two elements rather than one: the outer column carries the brand
        colour for the *whole* page height, and the inner nav sticks to the
        viewport. A single sticky element would leave the chrome ending
        mid-scroll on a long board, with the canvas showing beneath it.

        `border-e` is logical: the sidebar sits at the inline start, which is
        the right-hand side in Arabic, with no conditional.
      */}
      <div className="hidden w-64 shrink-0 border-e border-chrome-line bg-chrome md:block">
        <nav className="sticky top-0 flex h-dvh flex-col">
        <div className="px-4 py-5">
          <a href="/dashboard" className="block rounded-sm outline-offset-4">
            <Logo brand={brand} locale={locale} tone="chrome" size="sm" />
          </a>
        </div>

        <div className="flex-1 overflow-y-auto px-3 pb-4">
          {SECTIONS.map((section) => (
            <div key={section.key} className="mb-5">
              <p className="eyebrow mb-1.5 px-2 text-chrome-ink-muted/70">
                {t(`sections.${section.key}`)}
              </p>
              <ul className="flex flex-col gap-0.5">
                {section.items.map((item) => (
                  <li key={item.href}>
                    <a
                      href={item.href}
                      className="group flex items-center gap-2.5 rounded-sm px-2 py-2 text-[0.875rem] font-medium text-chrome-ink-muted transition-colors hover:bg-white/10 hover:text-chrome-ink"
                    >
                      <Icon name={item.icon} size={17} className="shrink-0 opacity-80" />
                      <span className="truncate">{t(item.key)}</span>
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* The customer-facing surface, reachable from the inside. */}
        <div className="border-t border-chrome-line px-3 py-3">
          <a
            href="/track"
            className="flex items-center gap-2.5 rounded-sm px-2 py-2 text-[0.8125rem] font-medium text-chrome-ink-muted transition-colors hover:bg-white/10 hover:text-chrome-ink"
          >
            <Icon name="tracking" size={16} />
            {t('tracking')}
            <Icon name="external" size={13} className="ms-auto opacity-60" />
          </a>
        </div>
        </nav>
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-line bg-surface/85 px-4 backdrop-blur-md md:px-6">
          {/* On a phone the sidebar collapses to the mark alone. */}
          <a href="/dashboard" className="md:hidden">
            <Logo brand={brand} locale={locale} size="sm" markOnly />
          </a>

          <form action="/jobs" className="relative hidden max-w-sm flex-1 sm:block">
            <Icon
              name="search"
              size={16}
              className="pointer-events-none absolute start-2.5 top-1/2 -translate-y-1/2 text-ink-subtle"
            />
            <input
              type="search"
              name="q"
              placeholder={tc('searchPlaceholder')}
              aria-label={tc('search')}
              className="h-9 w-full rounded-sm border border-line bg-surface-sunken ps-8 pe-3 text-[0.8125rem] text-ink placeholder:text-ink-subtle focus:border-brand focus:bg-surface focus:outline-none"
            />
          </form>

          <div className="ms-auto flex items-center gap-1.5">
            {usePilotFixtures() ? (
              <span
                className="hidden items-center gap-1.5 rounded-full bg-caution-soft px-2.5 py-1 text-[0.6875rem] font-semibold text-caution ring-1 ring-caution/25 ring-inset lg:inline-flex"
                title="Seeded pilot data — replaced by the client's own job files and rate card."
              >
                <Icon name="dot" size={10} />
                {tApp('pilot')}
              </span>
            ) : null}
            <ThemeSwitch current={theme} />
            <LanguageSwitch />
            <span className="mx-1 hidden h-6 w-px bg-line sm:block" />
            <span className="flex items-center gap-2">
              <span className="flex size-8 items-center justify-center rounded-full bg-brand-soft text-[0.75rem] font-semibold text-brand-soft-ink">
                {initials}
              </span>
              <span className="hidden min-w-0 flex-col leading-tight lg:flex">
                <span className="truncate text-[0.8125rem] font-medium text-ink">
                  {locale === 'ar' && session.principal.nameAr
                    ? session.principal.nameAr
                    : session.principal.nameEn}
                </span>
                <span className="truncate text-[0.6875rem] text-ink-subtle">
                  {tApp('operations')}
                </span>
              </span>
            </span>
          </div>
        </header>

        {/*
          The sidebar is desktop-only, so a phone would otherwise have no way
          out of the current screen. A scrolling icon strip is not a compromise
          here — an operations manager checking the board from a terminal yard
          is a real use, and a hamburger would need JavaScript to open.
        */}
        <nav className="flex items-center gap-1 overflow-x-auto border-b border-line bg-surface px-3 py-2 md:hidden">
          {SECTIONS.flatMap((section) => section.items).map((item) => (
            <a
              key={item.href}
              href={item.href}
              className="flex shrink-0 items-center gap-1.5 rounded-sm px-2.5 py-1.5 text-[0.8125rem] font-medium text-ink-muted transition-colors hover:bg-surface-sunken hover:text-ink"
            >
              <Icon name={item.icon} size={15} />
              {t(item.key)}
            </a>
          ))}
        </nav>

        <main className="flex-1 px-4 py-6 md:px-6 lg:px-8">{children}</main>
      </div>
    </div>
  )
}
