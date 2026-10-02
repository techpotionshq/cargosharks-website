'use client'

/**
 * The reply box under the conversation (D5).
 *
 * A textarea and a send button, in the page rather than in a dialog: a reply
 * is written while reading the thread above it, and a modal would cover the
 * very messages being answered. A failed send keeps the words in the box (the
 * action echoes them back) and says why under it; a sent one clears the box,
 * and the page refreshes with the message on the thread.
 */

import { useActionState, useEffect, useId } from 'react'
import type { ActionState } from '@/lib/form-state'
import { Submit } from '@/ui/form'
import { FOCUS_RING } from '@/ui/control'
import { toast } from '@/ui/toast'
import { replyToCustomer } from '../conversation-actions'

export function ReplyForm({
  enquiryId,
  labels,
}: {
  readonly enquiryId: string
  readonly labels: {
    readonly field: string
    readonly placeholder: string
    readonly hint: string
    readonly send: string
    readonly sending: string
    readonly sent: string
  }
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(replyToCustomer, {})
  const id = useId()
  const error = state.errors?.body ?? state.message

  useEffect(() => {
    if (state.ok) toast(labels.sent)
  }, [state.ok, labels.sent])

  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="enquiryId" value={enquiryId} />
      <label htmlFor={`${id}-body`} className="eyebrow">
        {labels.field}
      </label>
      <textarea
        id={`${id}-body`}
        name="body"
        rows={3}
        required
        maxLength={4096}
        // The customer's language decides the direction, not the screen's.
        dir="auto"
        placeholder={labels.placeholder}
        defaultValue={state.values?.body ?? ''}
        aria-invalid={error ? true : undefined}
        aria-describedby={`${id}-hint`}
        className={`min-h-24 w-full resize-y rounded-sm border bg-surface-sunken px-3 py-2 text-body leading-relaxed text-ink focus:bg-surface ${
          error ? 'border-critical' : 'border-line-strong'
        } ${FOCUS_RING}`}
      />
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <p
          id={`${id}-hint`}
          className="min-w-0 flex-1 text-caption text-ink-muted"
          aria-live="polite"
        >
          {error ? <span className="text-critical">{error}</span> : labels.hint}
        </p>
        <Submit pending={pending} pendingLabel={labels.sending} icon="send">
          {labels.send}
        </Submit>
      </div>
    </form>
  )
}
