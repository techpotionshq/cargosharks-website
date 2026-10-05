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
import { usePilotFixtures } from '@/lib/pilot/source'
import { staffGroupsInUse } from '@qabandi/core'
import { markAllRead, markRead, setEmailOptOuts } from './queries'
import { isTarget } from './target'

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

  /*
    Only a path our own query could have built — A13, `target.ts`.

    The comment here used to say the target "came from our own query", and it
    came from a form field. Anything posted that is not a job or enquiry path
    is treated as an alert about nothing openable: marked read, and no
    redirect, so the product cannot be used to bounce a person to another site.
  */
  if (href && isTarget(href)) redirect(href as Route)
}

export async function clearNotifications(): Promise<void> {
  const session = await requireSession()
  await markAllRead(session.actor)
  revalidatePath('/', 'layout')
}

/**
 * Which staff notifications reach this person by email — R12.
 *
 * The form lists one checkbox per group, ticked meaning "email me". An
 * unticked box arrives as nothing, so the opt-outs are the groups on the
 * screen that were not sent; a value that is not a group is ignored rather
 * than stored. The bell is not offered: it always receives.
 */
export async function saveEmailPreferences(formData: FormData): Promise<void> {
  // The demo has no `principals` row to keep the choice on; the form simply
  // re-renders as it was.
  if (usePilotFixtures()) return
  const session = await requireSession()
  if (session.actor.type !== 'internal') return
  const wanted = new Set(formData.getAll('email').map(String))
  const optOuts = staffGroupsInUse().filter((group) => !wanted.has(group))
  await setEmailOptOuts(session.actor, optOuts)
  revalidatePath('/', 'layout')
}
