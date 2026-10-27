import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { DocPage } from '@/components/DocPage'
import { PostContent, postMetadata } from '@/content/pages/blog'
import { blogPath, getMeta, getPost, postParams } from '@/lib/blog'

/**
 * `/blog/<slug>/`, one file per post at build time. `dynamicParams = false`
 * because a static export has nothing to render an unknown slug with — it is a
 * 404, the same as any other path that is not a file.
 */
export const dynamicParams = false

export function generateStaticParams() {
  return postParams('en')
}

type Props = { params: Promise<{ slug: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const meta = getMeta((await params).slug)
  return meta?.en ? postMetadata(meta, 'en') : {}
}

export default async function Page({ params }: Props) {
  const post = getPost((await params).slug, 'en')
  if (!post) notFound()
  return (
    <DocPage lang="en" alternate={post.ar ? blogPath('ar', post.slug) : blogPath('ar')}>
      <PostContent post={post} />
    </DocPage>
  )
}
