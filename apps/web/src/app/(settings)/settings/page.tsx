/**
 * The settings index.
 *
 * A landing page rather than a redirect to the first available area, for one
 * reason: administration is the part of the product people use least often and
 * therefore remember worst. "Which screen holds the invoice series?" is a real
 * question, and a list that answers it in one line per area is cheaper than
 * making someone open three pages to find out.
 *
 * It also handles the case the sidebar cannot. Roles here are not nested — a
 * principal may hold `admin.audit.read` and nothing else — so the set of areas
 * differs per account, and a fixed redirect target would 403 for somebody.
 */

import type { Metadata } from 'next'
import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { requireSession } from '@/lib/session'
import { settingsAreasFor } from '@/lib/permissions'
import { Icon } from '@/ui/icon'
import { PageHeader } from '@/ui/layout'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('settings')
  return { title: t('title') }
}

export default async function SettingsIndexPage() {
  const session = await requireSession()
  const t = await getTranslations('settings')

  const areas = settingsAreasFor(session)

  return (
    <>
      <PageHeader title={t('title')} description={t('description')} />

      <div className="grid gap-3 sm:grid-cols-2">
        {areas.map((area) => {
          const key = area.key
          return (
            <Link
              key={area.href}
              href={area.href}
              className="group flex items-start gap-3.5 rounded-lg border border-line bg-surface p-5 transition-colors hover:border-brand"
            >
              <span className="flex size-9 shrink-0 items-center justify-center rounded-sm bg-surface-sunken text-ink-subtle transition-colors group-hover:bg-brand-soft group-hover:text-brand">
                <Icon name={area.icon} size={18} />
              </span>
              <span className="min-w-0">
                <span className="flex items-center gap-1.5 text-[0.9375rem] font-semibold text-ink">
                  {t(`areas.${key}.title` as 'areas.users.title')}
                  <Icon
                    name="chevron-end"
                    size={13}
                    className="text-ink-subtle opacity-0 transition-opacity group-hover:opacity-100"
                  />
                </span>
                <span className="mt-1 block text-[0.8125rem] leading-relaxed text-ink-muted">
                  {t(`areas.${key}.description` as 'areas.users.description')}
                </span>
              </span>
            </Link>
          )
        })}
      </div>

      {/*
        Where reference data went.

        It was in this group until it was moved, and an administrator who
        remembers it being here will look for it here first. One line costs
        nothing and saves a support message.
      */}
      <p className="mt-6 flex items-center gap-2 text-[0.8125rem] text-ink-muted">
        <Icon name="reference" size={15} className="shrink-0 text-ink-subtle" />
        {t('referenceMoved')}{' '}
        <Link href="/reference" className="font-medium text-brand hover:underline">
          {t('referenceLink')}
        </Link>
      </p>
    </>
  )
}
