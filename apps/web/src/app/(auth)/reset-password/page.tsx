/**
 * Set a new password against the token from the email — FR-ID-05.
 *
 * ## The token is read here and passed down, not read by the action
 *
 * A server action is posted to its own endpoint and never sees the page's
 * query string, so the token has to be lifted out of the URL by this server
 * component and handed to the form as a hidden field.
 *
 * ## No token is a real state, not an error page
 *
 * People arrive here by pasting a truncated link, by following one that a mail
 * client wrapped across two lines, or by bookmarking the page. Every one of
 * those is somebody who wants a working link, so the answer is the way to ask
 * for another one rather than a message about what went wrong.
 */

import Link from 'next/link'
import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getLocale, getTranslations } from 'next-intl/server'
import { getSession, homeFor } from '@/lib/session'
import { getBrand } from '@/lib/brand'
import { MIN_PASSWORD_LENGTH } from '@/lib/auth'
import { DEFAULT_LOCALE, isLocale } from '@/i18n/request'
import { Logo } from '@/ui/logo'
import { ResetPasswordForm } from '@/features/auth/ui/reset-forms'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('resetPassword')
  return { title: t('title') }
}

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>
}) {
  const existing = await getSession()
  if (existing) redirect(homeFor(existing))

  const { token } = await searchParams
  const t = await getTranslations('resetPassword')
  const brand = getBrand()
  const resolved = await getLocale()
  const locale = isLocale(resolved) ? resolved : DEFAULT_LOCALE

  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-12 sm:px-8">
      <div className="w-full max-w-sm">
        <Logo brand={brand} locale={locale} size="md" markOnly className="mb-5" />

        <h1 className="font-display text-display font-semibold tracking-tight text-ink">
          {t('title')}
        </h1>

        {token ? (
          <>
            <p className="mt-1.5 text-title leading-relaxed text-ink-muted">{t('subtitle')}</p>

            <div className="mt-7">
              <ResetPasswordForm
                token={token}
                labels={{
                  password: t('password'),
                  confirm: t('confirm'),
                  hint: t('hint', { length: MIN_PASSWORD_LENGTH }),
                  submit: t('submit'),
                  submitting: t('submitting'),
                }}
              />
            </div>
          </>
        ) : (
          <>
            <p className="mt-1.5 text-title leading-relaxed text-ink-muted">{t('noTokenHint')}</p>

            <Link
              href="/forgot-password"
              className="mt-6 inline-flex h-11 w-full items-center justify-center rounded-sm bg-brand px-4 text-title font-semibold text-on-brand transition-colors hover:bg-brand-hover"
            >
              {t('requestAnother')}
            </Link>
          </>
        )}

        <div className="mt-8 border-t border-line pt-6">
          <Link href="/sign-in" className="text-body font-medium text-accent hover:underline">
            {t('backToSignIn')}
          </Link>
        </div>
      </div>
    </main>
  )
}
