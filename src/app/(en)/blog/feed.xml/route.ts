import { SITE_URL } from '@/components/StructuredData'
import { blogPath, postsIn } from '@/lib/blog'

/** `/blog/feed.xml`, RSS 2.0 for the English posts, from the CMS's cached reads. */
export const dynamic = 'force-dynamic'

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export async function GET() {
  const items = (await postsIn('en'))
    .map((post) => {
      const url = `${SITE_URL}${blogPath('en', post.slug)}`
      return `<item><title>${esc(post.en!.title)}</title><link>${url}</link><guid>${url}</guid><pubDate>${new Date(`${post.publishedAt}T00:00:00Z`).toUTCString()}</pubDate><description>${esc(post.en!.excerpt)}</description></item>`
    })
    .join('')

  const xml = `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom"><channel><title>CargoSharks blog</title><link>${SITE_URL}/blog/</link><atom:link href="${SITE_URL}/blog/feed.xml" rel="self" type="application/rss+xml"/><description>Freight forwarding and customs brokerage in Kuwait and the Gulf.</description><language>en</language>${items}</channel></rss>`

  return new Response(xml, { headers: { 'content-type': 'application/rss+xml; charset=utf-8' } })
}
