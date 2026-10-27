import { DocPage } from '@/components/DocPage'
import { BlogIndexContent, blogIndexMetadata } from '@/content/pages/blog'
import { blogPath, postsIn } from '@/lib/blog'

export const metadata = blogIndexMetadata('en')

export default function Page() {
  return (
    <DocPage lang="en" alternate={blogPath('ar')}>
      <BlogIndexContent posts={postsIn('en')} lang="en" />
    </DocPage>
  )
}
