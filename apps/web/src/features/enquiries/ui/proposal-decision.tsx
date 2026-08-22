'use client'

/**
 * Accept or reject, as two forms rather than one with a mode.
 *
 * Two `<form>` elements posting to two server actions, because the alternative
 * — one form and a hidden `decision` field set by whichever button was
 * clicked — puts the difference between *applying a value to a shipment* and
 * *throwing it away* into a field that JavaScript sets. These are different
 * actions with different permissions checks, and they read as different
 * actions here.
 *
 * The failure line is shared and deliberately sits under both: the refusals
 * that matter are sentences a coordinator has to act on — *"Shanghai matches
 * 2 records, and guessing between them is how the wrong one gets written"* —
 * and a message that appeared beside only one button would be missed.
 */

import { useActionState } from 'react'
import type { ActionState } from '@/lib/form-state'
import { Button } from '@/ui/layout'
import { acceptProposal, rejectProposal } from '../form-actions'

export function ProposalDecision({
  proposalId,
  enquiryId,
  labels,
}: {
  readonly proposalId: string
  readonly enquiryId: string
  readonly labels: { readonly accept: string; readonly reject: string }
}) {
  const [accepted, accept, accepting] = useActionState<ActionState, FormData>(acceptProposal, {})
  const [rejected, reject, rejecting] = useActionState<ActionState, FormData>(rejectProposal, {})

  const message = accepted.message ?? rejected.message

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-2">
        <form action={reject}>
          <input type="hidden" name="proposalId" value={proposalId} />
          <input type="hidden" name="enquiryId" value={enquiryId} />
          <Button type="submit" variant="ghost" size="sm" icon="close" disabled={rejecting}>
            {labels.reject}
          </Button>
        </form>
        <form action={accept}>
          <input type="hidden" name="proposalId" value={proposalId} />
          <input type="hidden" name="enquiryId" value={enquiryId} />
          <Button type="submit" variant="secondary" size="sm" icon="check" disabled={accepting}>
            {labels.accept}
          </Button>
        </form>
      </div>
      {message ? (
        <span className="max-w-xs text-end text-[0.6875rem] text-caution">{message}</span>
      ) : null}
    </div>
  )
}
