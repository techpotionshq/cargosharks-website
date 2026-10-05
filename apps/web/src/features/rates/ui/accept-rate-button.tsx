'use client'

/**
 * Turn a parsed reply into a buy rate card — the accept the extraction left to a
 * person, FR-RT-10.
 *
 * A single form posting to `acceptRateReply`, which promotes the reply's lines
 * through `groupRateCards`. The refusal — a reply that will not promote cleanly —
 * shows beside the button, because "a port on the reply is no longer on file" is
 * a sentence a coordinator acts on, not a silent no-op.
 */

import { useActionState } from 'react'
import type { ActionState } from '@/lib/form-state'
import { Button } from '@/ui/layout'
import { acceptRateReply } from '../rate-request-actions'

export function AcceptRateButton({
  rateRequestId,
  enquiryId,
  label,
  supersedeLabel,
}: {
  readonly rateRequestId: string
  readonly enquiryId: string
  readonly label: string
  /**
   * The second button, offered when the agent's older card is in the way (R3).
   * A renewal passes none: it is clamped to start where the old card ends.
   */
  readonly supersedeLabel?: string
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(acceptRateReply, {})

  return (
    <div className="flex flex-col items-end gap-1">
      <form action={action}>
        <input type="hidden" name="rateRequestId" value={rateRequestId} />
        <input type="hidden" name="enquiryId" value={enquiryId} />
        <Button type="submit" variant="secondary" size="sm" icon="check" disabled={pending}>
          {label}
        </Button>
      </form>
      {state.message ? (
        <span className="max-w-xs text-end text-micro text-caution">{state.message}</span>
      ) : null}
      {/*
        Only after the refusal has named the older card and its date: the
        person replacing a live rate has just been told which one it is.
      */}
      {supersedeLabel && state.values?.canSupersede === '1' ? (
        <form action={action}>
          <input type="hidden" name="rateRequestId" value={rateRequestId} />
          <input type="hidden" name="enquiryId" value={enquiryId} />
          <input type="hidden" name="supersede" value="1" />
          <Button type="submit" variant="secondary" size="sm" icon="check" disabled={pending}>
            {supersedeLabel}
          </Button>
        </form>
      ) : null}
    </div>
  )
}
