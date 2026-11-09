import { PricingPage } from '@/components/PricingPage'
import { pricingMetadata } from '@/content/pricing'

/** `/ar/pricing/`: the Arabic twin of `/pricing/`. */
export const metadata = pricingMetadata('ar')

export default function Page() {
  return <PricingPage lang="ar" />
}
