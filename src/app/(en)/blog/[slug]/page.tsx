import type { Metadata } from 'next'
import { draftMode } from 'next/headers'
import { notFound } from 'next/navigation'
import { DocPage } from '@/components/DocPage'
import { PostContent, postMetadata } from '@/content/pages/blog'
import { blogPath, getMeta, getPost } from '@/lib/blog'

/**
 * `/blog/<slug>/`. An unknown slug is a real 404. With preview on (`/preview`, admins
 * only) the latest draft renders instead of the published version.
 */
export const dynamic = 'force-dynamic'

type Props = { params: Promise<{ slug: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const draft = (await draftMode()).isEnabled
  const meta = await getMeta((await params).slug, { draft })
  if (!meta?.en) notFound()
  return postMetadata(meta, 'en')
}

export default async function Page({ params }: Props) {
  const draft = (await draftMode()).isEnabled
  const post = await getPost((await params).slug, 'en', { draft })
  if (!post) notFound()
  return (
    <DocPage lang="en" alternate={post.ar ? blogPath('ar', post.slug) : blogPath('ar')}>
      <PostContent post={post} />
    </DocPage>
  )
}
