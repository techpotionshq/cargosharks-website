import { PricingPage } from '@/components/PricingPage'
import { pricingMetadata } from '@/content/pricing'

/** `/pricing/`: how a quote is built, and the form that asks for one. */
export const metadata = pricingMetadata('en')

export default function Page() {
  return <PricingPage lang="en" />
}
