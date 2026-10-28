import config from '@payload-config'
import { getPayload } from 'payload'
import { knownPaths } from '../../../../scripts/blog/lib.mjs'
import { queueTopics } from '@/cms/ideation'
import { allPosts } from '@/lib/blog'

/**
 * `POST /cron/topics/`: the week's topics, queued at once.
 *
 * A Coolify scheduled task calls this every Sunday (`node scripts/cron.mjs
 * topics`), an hour before that day's draft. `/cron/blog/` then drafts one a
 * day from the queue, oldest first. Twelve rather than seven: a week's posts,
 * with room for the ones someone rejects on reading the list.
 */
export const dynamic = 'force-dynamic'
export const maxDuration = 300

const PER_WEEK = Number(process.env.BLOG_TOPICS_PER_WEEK) || 12

export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret) return Response.json({ error: 'CRON_SECRET is not set' }, { status: 503 })
  if (request.headers.get('authorization') !== `Bearer ${secret}`)
    return Response.json({ error: 'unauthorised' }, { status: 401 })

  const payload = await getPayload({ config })
  const posts = await allPosts()
  const { docs: topics } = await payload.find({ collection: 'topics', limit: 1000 })
  try {
    const saved = await queueTopics(payload, {
      count: PER_WEEK,
      known: knownPaths(posts.map((post) => post.slug)),
      posts,
      topics,
    })
    return Response.json({ queued: saved.length })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('topic run failed', error)
    return Response.json({ error: message }, { status: 500 })
  }
}
