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
    <span role="alert" className="max-w-xs text-end text-micro text-caution">
      {message}
    </span>
  ) : null
}

export function IssueDocumentButton({
  jobId,
  kind,
  label,
  locale,
  other,
  otherLabel,
}: {
  readonly jobId: string
  readonly kind: string
  readonly label: string
  /** The language the main button issues in: the reader's (`issueLocales`). */
  readonly locale: 'en' | 'ar'
  /** The other language, offered beside it as its own smaller button. */
  readonly other: 'en' | 'ar'
  readonly otherLabel: string
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(issueDocument, {})

  /*
    Two forms on one action state, so either language's refusal lands in the
    one caution line below them. A form per language rather than a submitter's
    value, because the hidden field is what the action has always read.
  */
  const issueIn = (language: 'en' | 'ar', text: string, variant: 'secondary' | 'ghost') => (
    <form action={action}>
      <input type="hidden" name="jobId" value={jobId} />
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="locale" value={language} />
      <Button
        size="sm"
        variant={variant}
        type="submit"
        icon={variant === 'secondary' ? 'check' : undefined}
        disabled={pending}
      >
        {text}
      </Button>
    </form>
  )

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex flex-wrap items-center gap-1">
        {issueIn(locale, label, 'secondary')}
        {issueIn(other, otherLabel, 'ghost')}
      </div>
      <Refusal message={state.message} />
    </div>
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
