'use client'

/**
 * "Price it" — FR-EQ-05, and the twenty seconds Moment 2 is sold on.
 *
 * A submit button rather than a dialog, because the whole claim is that it
 * takes no input: the enquiry already carries the lane, the mode, the
 * readiness date and the cargo, and asking for any of it again would be the
 * manual quotation with extra steps.
 *
 * A client component only so the pending state can be shown. `useFormStatus`
 * has to be inside the form it reports on, which is why the button is its own
 * component rather than markup on the page.
 */

import { useActionState } from 'react'
import { useFormStatus } from 'react-dom'
import { priceEnquiry } from '../pricing'
import { Button } from '@/ui/layout'
import type { ActionState } from '@/lib/form-state'

function Submit({ label, working }: { readonly label: string; readonly working: string }) {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" variant="primary" icon="quotes" disabled={pending}>
      {pending ? working : label}
    </Button>
  )
}

export function PriceEnquiryButton({
  enquiryId,
  labels,
}: {
  readonly enquiryId: string
  readonly labels: { readonly price: string; readonly pricing: string }
}) {
  const [state, action] = useActionState<ActionState, FormData>(priceEnquiry, {})

  return (
    <span className="inline-flex flex-col items-end gap-1">
      <form action={action}>
        <input type="hidden" name="enquiryId" value={enquiryId} />
        <Submit label={labels.price} working={labels.pricing} />
      </form>

      {/*
        The refusal, in full, next to the button.

        Every one of them is something the coordinator can act on — load the
        card, set a house margin, raise an RFQ — so a toast that disappears
        would be the wrong shape. It stays until the next attempt.
      */}
      {state.message ? (
        <span className="max-w-xs text-end text-[0.75rem] text-caution">{state.message}</span>
      ) : null}
    </span>
  )
}
