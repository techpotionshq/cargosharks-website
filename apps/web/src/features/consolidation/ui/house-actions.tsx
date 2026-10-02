'use client'

/**
 * The three buttons on a master whose refusals the operator has to read.
 *
 * Attach, detach and split each post to an action that can say no for a reason
 * the operator caused and can fix — no shipment chosen, a house whose costs
 * were already split onto it, every house measuring zero. Posted from a plain
 * server-side form, that reason was thrown, landed on the error boundary, and
 * production redacted it to a generic failure. `useActionState` keeps it, and
 * it sits under the button in the same caution line the cluster button uses,
 * because these are instructions rather than notifications.
 *
 * Close and reverse stay plain forms on the page: neither has a refusal an
 * operator can produce, only guards against a tampered form.
 */

import { useActionState } from 'react'
import type { ActionState } from '@/lib/form-state'
import { Button } from '@/ui/layout'
import { allocateConsolCharge, attachHouse, detachHouse } from '../form-actions'
import { FOCUS_RING } from '@/ui/control'

function Refusal({ message }: { readonly message?: string }) {
  return message ? (
    <span role="alert" className="max-w-xs text-end text-[0.6875rem] text-caution">
      {message}
    </span>
  ) : null
}

export function AttachHouseForm({
  consolidationId,
  jobs,
  label,
  choose,
}: {
  readonly consolidationId: string
  readonly jobs: readonly { readonly id: string; readonly label: string }[]
  readonly label: string
  readonly choose: string
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(attachHouse, {})

  return (
    <form action={action} className="flex flex-col items-end gap-1">
      <span className="flex items-center gap-2">
        <input type="hidden" name="consolidationId" value={consolidationId} />
        <select
          name="jobId"
          required
          aria-label={label}
          aria-invalid={state.errors?.jobId ? true : undefined}
          className="h-8 max-w-56 rounded-sm border border-line bg-surface px-2 text-[0.8125rem] text-ink"
        >
          <option value="">{choose}</option>
          {jobs.map((job) => (
            <option key={job.id} value={job.id}>
              {job.label}
            </option>
          ))}
        </select>
        <Button type="submit" size="sm" variant="secondary" icon="plus" disabled={pending}>
          {label}
        </Button>
      </span>
      <Refusal message={state.errors?.jobId ?? state.message} />
    </form>
  )
}

export function DetachHouseButton({
  consolidationId,
  jobId,
  label,
}: {
  readonly consolidationId: string
  readonly jobId: string
  readonly label: string
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(detachHouse, {})

  return (
    <form action={action} className="flex flex-col items-end gap-1">
      <input type="hidden" name="consolidationId" value={consolidationId} />
      <input type="hidden" name="jobId" value={jobId} />
      <Button type="submit" size="sm" variant="ghost" disabled={pending}>
        {label}
      </Button>
      <Refusal message={state.message} />
    </form>
  )
}

/**
 * Split one master cost.
 *
 * This was a server-side form that called the action and dropped its result,
 * on the reasoning that every refusal was a visible state on the page. They
 * are not: a cost split by chargeable weight reads a figure the house table
 * does not show, so every house can list a volume while the split still
 * refuses for want of a weight — and the operator saw the cost sit unsplit
 * with nothing to say why.
 */
export function AllocateButton({
  consolidationId,
  chargeLineId,
  label,
  manual,
}: {
  readonly consolidationId: string
  readonly chargeLineId: string
  readonly label: string
  /**
   * For a cost split "stated by hand": one amount per house.
   *
   * The action reads `share_<jobId>`, but this form never sent one, so a
   * manual split always stated zero for every house and was refused — the
   * basis was offered and could not be used.
   */
  readonly manual?: {
    readonly currency: string
    readonly houses: readonly { readonly jobId: string; readonly label: string }[]
  }
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(allocateConsolCharge, {})

  return (
    <form action={action} className="flex flex-col items-end gap-1">
      <input type="hidden" name="consolidationId" value={consolidationId} />
      <input type="hidden" name="chargeLineId" value={chargeLineId} />
      {manual
        ? manual.houses.map((house) => {
            // A share that is not an amount comes back on its own box (R3),
            // rather than as a 500 from decimal.js inside the transaction.
            const error = state.errors?.[`share_${house.jobId}`]
            return (
              <span key={house.jobId} className="flex flex-col items-end gap-0.5">
                <label className="flex items-center gap-2 text-[0.75rem] text-ink-muted">
                  <span className="ref numeric">{house.label}</span>
                  <input
                    name={`share_${house.jobId}`}
                    inputMode="decimal"
                    required
                    dir="ltr"
                    placeholder={manual.currency}
                    aria-invalid={error ? true : undefined}
                    defaultValue={state.values?.[`share_${house.jobId}`] ?? ''}
                    className={`h-8 w-28 rounded-sm border border-line-strong bg-surface-sunken px-2 text-end text-[0.8125rem] text-ink focus:bg-surface ${FOCUS_RING}`}
                  />
                </label>
                <Refusal message={error} />
              </span>
            )
          })
        : null}
      <Button type="submit" size="sm" variant="secondary" disabled={pending}>
        {label}
      </Button>
      <Refusal message={state.message} />
    </form>
  )
}
