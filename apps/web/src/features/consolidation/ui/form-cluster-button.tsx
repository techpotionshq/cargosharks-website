'use client'

/**
 * Turn a suggested grouping into the master it should have been.
 *
 * The job ids ride as repeated hidden inputs rather than a joined string,
 * because `FormData.getAll` is the shape the action reads and a delimiter is
 * one more thing that can be wrong about a set of identifiers.
 *
 * The refusal shown under the button is the one that matters: a suggestion is
 * a list of things nobody has done yet, so by the time somebody clicks, one of
 * those shipments may have been consolidated elsewhere. The action reports
 * what it managed rather than failing the lot, and this is where that lands.
 */

import { useActionState } from 'react'
import type { ActionState } from '@/lib/form-state'
import { Button } from '@/ui/layout'
import { consolidateCluster } from '../form-actions'

export function FormClusterButton({
  branchId,
  mode,
  originId,
  destinationId,
  jobIds,
  label,
}: {
  readonly branchId: string
  readonly mode: string
  readonly originId: string
  readonly destinationId: string
  readonly jobIds: readonly string[]
  readonly label: string
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(consolidateCluster, {})

  return (
    <form action={action} className="flex flex-col items-end gap-1">
      <input type="hidden" name="branchId" value={branchId} />
      <input type="hidden" name="mode" value={mode} />
      <input type="hidden" name="originId" value={originId} />
      <input type="hidden" name="destinationId" value={destinationId} />
      {jobIds.map((id) => (
        <input key={id} type="hidden" name="jobId" value={id} />
      ))}
      <Button type="submit" variant="secondary" size="sm" icon="container" disabled={pending}>
        {label}
      </Button>
      {state.message ? (
        <span className="max-w-xs text-end text-micro text-caution">{state.message}</span>
      ) : null}
    </form>
  )
}
