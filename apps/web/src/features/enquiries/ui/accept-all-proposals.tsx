'use client'

/**
 * Confirm every suggestion at once — the one-click fill.
 *
 * One form, one action. The panel beside it shows each value and the line of
 * mail it came from, so a coordinator has already read what they are confirming;
 * this turns twelve clicks into one for the common case where the model read the
 * enquiry correctly. The refusals that matter — a field filled in since — are
 * surfaced by the shared failure line under the list, not swallowed.
 */

import { useActionState } from 'react'
import type { ActionState } from '@/lib/form-state'
import { Button } from '@/ui/layout'
import { acceptAllProposals } from '../form-actions'

export function AcceptAllProposals({
  enquiryId,
  label,
}: {
  readonly enquiryId: string
  readonly label: string
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(acceptAllProposals, {})

  return (
    <form action={action}>
      <input type="hidden" name="enquiryId" value={enquiryId} />
      <Button type="submit" variant="secondary" size="sm" icon="check" disabled={pending}>
        {label}
      </Button>
      {state.message ? <span className="ms-2 text-micro text-caution">{state.message}</span> : null}
    </form>
  )
}
