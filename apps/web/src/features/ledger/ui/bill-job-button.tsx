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

import { useActionState, useEffect, useRef } from 'react'
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
  const [state, action, pending] = useActionState<ActionState, FormData>(billJob, {})

  /*
    Say so, and say where (QA P2-6). The row leaves the unbilled list as the
    page revalidates, so nothing on screen acknowledged the click and nothing
    led to the draft it made. The token is `<invoiceId>:<n>`.
  */
  const announced = useRef(state.ok)
  useEffect(() => {
    if (!state.ok || state.ok === announced.current) return
    announced.current = state.ok
    const invoiceId = state.ok.replace(/:\d+$/, '')
    toast(done, { href: `/invoices/${invoiceId}`, label: open })
  }, [state.ok, done, open])

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
