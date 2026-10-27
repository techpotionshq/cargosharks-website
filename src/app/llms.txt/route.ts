import { comparisons } from '@/content/comparisons'
import { solution, solutionPath } from '@/content/solutions'
import { solutionNav } from '@/content/solution-nav'
import { DEMO_URL } from '@/content/copy'
import { SITE_URL } from '@/components/StructuredData'
import { blogPath, postsIn } from '@/lib/blog'

/**
 * `/llms.txt` — the site as an assistant would want it: what the product is,
 * then every page worth citing with one line on what it answers.
 *
 * Built from the same lists as the sitemap and the menus, so a new landing
 * page, comparison or post appears here without anyone remembering to add it.
 * `force-static` for the same reason `sitemap.ts` needs it under export.
 */
export const dynamic = 'force-static'

export function GET() {
  const line = (path: string, title: string, note: string) =>
    `- [${title}](${SITE_URL}${path}): ${note}`

  const body = [
    '# CargoSharks',
    '',
    '> Freight forwarding and customs brokerage software for Kuwait and the Gulf: one record from enquiry and quote through milestones, customs, documents, costs and invoice, built bilingual in Arabic and English.',
    '',
    `A live demo opens without sign-up at ${DEMO_URL}.`,
    '',
    '## Product',
    line('/', 'Home', 'what the product is and who it is for'),
    line('/what-we-do/', 'What we do', 'the full scope, module by module, and what it does not do'),
    '',
    '## By market and by job',
    ...solutionNav.map((item) =>
      line(solutionPath(item.slug, 'en'), solution(item.slug).meta.title.en, item.blurb.en),
    ),
    '',
    '## Comparisons',
    line(
      '/compare/',
      'How we compare',
      'how to evaluate freight software, and who CargoSharks is not for',
    ),
    ...comparisons.map((item) =>
      line(
        `/compare/${item.slug}/`,
        `CargoSharks vs ${item.name}`,
        `an honest comparison with ${item.name}`,
      ),
    ),
    '',
    '## Blog',
    ...postsIn('en').map((post) =>
      line(blogPath('en', post.slug), post.en!.title, post.en!.excerpt),
    ),
    '',
    '## Arabic',
    line(
      '/ar/',
      'الصفحة الرئيسية',
      'the Arabic home page; every landing page and post has an /ar/ twin',
    ),
    '',
  ].join('\n')

  return new Response(body, { headers: { 'content-type': 'text/plain; charset=utf-8' } })
}
