/**
 * The topbar bell.
 *
 * A server component with no client JavaScript, for the same reason the theme
 * and language switches beside it have none: this sits in the operations shell
 * on every screen, and a control that waits on a bundle to open is a control
 * that is empty for the first second of every page. The panel is a plain
 * `<details>`; opening an alert and clearing the lot are forms posting to
 * Server Actions.
 *
 * The one thing a `<details>` cannot do without script is close when you click
 * away — a deliberate, small trade. Opening an alert navigates, which closes
 * it; clearing them all re-renders the layout, which closes it. What is left is
 * dismissing an open panel you decided against, and the same click that would
 * close it also lands on whatever is behind it, which is where the operator was
 * going anyway.
 */

import { getLocale, getTranslations } from 'next-intl/server'
import { DEFAULT_LOCALE, isLocale } from '@/i18n/request'
import { formatRelative } from '@/lib/format'
import { Icon } from '@/ui/icon'
import { clearNotifications, openNotification } from '../actions'
import type { Inbox } from '../queries'

export async function NotificationBell({ inbox }: { readonly inbox: Inbox }) {
  const t = await getTranslations('notifications')
  const resolved = await getLocale()
  const locale = isLocale(resolved) ? resolved : DEFAULT_LOCALE
  const { items, unread } = inbox

  return (
    <details className="group relative">
      <summary
        aria-label={unread > 0 ? `${t('title')} (${unread})` : t('title')}
        className="inline-flex size-8 cursor-pointer list-none items-center justify-center rounded-sm text-ink-muted transition-colors hover:bg-surface-sunken hover:text-ink group-open:bg-surface-sunken group-open:text-ink [&::-webkit-details-marker]:hidden"
      >
        <span className="relative">
          <Icon name="bell" size={17} />
          {/*
            The badge is the whole point of the collapsed bell — the count of
            what is waiting. Hidden entirely at zero rather than shown as "0",
            which reads as a broken counter rather than an empty inbox.
          */}
          {unread > 0 ? (
            <span className="absolute -end-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-brand px-1 text-[0.625rem] font-semibold leading-none text-white">
              {unread > 9 ? '9+' : unread}
            </span>
          ) : null}
        </span>
      </summary>

      {/*
        On a phone the panel spans the screen, 16px in from each edge. Anchored
        to the bell at w-80 it ran off the screen — in Arabic the bell sits 255px
        in, so the panel reached 575px on a 390px phone — and it widened the page
        even while closed. `hidden` until open keeps it out of the layout.
      */}
      <div className="absolute end-0 top-full z-30 mt-2 hidden w-80 overflow-hidden rounded-lg border border-line bg-surface shadow-card group-open:block max-sm:fixed max-sm:inset-x-4 max-sm:top-14 max-sm:w-auto">
        <div className="flex items-center justify-between border-b border-line px-3 py-2">
          <span className="text-[0.8125rem] font-semibold text-ink">{t('title')}</span>
          {unread > 0 ? (
            <form action={clearNotifications}>
              <button
                type="submit"
                className="text-[0.75rem] font-medium text-accent hover:underline"
              >
                {t('markAllRead')}
              </button>
            </form>
          ) : null}
        </div>

        {items.length === 0 ? (
          <p className="px-3 py-6 text-center text-[0.8125rem] text-ink-subtle">{t('empty')}</p>
        ) : (
          <ul className="max-h-96 divide-y divide-line overflow-y-auto">
            {items.map((item) => (
              <li key={item.id}>
                {/*
                  The whole row is the submit: open marks read and, where the
                  alert points somewhere, redirects. A `<button>` rather than a
                  link precisely so the read is stamped on the way through.
                */}
                <form action={openNotification}>
                  <input type="hidden" name="id" value={item.id} />
                  <input type="hidden" name="href" value={item.href ?? ''} />
                  <button
                    type="submit"
                    className="flex w-full items-start gap-2 px-3 py-2.5 text-start transition-colors hover:bg-surface-sunken"
                  >
                    {/* Unread pip, holding the same column whether lit or not. */}
                    <span className="mt-1.5 flex w-2 shrink-0 justify-center">
                      {item.read ? null : <Icon name="dot" size={8} className="text-accent" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span
                        className={`block truncate text-[0.8125rem] ${
                          item.read ? 'text-ink-muted' : 'font-semibold text-ink'
                        }`}
                      >
                        {item.title}
                      </span>
                      {item.body ? (
                        <span className="mt-0.5 line-clamp-2 block text-[0.75rem] text-ink-subtle">
                          {item.body}
                        </span>
                      ) : null}
                      <span className="mt-1 block text-[0.6875rem] text-ink-subtle">
                        {formatRelative(item.createdAt, locale)}
                      </span>
                    </span>
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </div>
    </details>
  )
}
