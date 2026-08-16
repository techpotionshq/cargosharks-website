'use client'

/**
 * The sidebar's navigation list.
 *
 * A client component for exactly one reason: the active route. Everything else
 * about the sidebar is static markup rendered on the server, and the item
 * definitions arrive as serialisable props so the *shape* of the navigation
 * stays declared in the layout rather than here.
 *
 * Active state is matched by prefix, so `/customers/new` and `/customers/{id}`
 * both keep "Customers" lit. The dashboard is exempt — every path starts with
 * `/`, so a prefix match there would light it permanently.
 */

import type { Route } from 'next'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Icon, type IconName } from './icon'

export interface NavLink {
  readonly href: string
  readonly label: string
  readonly icon: IconName
  /** Rendered as a count chip — open exceptions, unassigned enquiries. */
  readonly badge?: number
}

export interface NavSection {
  readonly label: string
  readonly items: readonly NavLink[]
}

function isActive(pathname: string, href: string): boolean {
  if (href === '/dashboard') return pathname === '/dashboard'
  return pathname === href || pathname.startsWith(`${href}/`)
}

export function SidebarNav({ sections }: { readonly sections: readonly NavSection[] }) {
  const pathname = usePathname()

  return (
    <div className="flex flex-1 flex-col gap-5 overflow-y-auto px-3 py-4">
      {sections.map((section) => (
        <div key={section.label}>
          <p className="mb-1 px-3 text-[0.625rem] font-semibold tracking-[0.14em] text-chrome-ink-muted/55 uppercase">
            {section.label}
          </p>
          <ul className="flex flex-col gap-px">
            {section.items.map((item) => {
              const active = isActive(pathname, item.href)
              return (
                <li key={item.href}>
                  <Link
                    href={item.href as Route}
                    aria-current={active ? 'page' : undefined}
                    className={[
                      'group relative flex items-center gap-2.5 rounded-md py-[0.4rem] ps-3 pe-2 text-[0.8125rem] transition-colors',
                      active
                        ? 'bg-white/9 font-semibold text-chrome-ink'
                        : 'font-medium text-chrome-ink-muted hover:bg-white/5 hover:text-chrome-ink',
                    ].join(' ')}
                  >
                    {/*
                      The active marker is a rule on the inline-start edge, not
                      a filled pill: on a dark chrome a solid brand block at
                      every level of the tree competes with the alarm colours on
                      the board it is framing.
                    */}
                    <span
                      className={[
                        'absolute inset-y-1 start-0 w-[3px] rounded-e-full bg-brand transition-opacity',
                        active ? 'opacity-100' : 'opacity-0',
                      ].join(' ')}
                    />
                    <Icon
                      name={item.icon}
                      size={17}
                      weight={active ? 'fill' : 'regular'}
                      className={active ? 'text-brand' : 'opacity-70'}
                    />
                    <span className="truncate">{item.label}</span>
                    {item.badge ? (
                      <span className="numeric ms-auto rounded-full bg-critical px-1.5 py-px text-[0.6875rem] font-semibold text-on-brand">
                        {item.badge > 99 ? '99+' : item.badge}
                      </span>
                    ) : null}
                  </Link>
                </li>
              )
            })}
          </ul>
        </div>
      ))}
    </div>
  )
}

/** The same list as a horizontal strip, for phones where the sidebar is gone. */
export function MobileNav({ sections }: { readonly sections: readonly NavSection[] }) {
  const pathname = usePathname()
  const items = sections.flatMap((section) => section.items)

  return (
    <nav className="flex items-center gap-1 overflow-x-auto border-b border-line bg-surface px-3 py-2 md:hidden">
      {items.map((item) => {
        const active = isActive(pathname, item.href)
        return (
          <Link
            key={item.href}
            href={item.href as Route}
            aria-current={active ? 'page' : undefined}
            className={[
              'flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[0.8125rem] transition-colors',
              active
                ? 'bg-brand-soft font-semibold text-brand-soft-ink'
                : 'font-medium text-ink-muted hover:bg-surface-sunken hover:text-ink',
            ].join(' ')}
          >
            <Icon name={item.icon} size={15} weight={active ? 'fill' : 'regular'} />
            {item.label}
          </Link>
        )
      })}
    </nav>
  )
}
