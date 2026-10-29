import { SolutionPage } from '@/components/SolutionPage'
import { solutionMetadata } from '@/content/pages/solution'
import { solution, solutionPath } from '@/content/solutions'

/**
 * `/freight-forwarding-software-kuwait/`, rendered from its row in `solutions.ts`
 * on the rebuilt template (`SolutionPage`). It is the first page moved; the
 * other market and job pages follow once it is approved.
 */
const slug = 'freight-forwarding-software-kuwait'

export const metadata = solutionMetadata(slug, 'en')

export default function Page() {
  return <SolutionPage item={solution(slug)} lang="en" alternate={solutionPath(slug, 'ar')} />
}
