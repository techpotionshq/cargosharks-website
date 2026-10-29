import { SolutionPage } from '@/components/SolutionPage'
import { solutionMetadata } from '@/content/pages/solution'
import { solution, solutionPath } from '@/content/solutions'

/**
 * `/ar/freight-forwarding-software-kuwait/`, the Arabic twin, on the same
 * rebuilt template as the English page.
 */
const slug = 'freight-forwarding-software-kuwait'

export const metadata = solutionMetadata(slug, 'ar')

export default function Page() {
  return <SolutionPage item={solution(slug)} lang="ar" alternate={solutionPath(slug, 'en')} />
}
