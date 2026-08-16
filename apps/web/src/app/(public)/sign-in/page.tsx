/**
 * Sign-in — FR-ID-05…07.
 *
 * Credentials and TOTP. There is no sign-up link and no magic link, because
 * the product is invitation-only (FR-ID-07) and both are the entry point the
 * 2026 pre-account-hijacking advisory needs (§8).
 *
 * Mandatory 2FA for Administrator and Finance is checked at *session
 * establishment*, not only at enrolment — a session predating the policy must
 * not survive it.
 */

import { getTranslations } from 'next-intl/server'

export default async function SignInPage() {
  const t = await getTranslations('app')

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center p-8">
      <h1 className="text-xl font-semibold">{t('name')}</h1>
      <p className="mt-1 text-sm text-[var(--ink-muted)]">{t('tagline')}</p>

      <form className="mt-8 space-y-3" method="post" action="/api/auth/sign-in/email">
        <input
          type="email"
          name="email"
          required
          autoComplete="username"
          placeholder="Email"
          className="w-full rounded border border-[var(--line)] px-3 py-2"
        />
        <input
          type="password"
          name="password"
          required
          autoComplete="current-password"
          placeholder="Password"
          className="w-full rounded border border-[var(--line)] px-3 py-2"
        />
        <button type="submit" className="w-full rounded bg-[var(--color-brand-500)] px-4 py-2 text-white">
          Sign in
        </button>
      </form>
    </main>
  )
}
