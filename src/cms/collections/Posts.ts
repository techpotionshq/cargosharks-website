import { revalidateTag } from 'next/cache'
import type { CollectionAfterChangeHook, CollectionConfig } from 'payload'
import { indexNow, SITE_URL, slack } from '@/cms/notify'

/** What every cached blog read is tagged with; a publish invalidates it. */
export const BLOG_TAG = 'blog'

/**
 * A publish (or an unpublish, or an edit to something live) refreshes the
 * blog's cached reads, then says so in Slack and tells IndexNow. A draft save
 * does none of that: nothing a reader sees has changed.
 */
const afterChange: CollectionAfterChangeHook = async ({ doc, previousDoc, req, context }) => {
  const live = doc._status === 'published'
  const wasLive = previousDoc?._status === 'published'
  if (!live && !wasLive) return doc
  try {
    revalidateTag(BLOG_TAG, { expire: 0 })
  } catch {
    // Outside a Next request (a seed script, a migration) there is no cache to
    // refresh, and that is fine.
  }
  if (!live || context.silent) return doc
  const full = await req.payload.findByID({
    collection: 'posts',
    id: doc.id,
    locale: 'all',
    depth: 0,
    req,
  })
  const titles = (full.title ?? {}) as Partial<Record<'en' | 'ar', string>>
  const urls = [
    titles.en && `${SITE_URL}/blog/${doc.slug}/`,
    titles.ar && `${SITE_URL}/ar/blog/${doc.slug}/`,
  ].filter((url): url is string => Boolean(url))
  const links = [
    titles.en && `<${SITE_URL}/blog/${doc.slug}/|English>`,
    titles.ar && `<${SITE_URL}/ar/blog/${doc.slug}/|العربية>`,
  ].filter(Boolean)
  void slack(
    `${wasLive ? ':pencil2: *Updated on cargosharks.com*' : ':rocket: *Published on cargosharks.com*'}\n*${titles.en ?? titles.ar}*\n${links.join(' · ')}`,
  )
  void indexNow([...urls, `${SITE_URL}/blog/`, `${SITE_URL}/ar/blog/`])
  return doc
}

export const Posts: CollectionConfig = {
  slug: 'posts',
  admin: {
    group: 'Content',
    useAsTitle: 'title',
    defaultColumns: ['title', 'slug', 'source', 'publishedAt', '_status'],
    preview: (doc) => `${SITE_URL}/preview?slug=${encodeURIComponent(String(doc.slug ?? ''))}`,
  },
  access: {
    // The Local API runs with access overridden, so `src/lib/blog.ts` filters
    // on `_status` itself as well; this is what the REST API sees.
    read: ({ req }) => (req.user ? true : { _status: { equals: 'published' } }),
  },
  versions: { drafts: { autosave: { interval: 2000 } }, maxPerDoc: 25 },
  hooks: {
    beforeChange: [
      // A published post always has a date to sort by and to print.
      ({ data }) => {
        if (data._status === 'published' && !data.publishedAt)
          data.publishedAt = new Date().toISOString()
        return data
      },
    ],
    afterChange: [afterChange],
    afterDelete: [
      () => {
        try {
          revalidateTag(BLOG_TAG, { expire: 0 })
        } catch {}
      },
    ],
  },
  fields: [
    { name: 'title', type: 'text', localized: true },
    {
      name: 'slug',
      type: 'text',
      required: true,
      unique: true,
      index: true,
      admin: {
        position: 'sidebar',
        description: 'The address: /blog/<slug>/ and /ar/blog/<slug>/. Lowercase, hyphens.',
      },
      validate: (value: unknown) =>
        typeof value === 'string' && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(value)
          ? true
          : 'Lowercase letters, digits and single hyphens only.',
    },
    {
      name: 'excerpt',
      type: 'textarea',
      localized: true,
      // The first posts' excerpts run to ~250 characters; cards clamp them.
      maxLength: 320,
    },
    {
      name: 'body',
      type: 'code',
      localized: true,
      admin: {
        language: 'markdown',
        description:
          'Markdown. ## and ### headings, tables, links. Raw HTML is shown as text, and only http(s), mailto, / and # links render.',
      },
    },
    {
      name: 'faqs',
      type: 'array',
      localized: true,
      labels: { singular: 'FAQ', plural: 'FAQ' },
      admin: { description: 'Shown under the article and published as FAQPage structured data.' },
      fields: [
        { name: 'question', type: 'text', required: true },
        { name: 'answer', type: 'textarea', required: true },
      ],
    },
    {
      type: 'collapsible',
      label: 'Search',
      fields: [
        {
          name: 'metaDescription',
          type: 'textarea',
          localized: true,
          admin: { description: '140 to 160 characters. Falls back to the excerpt.' },
        },
        { name: 'focusKeyword', type: 'text', localized: true },
      ],
    },
    { name: 'cover', type: 'upload', relationTo: 'media', admin: { position: 'sidebar' } },
    {
      name: 'publishedAt',
      type: 'date',
      admin: { position: 'sidebar', date: { pickerAppearance: 'dayOnly' } },
    },
    { name: 'author', type: 'text', defaultValue: 'CargoSharks', admin: { position: 'sidebar' } },
    { name: 'tags', type: 'text', hasMany: true, admin: { position: 'sidebar' } },
    {
      name: 'source',
      type: 'select',
      defaultValue: 'human',
      options: [
        { label: 'Written by a person', value: 'human' },
        { label: 'Drafted by the generator', value: 'ai' },
      ],
      admin: { position: 'sidebar' },
    },
    { name: 'topic', type: 'relationship', relationTo: 'topics', admin: { position: 'sidebar' } },
  ],
}
