import { DocPage } from '@/components/DocPage'
import { BlogIndexContent, blogIndexMetadata } from '@/content/pages/blog'
import { blogPath, postsIn } from '@/lib/blog'

export const metadata = blogIndexMetadata('ar')

export default function Page() {
  return (
    <DocPage lang="ar" alternate={blogPath('en')}>
      <BlogIndexContent posts={postsIn('ar')} lang="ar" />
    </DocPage>
  )
}
