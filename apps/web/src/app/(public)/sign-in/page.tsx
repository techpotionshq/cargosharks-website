/**
 * Sign-in — `FR-ID-05…07`.
 *
 * Credentials and TOTP. There is no sign-up link and no magic link, because
 * the product is invitation-only (`FR-ID-07`) and both are the entry point the
 * 2026 pre-account-hijacking advisory needs (§8).
 *
 * Mandatory 2FA for Administrator and Finance is checked at *session
 * establishment*, not only at enrolment — a session predating the policy must
 * not survive it.
 *
 * The customer link at the bottom is deliberate: most people who land here by
 * accident want to track a shipment, and sending them to a login they do not
 * have is how a tracking page goes unused.
 */

import type { Metadata } from 'next'
import { getLocale, getTranslations } from 'next-intl/server'
import { getBrand } from '@/lib/brand'
import { DEFAULT_LOCALE, isLocale } from '@/i18n/request'
import { Button } from '@/ui/layout'
import { Icon } from '@/ui/icon'
import { Logo } from '@/ui/logo'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('signIn')
  return { title: t('title') }
}

export default async function SignInPage() {
  const t = await getTranslations('signIn')
  const brand = getBrand()
  const resolved = await getLocale()
  const locale = isLocale(resolved) ? resolved : DEFAULT_LOCALE

  return (
    <div className="mx-auto flex min-h-[calc(100dvh-4rem)] max-w-sm flex-col justify-center px-4 py-12">
      <div className="mb-8 flex flex-col items-center text-center">
        <Logo brand={brand} locale={locale} size="lg" markOnly className="mb-4" />
        <h1 className="font-display text-xl font-semibold tracking-tight text-ink">
          {t('title')}
        </h1>
        <p className="mt-1 text-[0.875rem] text-ink-muted">{t('subtitle')}</p>
      </div>

      <form
        method="post"
        action="/api/auth/sign-in/email"
        className="flex flex-col gap-3 rounded-card border border-line bg-surface p-5 shadow-card"
      >
        <label className="flex flex-col gap-1.5">
          <span className="eyebrow">{t('email')}</span>
          <input
            type="email"
            name="email"
            required
            autoComplete="username"
            dir="ltr"
            className="h-10 rounded-sm border border-line bg-surface-sunken px-3 text-[0.9375rem] text-ink focus:border-brand focus:bg-surface focus:outline-none"
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="eyebrow">{t('password')}</span>
          <input
            type="password"
            name="password"
            required
            autoComplete="current-password"
            dir="ltr"
            className="h-10 rounded-sm border border-line bg-surface-sunken px-3 text-[0.9375rem] text-ink focus:border-brand focus:bg-surface focus:outline-none"
          />
        </label>

        <Button type="submit" variant="primary" size="lg" className="mt-1 w-full">
          {t('submit')}
        </Button>

        <p className="mt-1 flex items-start gap-2 text-[0.75rem] text-ink-subtle">
          <Icon name="hold" size={14} className="mt-px shrink-0" />
          {t('twoFactor')}
        </p>
      </form>

      <p className="mt-4 text-center text-[0.75rem] text-ink-subtle">{t('invitationOnly')}</p>

      <div className="mt-8 border-t border-line pt-6 text-center">
        <p className="text-[0.8125rem] text-ink-muted">{t('customerPrompt')}</p>
        <a
          href="/track"
          className="mt-1.5 inline-flex items-center gap-1.5 text-[0.875rem] font-medium text-brand hover:underline"
        >
          <Icon name="tracking" size={15} />
          {t('customerLink')}
        </a>
      </div>
    </div>
  )
}
