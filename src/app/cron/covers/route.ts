import config from '@payload-config'
import { getPayload } from 'payload'
import { cover } from '../../../../scripts/blog/generate.mjs'
import type { Media } from '@/payload-types'

/**
 * `POST /cron/covers/`: give every post whose cover is not a stock photo a
 * credited Pexels photograph, drafts and published posts alike.
 *
 * The first posts had generated covers, before drafting moved to Pexels.
 * Run once by hand after that change, and safe to run again: a post whose
 * cover already has a `sourceId` is left alone, and a photo already on the
 * site is never picked twice.
 *
 * `context.silent` keeps the publish hook from announcing an "update" to
 * Slack and IndexNow for a changed image; the blog cache is still refreshed.
 * Same secret as `/cron/blog/`.
 */
export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret) return Response.json({ error: 'CRON_SECRET is not set' }, { status: 503 })
  if (request.headers.get('authorization') !== `Bearer ${secret}`)
    return Response.json({ error: 'unauthorised' }, { status: 401 })

  const payload = await getPayload({ config })
  const stock = await payload.find({
    collection: 'media',
    where: { sourceId: { exists: true } },
    select: { sourceId: true },
    limit: 0,
    pagination: false,
  })
  const used = new Set(stock.docs.flatMap((m) => (m.sourceId ? [m.sourceId] : [])))
  const { docs: posts } = await payload.find({
    collection: 'posts',
    draft: true,
    locale: 'en',
    depth: 1,
    limit: 1000,
  })

  const results = []
  for (const post of posts) {
    const current = typeof post.cover === 'object' ? (post.cover as Media | null) : null
    if (current?.sourceId) continue
    const photo = await cover(post.focusKeyword || post.title, used)
    if (!photo) {
      results.push({ slug: post.slug, replaced: false })
      continue
    }
    used.add(photo.sourceId)
    const media = await payload.create({
      collection: 'media',
      data: {
        alt: post.title,
        sourceId: photo.sourceId,
        credit: photo.credit,
        creditUrl: photo.creditUrl,
      },
      file: {
        data: photo.data,
        mimetype: 'image/webp',
        name: `${post.slug}-${photo.sourceId.replace(':', '-')}.webp`,
        size: photo.data.length,
      },
    })
    // A published post stays published; a draft gets a new draft version.
    await payload.update({
      collection: 'posts',
      id: post.id,
      draft: post._status !== 'published',
      data: { cover: media.id },
      context: { silent: true },
    })
    results.push({ slug: post.slug, replaced: true, photo: photo.sourceId, by: photo.credit })
  }
  return Response.json({ results })
}
