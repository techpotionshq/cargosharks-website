'use client'

/**
 * The portal's three sections — shipments, quotations, invoices (D12).
 *
 * A row of tabs under the header rather than three more icons in it. The
 * header already carries the wordmark, tracking, the language switch and sign
 * out, and on a phone those are icon-only; three more unlabelled glyphs there
 * would push it past 360px and leave a customer guessing which one is money.
 * Here every tab keeps its word at every width, and the row scrolls sideways
 * inside itself if a long Arabic label ever needs it, never the page.
 *
 * A client component only for the active tab, like the sidebar's list.
 * `/portal` is matched exactly, since every portal path starts with it; the
 * other two by prefix, so a quotation's own page keeps "Quotations" lit.
 */

import type { Route } from 'next'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Icon, type IconName } from '@/ui/icon'

export interface PortalTab {
  readonly href: '/portal' | '/portal/quotes' | '/portal/invoices'
  readonly label: string
  readonly icon: IconName
}

function isActive(pathname: string, href: string): boolean {
  if (href === '/portal') return pathname === '/portal' || pathname.startsWith('/portal/shipments')
  return pathname === href || pathname.startsWith(`${href}/`)
}

export function PortalTabs({
  tabs,
  label,
}: {
  readonly tabs: readonly PortalTab[]
  readonly label: string
}) {
  const pathname = usePathname()

  return (
    <nav aria-label={label} className="-mb-px flex gap-1 overflow-x-auto">
      {tabs.map((tab) => {
        const active = isActive(pathname, tab.href)
        return (
          <Link
            key={tab.href}
            href={tab.href as Route}
            aria-current={active ? 'page' : undefined}
            className={[
              'inline-flex h-10 shrink-0 items-center gap-1.5 border-b-2 px-3 text-body font-medium whitespace-nowrap transition-colors',
              active
                ? 'border-accent text-accent'
                : 'border-transparent text-ink-muted hover:border-line hover:text-ink',
            ].join(' ')}
          >
            <Icon name={tab.icon} size={16} />
            {tab.label}
          </Link>
        )
      })}
    </nav>
  )
}
