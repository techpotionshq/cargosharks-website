import type { Payload } from 'payload'
import { proposeTopics } from '../../scripts/blog/ideate.mjs'
import type { PostMeta } from '@/lib/blog'
import type { Topic } from '@/payload-types'
import { SITE_URL, slack } from './notify'

/**
 * Propose `count` topics from live search signals, save them as `ready` and
 * announce them in one Slack message, each title linking to its row in the
 * admin so a bad one can be rejected before its day comes.
 *
 * Called weekly by `/cron/topics/` (the week's backlog at once, so the queue
 * can be read and pruned in one sitting) and by `/cron/blog/` only when the
 * queue is empty, so a day's post is never skipped for want of a topic.
 */
export async function queueTopics(
  payload: Payload,
  {
    count,
    known,
    posts,
    topics,
  }: { count: number; known: Set<string>; posts: PostMeta[]; topics: Topic[] },
): Promise<Topic[]> {
  const fresh = await proposeTopics({
    known,
    count,
    taken: [
      ...posts.flatMap((post) => [post.en?.title, post.ar?.title]),
      ...topics.flatMap((t) => [t.title, t.targetQuery]),
    ].filter((title): title is string => Boolean(title)),
    existingKeys: new Set(topics.map((t) => t.key).filter((key): key is string => Boolean(key))),
  })
  const saved: Topic[] = []
  for (const t of fresh) {
    saved.push(
      await payload.create({
        collection: 'topics',
        data: {
          key: t.id,
          title: t.title,
          status: 'ready',
          archetype: t.archetype,
          targetQuery: t.targetQuery,
          audience: t.audience,
          angle: t.angle,
          keywords: t.keywords ?? [],
          internalLinks: t.internalLinks ?? [],
        },
      }),
    )
  }
  if (saved.length)
    void slack(
      [
        `:compass: *${saved.length} new blog topics queued* (from live search signals)`,
        ...saved.map((t) => `• <${SITE_URL}/admin/collections/topics/${t.id}|${t.title}>`),
        'Drafted one per day, oldest first. Set a topic to *Rejected* to skip it.',
      ].join('\n'),
    )
  return saved
}
