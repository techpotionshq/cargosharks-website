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
import { toast } from '@/ui/toast'
import { billJob } from '../form-actions'

export function BillJobButton({
  jobId,
  label,
  done,
  open,
}: {
  readonly jobId: string
  readonly label: string
  /** "Draft invoice created" — the click otherwise changed nothing in view. */
  readonly done: string
  /** The link to the draft, which is where the next step happens. */
  readonly open: string
}) {
  /*
    Say so, and say where (QA P2-6). The row leaves the unbilled list as the
    page revalidates, so nothing on screen acknowledged the click and nothing
    led to the draft it made. Announced as the action resolves rather than
    from an effect: by the time an effect would run, this button has gone
    with its row and never runs it. The token is `<invoiceId>:<n>`.
  */
  const [state, action, pending] = useActionState<ActionState, FormData>(async (previous, form) => {
    const result = await billJob(previous, form)
    if (result.ok) {
      const invoiceId = result.ok.replace(/:\d+$/, '')
      toast(done, { href: `/invoices/${invoiceId}`, label: open })
    }
    return result
  }, {})

  return (
    <form action={action} className="flex flex-col items-end gap-1">
      <input type="hidden" name="jobId" value={jobId} />
      <Button type="submit" variant="ghost" size="sm" icon="invoices" disabled={pending}>
        {label}
      </Button>
      {state.message ? (
        <span className="max-w-xs text-end text-micro text-caution">{state.message}</span>
      ) : null}
    </form>
  )
}
