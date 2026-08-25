/**
 * Enrolment — the door the shells send people to, FR-ID-06.
 *
 * Unlike the challenge next door, this page runs *with* a session: the
 * password was accepted and a real session exists. What is missing is the
 * second factor the principal's role demands, and until it is here the shells
 * will not let them work.
 *
 * ## Why it lives in `(auth)` rather than in a shell
 *
 * Because the shells are what redirect here. A page inside `(ops)` would be
 * wrapped by the layout that bounces anyone unenrolled to this page — a
 * redirect loop, and the kind that renders as a blank screen rather than an
 * error. The auth group has no such guard and no navigation, which is also
 * right for the task: there is exactly one thing to do here and no reason to
 * offer a way around it.
 */

import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getLocale, getTranslations } from 'next-intl/server'
import { getSession } from '@/lib/session'
import { getBrand } from '@/lib/brand'
import { DEFAULT_LOCALE, isLocale } from '@/i18n/request'
import { Logo } from '@/ui/logo'
import { EnrolForm } from '@/features/auth/ui/two-factor-forms'
import { needsTwoFactorEnrolment } from '@/features/auth/enrolment'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('twoFactor.enrol')
  return { title: t('title') }
}

export default async function EnrolPage() {
  const session = await getSession()
  if (!session) redirect('/sign-in')

  /*
    Nobody enrols here who does not have to.

    The same predicate the shells use, so the page and the guard cannot
    disagree — and so an operator who has already enrolled, or whose role never
    required it, cannot land on a screen offering to rebind their authenticator.
    That is not merely untidy: `enableTwoFactor` issues a *new* secret, so
    reaching this page by accident and completing it would silently invalidate
    the authenticator the person is already using.
  */
  if (!(await needsTwoFactorEnrolment(session))) redirect('/dashboard')

  const t = await getTranslations('twoFactor.enrol')
  const brand = getBrand()
  const resolved = await getLocale()
  const locale = isLocale(resolved) ? resolved : DEFAULT_LOCALE

  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-12 sm:px-8">
      <div className="w-full max-w-sm">
        <Logo brand={brand} locale={locale} size="md" markOnly className="mb-5" />

        <h1 className="font-display text-2xl font-semibold tracking-tight text-ink">
          {t('title')}
        </h1>
        <p className="mt-1.5 text-[0.9375rem] text-ink-muted">{t('subtitle')}</p>

        <div className="mt-7">
          <EnrolForm
            labels={{
              password: t('password'),
              passwordHint: t('passwordHint'),
              begin: t('begin'),
              beginning: t('beginning'),
              scan: t('scan'),
              manual: t('manual'),
              backupTitle: t('backupTitle'),
              backupHint: t('backupHint'),
              code: t('code'),
              submit: t('submit'),
              submitting: t('submitting'),
            }}
          />
        </div>
      </div>
    </main>
  )
}
