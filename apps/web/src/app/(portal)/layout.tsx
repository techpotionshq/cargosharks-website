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
import { getSession } from '@/lib/session'
import { getBrand } from '@/lib/brand'
import { DEFAULT_LOCALE, isLocale } from '@/i18n/request'
import { Logo } from '@/ui/logo'
import { Icon } from '@/ui/icon'
import { LanguageSwitch } from '@/ui/preferences'

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession()
  if (!session) redirect('/sign-in')

  const brand = getBrand()
  const resolved = await getLocale()
  const locale = isLocale(resolved) ? resolved : DEFAULT_LOCALE
  const t = await getTranslations('nav')
  const tc = await getTranslations('common')

  return (
    <div className="flex min-h-dvh flex-col bg-canvas">
      <header className="sticky top-0 z-20 border-b border-line bg-surface/85 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-5xl items-center gap-4 px-4 sm:px-6">
          <Link href="/portal" className="rounded-sm outline-offset-4">
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
            <Link
              href="/sign-in"
              className="inline-flex h-9 items-center gap-1.5 rounded-sm px-3 text-[0.875rem] font-medium text-ink-muted transition-colors hover:bg-surface-sunken hover:text-ink"
            >
              <Icon name="sign-out" size={16} />
              <span className="hidden sm:inline">{tc('signOut')}</span>
            </Link>
          </nav>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6">{children}</main>
    </div>
  )
}
