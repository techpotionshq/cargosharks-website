/**
 * The setup checklist, as it appears at the top of the dashboard.
 *
 * Written for someone who has never run a freight system: each step says what
 * the thing *is* before it says what to do about it, because "create a rate
 * card" means nothing to an office manager on day one. It disappears entirely
 * once the last step is done — a permanent checklist is clutter, and a product
 * that keeps congratulating you is worse than one that gets out of the way.
 */

import type { SetupState, SetupStepKey } from '../queries'
import { Icon } from '@/ui/icon'
import { Button } from '@/ui/layout'

export interface SetupLabels {
  readonly title: string
  readonly subtitle: string
  readonly progress: string
  readonly start: string
  readonly steps: Record<SetupStepKey, { title: string; description: string; action: string }>
}

export function SetupChecklist({
  state,
  labels,
}: {
  readonly state: SetupState
  readonly labels: SetupLabels
}) {
  if (state.complete) return null

  return (
    <section className="mb-5 overflow-hidden rounded-card border border-brand/25 bg-brand-soft/40">
      <div className="flex flex-wrap items-start gap-4 border-b border-line/60 px-5 py-4">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-brand text-on-brand">
          <Icon name="check" size={18} strokeWidth={2.4} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-title font-semibold text-ink">{labels.title}</h2>
          <p className="mt-0.5 text-body-sm text-ink-muted">{labels.subtitle}</p>
        </div>
        <span className="numeric shrink-0 rounded-full bg-surface px-2.5 py-1 text-caption font-semibold text-ink-muted ring-1 ring-line ring-inset">
          {labels.progress}
        </span>
      </div>

      <ol className="divide-y divide-line/60">
        {state.steps.map((step) => {
          const copy = labels.steps[step.key]
          const isNext = state.next?.key === step.key

          return (
            <li
              key={step.key}
              className={`flex flex-wrap items-center gap-3 px-5 py-3 ${
                isNext ? 'bg-surface/60' : ''
              }`}
            >
              <span
                className={`flex size-5 shrink-0 items-center justify-center rounded-full ${
                  step.done
                    ? 'bg-positive text-on-brand'
                    : 'bg-surface-sunken text-ink-subtle ring-1 ring-line ring-inset'
                }`}
              >
                {step.done ? <Icon name="check" size={12} strokeWidth={3} /> : null}
              </span>

              <div className="min-w-0 flex-1">
                <p
                  className={`text-body font-medium ${
                    step.done ? 'text-ink-subtle line-through' : 'text-ink'
                  }`}
                >
                  {copy.title}
                </p>
                {!step.done ? (
                  <p className="mt-0.5 text-body-sm text-ink-muted">{copy.description}</p>
                ) : null}
              </div>

              {!step.done ? (
                <Button
                  href={step.href}
                  variant={isNext ? 'primary' : 'secondary'}
                  size="sm"
                  iconEnd="chevron-end"
                >
                  {copy.action}
                </Button>
              ) : null}
            </li>
          )
        })}
      </ol>
    </section>
  )
}
