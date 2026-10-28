import { SolutionPage } from '@/components/SolutionPage'
import { solutionMetadata } from '@/content/pages/solution'
import { solution, solutionPath } from '@/content/solutions'

/**
 * `/ar/arabic-freight-documents/`, rendered from its row in `solutions.ts` on the
 * site's one landing-page template (`SolutionPage`).
 */
const slug = 'arabic-freight-documents'

export const metadata = solutionMetadata(slug, 'ar')

export default function Page() {
  return <SolutionPage item={solution(slug)} lang="ar" alternate={solutionPath(slug, 'en')} />
}
