import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { DocPage } from '@/components/DocPage'
import { PostContent, postMetadata } from '@/content/pages/blog'
import { blogPath, getMeta, getPost, postParams } from '@/lib/blog'

/** `/ar/blog/<slug>/` — the Arabic twin of `(en)/blog/[slug]`. */
export const dynamicParams = false

export function generateStaticParams() {
  return postParams('ar')
}

type Props = { params: Promise<{ slug: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const meta = getMeta((await params).slug)
  return meta?.ar ? postMetadata(meta, 'ar') : {}
}

export default async function Page({ params }: Props) {
  const post = getPost((await params).slug, 'ar')
  if (!post) notFound()
  return (
    <DocPage lang="ar" alternate={post.en ? blogPath('en', post.slug) : blogPath('en')}>
      <PostContent post={post} />
    </DocPage>
  )
}
