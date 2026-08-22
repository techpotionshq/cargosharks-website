'use client'

/**
 * One click, one draft invoice.
 *
 * The failure line sits under the button rather than in a toast, because the
 * refusals here are sentences somebody has to act on — *"this shipment has
 * revenue in USD and KWD, and an invoice carries one currency"* is an
 * instruction, not a notification, and a message that disappears after four
 * seconds is one the reader has to reproduce to read again.
 */

import { useActionState } from 'react'
import type { ActionState } from '@/lib/form-state'
import { Button } from '@/ui/layout'
import { billJob } from '../form-actions'

export function BillJobButton({
  jobId,
  label,
}: {
  readonly jobId: string
  readonly label: string
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(billJob, {})

  return (
    <form action={action} className="flex flex-col items-end gap-1">
      <input type="hidden" name="jobId" value={jobId} />
      <Button type="submit" variant="secondary" size="sm" icon="invoices" disabled={pending}>
        {label}
      </Button>
      {state.message ? (
        <span className="max-w-xs text-end text-[0.6875rem] text-caution">{state.message}</span>
      ) : null}
    </form>
  )
}
