import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { MigrateDownArgs, MigrateUpArgs } from '@payloadcms/db-postgres'
import { seedPosts, seedTopics } from '@/cms/seed-content'

/**
 * The content that existed before the CMS: two posts and the topic backlog.
 * A migration rather than a script so it runs exactly once, on the first
 * deploy, in the same step that creates the tables. `silent` keeps the publish
 * hook from announcing a post to Slack and IndexNow that was already live.
 */
export async function up({ payload, req }: MigrateUpArgs): Promise<void> {
  const topicIds = new Map<string, number>()
  for (const t of seedTopics) {
    const doc = await payload.create({
      collection: 'topics',
      req,
      data: {
        key: t.key,
        title: t.title,
        status: t.status,
        archetype: t.archetype,
        targetQuery: t.targetQuery,
        audience: t.audience ?? undefined,
        angle: t.angle ?? undefined,
        expertNote: t.expertNote ?? undefined,
        keywords: [...t.keywords],
        internalLinks: [...t.internalLinks],
      },
    })
    topicIds.set(t.key, doc.id)
  }

  for (const p of seedPosts) {
    // The covers are in public/blog/, where the static site served them from.
    const cover = p.cover
      ? await payload.create({
          collection: 'media',
          req,
          data: { alt: p.en.title },
          file: (() => {
            const data = readFileSync(join(process.cwd(), 'public', 'blog', p.cover))
            return { data, mimetype: 'image/webp', name: p.cover, size: data.length }
          })(),
        })
      : null
    const topic = p.topicKey ? topicIds.get(p.topicKey) : undefined
    const copy = (c: (typeof seedPosts)[number]['en']) => ({
      title: c.title,
      excerpt: c.excerpt,
      metaDescription: c.metaDescription ?? undefined,
      focusKeyword: c.focusKeyword ?? undefined,
      faqs: c.faqs.map((f) => ({ question: f.question, answer: f.answer })),
      body: c.body,
    })
    const draft = p.status !== 'published'
    const post = await payload.create({
      collection: 'posts',
      locale: 'en',
      draft,
      req,
      context: { silent: true },
      data: {
        _status: p.status,
        slug: p.slug,
        publishedAt: p.publishedAt,
        author: p.author,
        tags: [...p.tags],
        source: p.source,
        ...(cover ? { cover: cover.id } : {}),
        ...(topic ? { topic } : {}),
        ...copy(p.en),
      },
    })
    await payload.update({
      collection: 'posts',
      id: post.id,
      locale: 'ar',
      draft,
      req,
      context: { silent: true },
      data: { _status: p.status, ...copy(p.ar) },
    })
    if (topic)
      await payload.update({ collection: 'topics', id: topic, req, data: { post: post.id } })
  }
}

export async function down({ payload, req }: MigrateDownArgs): Promise<void> {
  for (const p of seedPosts)
    await payload.delete({ collection: 'posts', where: { slug: { equals: p.slug } }, req })
  for (const t of seedTopics)
    await payload.delete({ collection: 'topics', where: { key: { equals: t.key } }, req })
}
