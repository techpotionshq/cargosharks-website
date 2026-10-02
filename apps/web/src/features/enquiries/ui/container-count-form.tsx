'use client'

/**
 * The container count, set in place on the enquiry page.
 *
 * One number and a button, beside the price button it unblocks: a sea-FCL
 * enquiry without a count refuses to price, and one that arrived by email or
 * WhatsApp has nowhere else to get it.
 */

import { useActionState } from 'react'
import type { ActionState } from '@/lib/form-state'
import { Button } from '@/ui/layout'
import { setEnquiryContainerCount } from '../form-actions'
import { FOCUS_RING } from '@/ui/control'

export function ContainerCountForm({
  enquiryId,
  current,
  labels,
}: {
  readonly enquiryId: string
  readonly current: number | null
  readonly labels: { readonly field: string; readonly save: string; readonly hint: string }
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(
    setEnquiryContainerCount,
    {},
  )
  const error = state.errors?.containerCount ?? state.message

  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="enquiryId" value={enquiryId} />
      <label className="flex flex-col gap-1">
        <span className="eyebrow">{labels.field}</span>
        <input
          name="containerCount"
          type="number"
          inputMode="numeric"
          min={1}
          step={1}
          required
          defaultValue={state.values?.containerCount ?? current ?? ''}
          className={`h-9 w-24 rounded-sm border border-line-strong bg-surface-sunken px-2 text-[0.875rem] text-ink focus:bg-surface ${FOCUS_RING}`}
        />
      </label>
      <Button type="submit" variant="secondary" size="sm" disabled={pending}>
        {labels.save}
      </Button>
      {error ? (
        <span className="w-full text-[0.75rem] text-caution">{error}</span>
      ) : current === null ? (
        <span className="w-full text-[0.75rem] text-ink-muted">{labels.hint}</span>
      ) : null}
    </form>
  )
}
