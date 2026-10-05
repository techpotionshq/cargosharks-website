import { DocPage } from '@/components/DocPage'
import { SolutionContent, solutionMetadata } from '@/content/pages/solution'
import { solution, solutionPath } from '@/content/solutions'

/**
 * `/freight-invoicing-software/`, rendered from its row in `solutions.ts`. See that file for
 * what these pages are for and the rule they are written under.
 */
const slug = 'freight-invoicing-software'

export const metadata = solutionMetadata(slug, 'en')

export default function Page() {
  return (
    <DocPage lang="en" alternate={solutionPath(slug, 'ar')}>
      <SolutionContent item={solution(slug)} lang="en" />
    </DocPage>
  )
}
