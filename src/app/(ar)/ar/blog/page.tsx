import { BlogFrame } from '@/components/blog/BlogFrame'
import { BlogIndexContent, blogIndexMetadata } from '@/content/pages/blog'
import { blogPath, postsIn } from '@/lib/blog'

/**
 * Rendered per request from the CMS's cached reads (`src/lib/blog.ts`): a
 * publish shows up on the next view, with no build. Not prerendered, because
 * the image is built with no database to read.
 */
export const dynamic = 'force-dynamic'

export function generateMetadata() {
  return blogIndexMetadata('ar')
}

export default async function Page() {
  return (
    <BlogFrame lang="ar" alternate={blogPath('en')}>
      <BlogIndexContent posts={await postsIn('ar')} lang="ar" />
    </BlogFrame>
  )
}
