/**
 * The root, which is now a signpost rather than a page.
 *
 * There was a marketing landing page here — a hero, a lane map of published
 * corridors, service copy. It has been removed, and the reasoning is worth
 * keeping: this deployment is the operator's *system*, not their website. They
 * already have qabandi.com. A second, thinner homepage on the same brand
 * competes with the real one, has to be kept in step with it, and is the first
 * thing every signed-in operator hits when they type the bare host — a page
 * whose only useful control was the sign-in button in its header.
 *
 * So the root sends people where they were actually going: the shell their
 * actor type belongs to if they are signed in, and the sign-in form if not.
 *
 * `redirect` is deliberately re-evaluated per request rather than made a static
 * `redirects()` entry in `next.config.ts`, because the destination depends on
 * who is asking.
 */

import { redirect } from 'next/navigation'
import { getSession, homeFor } from '@/lib/session'

export default async function RootPage() {
  const session = await getSession()
  redirect(session ? homeFor(session) : '/sign-in')
}
