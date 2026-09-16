/**
 * The bell's two writes, both from the topbar and nowhere else.
 *
 * Opening an alert and clearing them all are the whole interaction. Neither is
 * a page of its own — the bell is a `<details>` panel in the operations shell,
 * with no client JavaScript, exactly as the theme and language switches beside
 * it are forms rather than components. So these are the actions those forms
 * post to.
 *
 * `revalidatePath('/', 'layout')` and not a narrower path: the bell renders in
 * the ops layout, above every screen, so its unread badge has to be refreshed
 * wherever the operator happens to be standing when they clear it.
 */

'use server'

import type { Route } from 'next'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { requireSession } from '@/lib/session'
import { markAllRead, markRead } from './queries'

/**
 * Open one alert: mark it read, then go where it points.
 *
 * Read is stamped *before* the redirect, because `redirect` throws to unwind
 * the request and nothing after it would run. An alert about nothing openable
 * (an empty `href`) still marks read and stays on the panel, which is why the
 * redirect is conditional rather than assumed.
 */
export async function openNotification(formData: FormData): Promise<void> {
  const session = await requireSession()
  const id = String(formData.get('id') ?? '')
  const href = String(formData.get('href') ?? '')

  if (id) await markRead(session.actor, id)
  revalidatePath('/', 'layout')

  // Typed routes reject a runtime string; the target came from our own query,
  // which only ever builds `/jobs/:id` or `/enquiries/:id`.
  if (href) redirect(href as Route)
}

export async function clearNotifications(): Promise<void> {
  const session = await requireSession()
  await markAllRead(session.actor)
  revalidatePath('/', 'layout')
}
