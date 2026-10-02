/**
 * The sign-in challenge — FR-ID-06.
 *
 * Reached only from `signIn`, when Better Auth answered a correct password
 * with `twoFactorRedirect` and a short-lived cookie *instead of* a session.
 *
 * ## Why this page checks nothing
 *
 * There is deliberately no guard here and nothing to guard: at this point
 * nobody is signed in, so `getSession()` returns null and a redirect on that
 * basis would bounce the very people this page exists for. Whether the caller
 * is entitled to be here is decided by the challenge cookie, and that is
 * checked where it can be checked properly — inside `verifyTOTP`, by the
 * library that issued it.
 *
 * Somebody who arrives with no cookie sees the form and cannot get past it,
 * which is the correct outcome and needs no code of its own.
 */

import Link from 'next/link'
import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getLocale, getTranslations } from 'next-intl/server'
import { getSession, homeFor } from '@/lib/session'
import { getBrand } from '@/lib/brand'
import { DEFAULT_LOCALE, isLocale } from '@/i18n/request'
import { Icon } from '@/ui/icon'
import { Logo } from '@/ui/logo'
import { ChallengeForm } from '@/features/auth/ui/two-factor-forms'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('twoFactor')
  return { title: t('title') }
}

export default async function TwoFactorPage() {
  /*
    Somebody who already has a session has no business on the challenge — they
    have finished. Sent to their own shell rather than to `/dashboard`, because
    which one that is depends on who they are (`homeFor`).
  */
  const session = await getSession()
  if (session) redirect(homeFor(session))

  const t = await getTranslations('twoFactor')
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
        <p className="mt-1.5 text-title text-ink-muted">{t('subtitle')}</p>

        <div className="mt-7">
          <ChallengeForm
            labels={{
              code: t('code'),
              submit: t('submit'),
              submitting: t('submitting'),
            }}
          />
        </div>

        <p className="mt-4 flex items-start gap-2 rounded-sm bg-surface-sunken px-3 py-2.5 text-caption leading-snug text-ink-muted">
          <Icon name="hold" size={14} className="mt-px shrink-0 text-ink-subtle" />
          {t('backupHint')}
        </p>

        {/*
          A way back, because the alternative is a dead end.

          Somebody who has lost their phone cannot finish here and must be able
          to leave without closing the tab. The link signs nobody out — there is
          no session yet — it simply returns to the form.
        */}
        <p className="mt-3 text-center">
          <Link href="/sign-in" className="text-body-sm font-medium text-accent hover:underline">
            {t('back')}
          </Link>
        </p>
      </div>
    </main>
  )
}
