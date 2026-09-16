'use client'

/**
 * Pick the agents to ask — the near end of rate procurement, FR-RT-10.
 *
 * A checkbox per agent that covers the lane, because asking five agents is one
 * decision made once, not five forms. Agents with no email on file, or already
 * asked for this enquiry, are shown disabled rather than dropped: a coordinator
 * who expected to see an agent and does not would wonder whether coverage is
 * wrong, and "greyed out, already asked" answers that where an absence would not.
 */

import { useActionState } from 'react'
import type { CoveringAgent } from '@/lib/pilot/types'
import type { ActionState } from '@/lib/form-state'
import { Modal } from '@/ui/modal'
import { Button } from '@/ui/layout'
import { Badge } from '@/ui/status'
import { Icon } from '@/ui/icon'
import { requestRates } from '../rate-request-actions'

export function RequestRatesDialog({
  enquiryId,
  agents,
  labels,
}: {
  readonly enquiryId: string
  readonly agents: readonly CoveringAgent[]
  readonly labels: {
    readonly trigger: string
    readonly title: string
    readonly description: string
    readonly send: string
    readonly empty: string
    readonly noEmail: string
    readonly alreadyAsked: string
    readonly transit: string
  }
}) {
  const [state, action, pending] = useActionState<ActionState, FormData>(requestRates, {})
  const selectable = agents.filter((a) => a.hasEmail && !a.alreadyRequested)

  return (
    <Modal
      trigger={({ onClick }) => (
        <button
          type="button"
          onClick={onClick}
          className="inline-flex h-8 items-center gap-1.5 rounded-sm border border-line bg-surface px-3 text-[0.8125rem] font-medium text-ink transition-colors hover:bg-surface-sunken"
        >
          <Icon name="partners" size={15} />
          {labels.trigger}
        </button>
      )}
      title={labels.title}
      description={labels.description}
      icon="partners"
      closeOn={state.ok}
    >
      <form action={action} id="request-rates-form">
        <input type="hidden" name="enquiryId" value={enquiryId} />
        {agents.length === 0 ? (
          <p className="py-4 text-[0.875rem] text-ink-muted">{labels.empty}</p>
        ) : (
          <ul className="divide-y divide-line">
            {agents.map((agent) => {
              const disabled = !agent.hasEmail || agent.alreadyRequested
              return (
                <li key={agent.partnerId} className="flex items-center gap-3 py-2.5">
                  <input
                    type="checkbox"
                    name="partnerId"
                    value={agent.partnerId}
                    defaultChecked={!disabled}
                    disabled={disabled}
                    id={`agent-${agent.partnerId}`}
                    className="size-4 accent-brand"
                  />
                  <label
                    htmlFor={`agent-${agent.partnerId}`}
                    className="min-w-0 flex-1 text-[0.875rem] text-ink"
                    dir="auto"
                  >
                    {agent.name}
                    {agent.transitDays != null ? (
                      <span className="ms-2 text-[0.75rem] text-ink-subtle">
                        {agent.transitDays} {labels.transit}
                      </span>
                    ) : null}
                  </label>
                  {agent.alreadyRequested ? (
                    <Badge tone="muted">{labels.alreadyAsked}</Badge>
                  ) : !agent.hasEmail ? (
                    <Badge tone="caution">{labels.noEmail}</Badge>
                  ) : null}
                </li>
              )
            })}
          </ul>
        )}
        {state.message ? (
          <p className="mt-2 text-[0.8125rem] text-caution">{state.message}</p>
        ) : null}
        <div className="mt-4 flex justify-end">
          <Button
            type="submit"
            variant="primary"
            icon="partners"
            disabled={pending || selectable.length === 0}
          >
            {labels.send}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
