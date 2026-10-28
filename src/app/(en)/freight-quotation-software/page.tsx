import { SolutionPage } from '@/components/SolutionPage'
import { solutionMetadata } from '@/content/pages/solution'
import { solution, solutionPath } from '@/content/solutions'

/**
 * `/freight-quotation-software/`, rendered from its row in `solutions.ts` on the
 * site's one landing-page template (`SolutionPage`).
 */
const slug = 'freight-quotation-software'

export const metadata = solutionMetadata(slug, 'en')

export default function Page() {
  return <SolutionPage item={solution(slug)} lang="en" alternate={solutionPath(slug, 'ar')} />
}
