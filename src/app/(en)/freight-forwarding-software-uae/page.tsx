import { SolutionPage } from '@/components/SolutionPage'
import { solutionMetadata } from '@/content/pages/solution'
import { solution, solutionPath } from '@/content/solutions'

/**
 * `/freight-forwarding-software-uae/`, rendered from its row in `solutions.ts` on the
 * site's one landing-page template (`SolutionPage`).
 */
const slug = 'freight-forwarding-software-uae'

export const metadata = solutionMetadata(slug, 'en')

export default function Page() {
  return <SolutionPage item={solution(slug)} lang="en" alternate={solutionPath(slug, 'ar')} />
}
