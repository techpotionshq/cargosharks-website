import type { Metadata } from 'next'
import { draftMode } from 'next/headers'
import { notFound } from 'next/navigation'
import { BlogFrame } from '@/components/blog/BlogFrame'
import { PostContent, postMetadata } from '@/content/pages/blog'
import { blogPath, getMeta, getPost, postsIn } from '@/lib/blog'

/**
 * `/ar/blog/<slug>/`, the Arabic twin of `(en)/blog/[slug]`. An unknown slug is a real 404. With preview on (`/preview`, admins
 * only) the latest draft renders instead of the published version.
 */
export const dynamic = 'force-dynamic'

type Props = { params: Promise<{ slug: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const draft = (await draftMode()).isEnabled
  const meta = await getMeta((await params).slug, { draft })
  if (!meta?.ar) notFound()
  return postMetadata(meta, 'ar')
}

export default async function Page({ params }: Props) {
  const draft = (await draftMode()).isEnabled
  const post = await getPost((await params).slug, 'ar', { draft })
  if (!post) notFound()
  const more = (await postsIn('ar')).filter((other) => other.slug !== post.slug).slice(0, 3)
  return (
    <BlogFrame lang="ar" alternate={post.en ? blogPath('en', post.slug) : blogPath('en')}>
      <PostContent post={post} more={more} />
    </BlogFrame>
  )
}
