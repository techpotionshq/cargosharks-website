/**
 * Forgotten password — FR-ID-05.
 *
 * There was no way to recover an account. No page, no action, no email: a
 * member of staff who forgot their password needed somebody with database
 * access to write a row for them. For a product sold with support that is not
 * a missing screen, it is a support ticket that arrives every few weeks and
 * can only be answered by the vendor.
 *
 * ## A single column, unlike sign-in
 *
 * The sign-in page carries the operator's identity in a split panel, because
 * it is the first screen anyone sees and the only place the product can say
 * whose system this is. This screen is reached *from* there, by somebody who
 * has already seen it and is now in the middle of a small failure. Repeating
 * the provenance would be decoration in front of a task, so the page is the
 * form, one sentence of explanation, and the way back.
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
import { ForgotPasswordForm } from '@/features/auth/ui/reset-forms'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('forgotPassword')
  return { title: t('title') }
}

export default async function ForgotPasswordPage() {
  // Somebody already signed in does not need this, and following a stale link
  // to it would be a small trap — see the same guard on sign-in.
  const existing = await getSession()
  if (existing) redirect(homeFor(existing))

  const t = await getTranslations('forgotPassword')
  const brand = getBrand()
  const resolved = await getLocale()
  const locale = isLocale(resolved) ? resolved : DEFAULT_LOCALE

  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-12 sm:px-8">
      <div className="w-full max-w-sm">
        <Logo brand={brand} locale={locale} size="md" markOnly className="mb-5" />

        <h1 className="font-display text-2xl font-semibold tracking-tight text-ink">{t('title')}</h1>
        <p className="mt-1.5 text-[0.9375rem] leading-relaxed text-ink-muted">{t('subtitle')}</p>

        <div className="mt-7">
          <ForgotPasswordForm
            labels={{
              email: t('email'),
              submit: t('submit'),
              submitting: t('submitting'),
              sent: t('sent'),
            }}
          />
        </div>

        <div className="mt-8 border-t border-line pt-6">
          <Link
            href="/sign-in"
            className="inline-flex items-center gap-1.5 text-[0.875rem] font-medium text-brand hover:underline"
          >
            {/*
              `arrow-end` is in the mirrored set, so it already flips with the
              layout. Turning it a further half turn makes it point back the way
              the reader came in *both* directions, which a fixed left-pointing
              glyph would get wrong under Arabic.
            */}
            <Icon name="arrow-end" size={15} className="rotate-180" />
            {t('backToSignIn')}
          </Link>
        </div>
      </div>
    </main>
  )
}
