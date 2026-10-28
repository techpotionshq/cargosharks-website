import config from '@payload-config'
import { getPayload } from 'payload'

/**
 * `/cron/posts/`: read a post's latest draft, correct it and publish it, with
 * the cron secret instead of an admin session.
 *
 * For working on drafts from outside the admin: the drafting run's output is
 * reviewed (read), fixed where the review finds something (edit) and released
 * (publish). Publishing goes through Payload like the admin's button does, so
 * the post's hooks run: the blog revalidates, Slack hears, IndexNow is told.
 *
 *   GET  ?slug=<slug>                                  both languages, as JSON
 *   POST { slug, action: 'edit', en?: {…}, ar?: {…} }  set fields on the draft
 *                                                      (en.slug too, until it is published)
 *   POST { slug, action: 'publish' }                   publish the latest draft
 */
export const dynamic = 'force-dynamic'

/** The fields an edit may set: copy only, never slug, status or relations. */
const EDITABLE = ['title', 'excerpt', 'metaDescription', 'focusKeyword', 'body', 'faqs'] as const

const authorised = (request: Request) => {
  const secret = process.env.CRON_SECRET
  return Boolean(secret) && request.headers.get('authorization') === `Bearer ${secret}`
}

async function find(slug: string) {
  const payload = await getPayload({ config })
  const { docs } = await payload.find({
    collection: 'posts',
    draft: true,
    locale: 'all',
    where: { slug: { equals: slug } },
    limit: 1,
    depth: 0,
  })
  return { payload, post: docs[0] }
}

export async function GET(request: Request) {
  if (!authorised(request)) return Response.json({ error: 'unauthorised' }, { status: 401 })
  const slug = new URL(request.url).searchParams.get('slug') ?? ''
  const { post } = await find(slug)
  if (!post) return Response.json({ error: 'no such post' }, { status: 404 })
  return Response.json(post)
}

export async function POST(request: Request) {
  if (!authorised(request)) return Response.json({ error: 'unauthorised' }, { status: 401 })
  const body = (await request.json().catch(() => ({}))) as {
    slug?: string
    action?: string
    en?: Record<string, unknown>
    ar?: Record<string, unknown>
  }
  const { payload, post } = await find(body.slug ?? '')
  if (!post) return Response.json({ error: 'no such post' }, { status: 404 })

  if (body.action === 'edit') {
    for (const locale of ['en', 'ar'] as const) {
      const fields = body[locale]
      if (!fields) continue
      const data = Object.fromEntries(
        Object.entries(fields).filter(([key]) => (EDITABLE as readonly string[]).includes(key)),
      )
      // The address can change only before anyone has it: a published post's
      // slug is in search results, the sitemap and other sites' links.
      if (locale === 'en' && typeof fields.slug === 'string' && post._status !== 'published')
        data.slug = fields.slug
      // Edits land on the draft; a published post keeps its live version
      // until it is published again.
      await payload.update({ collection: 'posts', id: post.id, locale, draft: true, data })
    }
    return Response.json({ edited: true, slug: post.slug })
  }

  if (body.action === 'publish') {
    const done = await payload.update({
      collection: 'posts',
      id: post.id,
      draft: false,
      data: { _status: 'published' },
    })
    return Response.json({ published: done._status === 'published', slug: done.slug })
  }

  return Response.json({ error: 'action must be "edit" or "publish"' }, { status: 400 })
}
