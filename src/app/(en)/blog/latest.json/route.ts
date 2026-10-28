import { allPosts } from '@/lib/blog'

/**
 * `/blog/latest.json`: the newest posts, for the header's Blog menu.
 *
 * The header is on every page, and every marketing page is prerendered with no
 * database. So the menu cannot be handed the posts at build time; it asks for
 * them here when it opens. `allPosts()` is cached under the `blog` tag, so a
 * publish shows up in the menu at once and a menu opening costs no query.
 */
export const dynamic = 'force-dynamic'

const LIMIT = 4

export async function GET() {
  const posts = (await allPosts()).slice(0, LIMIT).map((post) => ({
    slug: post.slug,
    publishedAt: post.publishedAt,
    cover: post.cover ?? null,
    en: post.en ? { title: post.en.title } : null,
    ar: post.ar ? { title: post.ar.title } : null,
  }))
  return Response.json(posts, { headers: { 'cache-control': 'public, max-age=300' } })
}
