import { DocPage } from '@/components/DocPage'
import { SolutionContent, solutionMetadata } from '@/content/pages/solution'
import { solution, solutionPath } from '@/content/solutions'

/**
 * `/ar/freight-invoicing-software/`, rendered from its row in `solutions.ts`. See that file for
 * what these pages are for and the rule they are written under.
 */
const slug = 'freight-invoicing-software'

export const metadata = solutionMetadata(slug, 'ar')

export default function Page() {
  return (
    <DocPage lang="ar" alternate={solutionPath(slug, 'en')}>
      <SolutionContent item={solution(slug)} lang="ar" />
    </DocPage>
  )
}
