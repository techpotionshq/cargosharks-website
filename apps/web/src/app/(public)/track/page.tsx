/**
 * Public tracking — FR-CP-05.
 *
 * Takes a reference *and* a second identifier, because a reference alone is
 * guessable and the page is unauthenticated. Rate limiting lives in the
 * service, in front of the lookup.
 */

import { getTranslations } from 'next-intl/server'

export default async function TrackPage() {
  const t = await getTranslations('nav')
  return (
    <main className="mx-auto max-w-md p-8">
      <h1 className="text-xl font-semibold">{t('tracking')}</h1>
      <form className="mt-6 space-y-3" action="/track/result">
        <input name="reference" required placeholder="Reference" className="w-full rounded border border-[var(--line)] px-3 py-2" />
        <input name="verifier" required placeholder="Bill of lading or container number" className="w-full rounded border border-[var(--line)] px-3 py-2" />
        <button type="submit" className="rounded bg-[var(--color-brand-500)] px-4 py-2 text-white">Track</button>
      </form>
    </main>
  )
}
