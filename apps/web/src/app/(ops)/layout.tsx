/**
 * The internal application — one of four audiences served as route groups (§3).
 *
 * The guard here is a convenience, not the boundary. A customer contact who
 * reached an ops route would see nothing anyway: every query runs under their
 * principal, and the `internal` arm of each RLS policy would not apply to
 * them. This redirect exists so they get a sensible page rather than an empty
 * one.
 */

import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { getSession } from '@/lib/session'

export default async function OpsLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession()
  if (!session) redirect('/sign-in')
  if (session.actor.type === 'customer_contact') redirect('/portal')
  if (session.actor.type === 'agent_contact') redirect('/agent')

  const t = await getTranslations('nav')

  return (
    <div className="flex min-h-dvh">
      {/* `border-e` is logical: the inline end, which flips in Arabic. */}
      <nav className="w-60 shrink-0 border-e border-[var(--line)] bg-[var(--surface-muted)] p-4">
        <p className="mb-6 text-sm font-semibold">Al-Qabandi &amp; Partners</p>
        <ul className="space-y-1 text-sm">
          <li><a className="block rounded px-2 py-1.5 hover:bg-black/5" href="/enquiries">{t('enquiries')}</a></li>
          <li><a className="block rounded px-2 py-1.5 hover:bg-black/5" href="/jobs">{t('jobs')}</a></li>
          <li><a className="block rounded px-2 py-1.5 hover:bg-black/5" href="/rates">{t('rates')}</a></li>
          <li><a className="block rounded px-2 py-1.5 hover:bg-black/5" href="/finance">{t('finance')}</a></li>
          <li><a className="block rounded px-2 py-1.5 hover:bg-black/5" href="/admin">{t('admin')}</a></li>
        </ul>
      </nav>
      <main className="flex-1 p-6">{children}</main>
    </div>
  )
}
