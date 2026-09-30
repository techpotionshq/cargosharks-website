'use client'

/**
 * Issue and surrender — the two buttons on the documents card that can say no.
 *
 * Both were plain server-side forms, and both refuse for reasons the operator
 * has to read: the service is not configured, the service could not render
 * the bill, the bill was changed to an air waybill since the screen was drawn.
 * Thrown, those reached the error boundary and production redacted them to a
 * generic failure. Here they sit under the button in the caution line the
 * other single-button actions use, because they are instructions and a toast
 * would take the instruction away after four seconds.
 */

import { useActionState } from 'react'
import type { ActionState } from '@/lib/form-state'
import { Button } from '@/ui/layout'
import { issueDocument, surrenderHouseBill } from '../form-actions'

function Refusal({ message }: { readonly message?: string }) {
  return message ? (
    <span role="alert" className="max-w-xs text-end text-[0.6875rem] text-caution">
      {message}
    </span>
  ) : null
}

export function IssueDocumentButton({
  jobId,
  kind,
  label,
}: {
  readonly jobId: string
  readonly kind: string
  readonly label: string
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(issueDocument, {})

  return (
    <form action={action} className="flex flex-col items-end gap-1">
      <input type="hidden" name="jobId" value={jobId} />
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="locale" value="en" />
      <Button size="sm" variant="secondary" type="submit" icon="check" disabled={pending}>
        {label}
      </Button>
      <Refusal message={state.message} />
    </form>
  )
}

export function SurrenderBillButton({
  jobId,
  label,
}: {
  readonly jobId: string
  readonly label: string
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(surrenderHouseBill, {})

  return (
    <form action={action} className="flex flex-col items-end gap-1">
      <input type="hidden" name="jobId" value={jobId} />
      <Button size="sm" variant="ghost" type="submit" disabled={pending}>
        {label}
      </Button>
      <Refusal message={state.message} />
    </form>
  )
}
