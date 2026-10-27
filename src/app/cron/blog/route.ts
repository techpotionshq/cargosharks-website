import config from '@payload-config'
import { getPayload } from 'payload'
import { draftPost, pickTopic } from '../../../../scripts/blog/generate.mjs'
import { proposeTopics } from '../../../../scripts/blog/ideate.mjs'
import { earlierPosts, knownPaths } from '../../../../scripts/blog/lib.mjs'
import { SITE_URL, slack } from '@/cms/notify'
import { allPosts } from '@/lib/blog'

/**
 * `POST /cron/blog/`: one run of the blog pipeline, straight into the CMS.
 *
 * A Coolify scheduled task calls this once a day (`node scripts/cron.mjs` in
 * this container). It used to be a GitHub workflow that pushed files and
 * opened a pull request; now a draft is a row in `posts`, reviewed and
 * published in `/admin`.
 *
 *   1. Fewer than three topics ready: propose new ones from search signals and
 *      save them as `ready`. An admin rejects any that should not be written.
 *   2. Draft one post from the oldest ready topic, in English and Arabic, and
 *      save it as a draft with its cover. The topic becomes `written`.
 *   3. Tell Slack, with links to preview it and to edit it.
 *
 * `Authorization: Bearer <CRON_SECRET>`; refused without one configured, so an
 * unset secret is a closed endpoint, not an open one.
 */
export const dynamic = 'force-dynamic'
export const maxDuration = 900

const LOW_WATER = 3

export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret) return Response.json({ error: 'CRON_SECRET is not set' }, { status: 503 })
  if (request.headers.get('authorization') !== `Bearer ${secret}`)
    return Response.json({ error: 'unauthorised' }, { status: 401 })

  const payload = await getPayload({ config })
  const posts = await allPosts()
  const { docs: topics } = await payload.find({
    collection: 'topics',
    limit: 1000,
    sort: 'createdAt',
  })
  const { docs: drafts } = await payload.find({
    collection: 'posts',
    draft: true,
    limit: 1000,
    depth: 0,
    select: { slug: true },
  })
  const known = knownPaths(posts.map((post) => post.slug))
  const result: Record<string, unknown> = {}

  try {
    let ready = topics.filter((t) => t.status === 'ready')
    if (ready.length < LOW_WATER) {
      const fresh = await proposeTopics({
        known,
        taken: [
          ...posts.flatMap((post) => [post.en?.title, post.ar?.title]),
          ...topics.flatMap((t) => [t.title, t.targetQuery]),
        ].filter((title): title is string => Boolean(title)),
        existingKeys: new Set(
          topics.map((t) => t.key).filter((key): key is string => Boolean(key)),
        ),
      })
      for (const t of fresh) {
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
        })
      }
      result.ideated = fresh.length
      if (fresh.length) {
        void slack(
          `:compass: *${fresh.length} new blog topics queued*\n${fresh.map((t: { title: string }) => `• ${t.title}`).join('\n')}\nDrafted one a day, oldest first. Set a topic to *rejected* in ${SITE_URL}/admin/collections/topics to skip it.`,
        )
        const { docs } = await payload.find({
          collection: 'topics',
          where: { status: { equals: 'ready' } },
          limit: 1000,
          sort: 'createdAt',
        })
        ready = docs
      }
    }

    const { topic, reason } = pickTopic(ready)
    if (!topic) {
      result.drafted = false
      result.reason = reason
      void slack(`CargoSharks blog: nothing drafted today (${reason}).`)
      return Response.json(result)
    }

    const draft = await draftPost({
      topic,
      known,
      earlier: earlierPosts(posts),
      taken: new Set(drafts.map((d) => d.slug)),
    })

    const cover = draft.cover
      ? await payload.create({
          collection: 'media',
          data: { alt: draft.en.title },
          file: {
            data: draft.cover,
            mimetype: 'image/webp',
            name: `${draft.slug}.webp`,
            size: draft.cover.length,
          },
        })
      : null

    const { body: enBody, ...en } = draft.en
    const { body: arBody, ...ar } = draft.ar
    const post = await payload.create({
      collection: 'posts',
      locale: 'en',
      draft: true,
      data: {
        _status: 'draft',
        slug: draft.slug,
        source: 'ai',
        tags: draft.tags,
        topic: topic.id,
        ...(cover ? { cover: cover.id } : {}),
        ...en,
        body: enBody,
      },
    })
    await payload.update({
      collection: 'posts',
      id: post.id,
      locale: 'ar',
      draft: true,
      data: { ...ar, body: arBody },
    })
    await payload.update({
      collection: 'topics',
      id: topic.id,
      data: { status: 'written', post: post.id },
    })

    const preview = (lang: string) =>
      `${SITE_URL}/preview/?slug=${draft.slug}${lang === 'ar' ? '&lang=ar' : ''}`
    void slack(
      [
        `:test_tube: *New blog draft ready*\n*${draft.en.title}*`,
        `<${preview('en')}|Preview> · <${preview('ar')}|المعاينة> · <${SITE_URL}/admin/collections/posts/${post.id}|Edit and publish in admin>`,
        draft.unlinked.length
          ? `Links removed, no such page: ${draft.unlinked.map((u: string) => `\`${u}\``).join(', ')}`
          : '',
      ]
        .filter(Boolean)
        .join('\n'),
    )
    Object.assign(result, { drafted: true, slug: draft.slug, post: post.id, cover: Boolean(cover) })
    return Response.json(result)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('blog cron failed', error)
    void slack(`CargoSharks blog run failed: ${message}`)
    return Response.json({ ...result, error: message }, { status: 500 })
  }
}
