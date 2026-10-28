import config from '@payload-config'
import { getPayload } from 'payload'
import { draftPost, pickTopic } from '../../../../scripts/blog/generate.mjs'
import { earlierPosts, knownPaths } from '../../../../scripts/blog/lib.mjs'
import { queueTopics } from '@/cms/ideation'
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
 *   1. Topics come from `/cron/topics/` every Sunday. Only an empty queue
 *      makes this run propose a few itself.
 *   2. Draft one post from the oldest ready topic, in English and Arabic, and
 *      save it as a draft with its cover. The topic becomes `written`.
 *   3. Tell Slack, with links to preview it and to edit it.
 *
 * `Authorization: Bearer <CRON_SECRET>`; refused without one configured, so an
 * unset secret is a closed endpoint, not an open one.
 */
export const dynamic = 'force-dynamic'
export const maxDuration = 900

/** Topics proposed when the queue is found empty on a weekday. */
const FALLBACK_TOPICS = 3

// One run at a time. Two overlapping runs both pick the oldest ready topic and
// draft it twice (a retried task, or a manual run during the scheduled one).
// One container serves the site, so a module flag is the whole lock.
let running = false

export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret) return Response.json({ error: 'CRON_SECRET is not set' }, { status: 503 })
  if (request.headers.get('authorization') !== `Bearer ${secret}`)
    return Response.json({ error: 'unauthorised' }, { status: 401 })
  if (running) return Response.json({ error: 'a run is already in progress' }, { status: 409 })
  running = true
  try {
    return await run()
  } finally {
    running = false
  }
}

async function run() {
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
    // The week's topics arrive on Sunday (`/cron/topics/`). Refilling here is
    // only the fallback for an empty queue, so a day is never skipped.
    if (!ready.length) {
      ready = await queueTopics(payload, { count: FALLBACK_TOPICS, known, posts, topics })
      result.ideated = ready.length
    }

    const { topic, reason, duplicates } = pickTopic(ready, known)
    for (const dup of duplicates ?? []) {
      await payload.update({ collection: 'topics', id: dup.id, data: { status: 'rejected' } })
      void slack(
        `CargoSharks blog: topic "${dup.title}" rejected; its search "${dup.targetQuery}" is already a landing page, and a post would compete with it.`,
      )
    }
    if (!topic) {
      result.drafted = false
      result.reason = reason
      void slack(`CargoSharks blog: nothing drafted today (${reason}).`)
      return Response.json(result)
    }

    // Every stock photo already uploaded, published or not, so no two posts
    // share a cover.
    const stock = await payload.find({
      collection: 'media',
      where: { sourceId: { exists: true } },
      select: { sourceId: true },
      limit: 0,
      pagination: false,
    })
    const draft = await draftPost({
      topic,
      known,
      earlier: earlierPosts(posts),
      taken: new Set(drafts.map((d) => d.slug)),
      usedPhotos: new Set(stock.docs.flatMap((m) => (m.sourceId ? [m.sourceId] : []))),
    })

    const cover = draft.cover
      ? await payload.create({
          collection: 'media',
          data: {
            alt: draft.en.title,
            sourceId: draft.cover.sourceId,
            credit: draft.cover.credit,
            creditUrl: draft.cover.creditUrl,
          },
          file: {
            data: draft.cover.data,
            mimetype: 'image/webp',
            name: `${draft.slug}.webp`,
            size: draft.cover.data.length,
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
        draft.flagged?.length
          ? `:warning: *Check before publishing*, the fact-check could not confirm:\n${draft.flagged
              .map((f: { quote: string; reason: string }) => `> ${f.quote}\n_${f.reason}_`)
              .join('\n')}`
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
