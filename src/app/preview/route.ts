import config from '@payload-config'
import { draftMode } from 'next/headers'
import { redirect } from 'next/navigation'
import { getPayload } from 'payload'

/**
 * `/preview/?slug=<slug>[&lang=ar]`: an unpublished draft, for a signed-in
 * admin only. The admin's Preview button and the Slack "draft ready" message
 * link here. Turns on Next's draft mode, so the post page reads the latest
 * draft instead of the published version, until `/preview/exit/`.
 */
export async function GET(request: Request) {
  const url = new URL(request.url)
  const slug = url.searchParams.get('slug') ?? ''
  const lang = url.searchParams.get('lang') === 'ar' ? 'ar' : 'en'
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) return new Response('Unknown post', { status: 400 })

  // The admin's session cookie rides along: same origin. Without one, sign in
  // first and come back here.
  const payload = await getPayload({ config })
  const { user } = await payload.auth({ headers: request.headers })
  if (!user) redirect(`/admin/login/?redirect=${encodeURIComponent(url.pathname + url.search)}`)

  ;(await draftMode()).enable()
  redirect(lang === 'ar' ? `/ar/blog/${slug}/` : `/blog/${slug}/`)
}
