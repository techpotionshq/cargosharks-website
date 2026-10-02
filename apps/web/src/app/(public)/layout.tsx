/**
 * The customer-facing shell — `FR-CP-01`, `NFR-16`.
 *
 * Everything a customer or partner sees carries the operator's name, mark and
 * colours, and nothing here identifies a third-party product. That is a
 * requirement rather than a preference, and it is the reason none of this
 * markup contains a literal company name: it all resolves from the brand.
 *
 * The language switch sits in the header rather than a settings page because
 * Moment 1 ends with someone switching to Arabic and handing over the phone.
 */

import Link from 'next/link'
import { getLocale, getTranslations } from 'next-intl/server'
import { getBrand } from '@/lib/brand'
import { DEFAULT_LOCALE, isLocale } from '@/i18n/request'
import { Logo } from '@/ui/logo'
import { Icon } from '@/ui/icon'
import { LanguageSwitch } from '@/ui/preferences'

export default async function PublicLayout({ children }: { children: React.ReactNode }) {
  const brand = getBrand()
  const resolved = await getLocale()
  const locale = isLocale(resolved) ? resolved : DEFAULT_LOCALE
  const t = await getTranslations('nav')
  const tc = await getTranslations('common')
  const tp = await getTranslations('public')

  const name = locale === 'ar' ? brand.identity.nameAr : brand.identity.nameEn
  const legalName = locale === 'ar' ? brand.identity.legalNameAr : brand.identity.legalNameEn
  const year = new Date().getFullYear()

  return (
    <div className="flex min-h-dvh flex-col bg-canvas">
      <header className="sticky top-0 z-20 border-b border-line bg-surface/85 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-4 px-4 sm:px-6">
          {/*
            The mark goes to tracking, not to the root.

            The root is a redirect now that the landing page is gone, so a
            customer clicking the logo would have been bounced to a sign-in
            form they have no account for. Tracking is the only thing in this
            shell and the only thing they came for.
          */}
          <Link href="/track" className="min-w-0 rounded-sm outline-offset-4">
            <Logo brand={brand} locale={locale} size="md" />
          </Link>

          <nav className="ms-auto flex items-center gap-1">
            <Link
              href="/track"
              className="inline-flex h-9 items-center gap-1.5 rounded-sm px-3 text-[0.875rem] font-medium text-ink-muted transition-colors hover:bg-surface-sunken hover:text-ink"
            >
              <Icon name="tracking" size={16} />
              <span className="hidden sm:inline">{t('tracking')}</span>
            </Link>
            <LanguageSwitch />
            <Link
              href="/sign-in"
              className="ms-1 inline-flex h-9 items-center rounded-sm bg-brand px-3.5 text-[0.875rem] font-medium text-on-brand transition-colors hover:bg-brand-hover"
            >
              {tc('signIn')}
            </Link>
          </nav>
        </div>
      </header>

      <main className="flex-1">{children}</main>

      <footer className="border-t border-line bg-surface">
        <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-8 sm:px-6 md:flex-row md:items-start md:justify-between">
          <div className="max-w-sm">
            <Logo brand={brand} locale={locale} size="sm" />
            <p className="mt-3 text-[0.8125rem] text-ink-muted">{legalName}</p>
            <p className="mt-1 text-[0.8125rem] text-ink-subtle">
              {locale === 'ar' ? brand.contact.addressAr : brand.contact.addressEn}
            </p>
          </div>

          <dl className="flex flex-col gap-2 text-[0.8125rem]">
            <div className="flex items-center gap-2 text-ink-muted">
              <Icon name="enquiries" size={15} className="text-ink-subtle" />
              <a href={`mailto:${brand.contact.supportEmail}`} className="hover:text-accent">
                <bdi>{brand.contact.supportEmail}</bdi>
              </a>
            </div>
            <div className="flex items-center gap-2 text-ink-muted">
              <Icon name="partners" size={15} className="text-ink-subtle" />
              <a
                href={`tel:${brand.contact.supportPhone.replace(/\s/g, '')}`}
                className="numeric hover:text-accent"
                dir="ltr"
              >
                {brand.contact.supportPhone}
              </a>
            </div>
            <div className="flex items-center gap-2 text-ink-muted">
              <Icon name="tracking" size={15} className="text-ink-subtle" />
              <Link href="/track" className="hover:text-accent">
                {t('tracking')}
              </Link>
            </div>
          </dl>
        </div>

        <div className="border-t border-line">
          <p className="mx-auto max-w-6xl px-4 py-4 text-[0.75rem] text-ink-subtle sm:px-6">
            © {year} {name}. {tp('footerRights')}
          </p>
        </div>
      </footer>
    </div>
  )
}
