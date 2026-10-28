import { ComparisonContent, comparison, comparisonMetadata } from '@/content/pages/comparison'

/**
 * `/compare/spreadsheets/`: `ComparisonContent` driven by its row in
 * `comparisons.ts`. That file says why the four are data rather than four
 * documents, and the editorial rule they follow.
 */
const slug = 'spreadsheets'

export const metadata = comparisonMetadata(slug)

export default function Page() {
  return <ComparisonContent item={comparison(slug)} />
}
