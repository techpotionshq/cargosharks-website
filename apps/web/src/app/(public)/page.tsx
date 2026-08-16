/**
 * The public entry point — quote request and tracking (FR-CP-05).
 *
 * Unauthenticated by design, which is exactly why tracking needs a second
 * identifier and a rate limit: an enumeration control, not a session (§8).
 */

import { getTranslations } from 'next-intl/server'

export default async function PublicHome() {
  const t = await getTranslations('app')
  return (
    <main className="mx-auto max-w-2xl p-8">
      <h1 className="text-2xl font-semibold">{t('name')}</h1>
      <p className="mt-1 text-[var(--ink-muted)]">{t('tagline')}</p>
      <p className="mt-6 text-sm">
        <a className="text-[var(--color-brand-500)] hover:underline" href="/track">Track a shipment</a>
      </p>
    </main>
  )
}
