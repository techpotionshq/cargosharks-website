/**
 * The milestone timeline — Moment 1 (Pilot §2).
 *
 * This is the component the whole tracking page exists to show, and the one a
 * customer reads on a phone that has been handed across a table. Three
 * decisions carry it:
 *
 *   1. **Three dates, never merged.** `planned` is what was promised,
 *      `revised` is what is now expected, `actual` is what happened. The job
 *      schema keeps all three (§6.3) and so does this: showing only the latest
 *      date hides the slip, which is precisely the number the customer is
 *      trying to find out.
 *   2. **The next step is the loudest thing on the page.** A completed
 *      milestone is quiet, the current one is ringed and brand-coloured, and
 *      the remaining ones are hollow. Someone glancing at a phone should get
 *      "where is it now" without reading a word.
 *   3. **The rail is drawn, not implied.** A continuous line through the nodes
 *      is what makes a list of dates read as a journey.
 */

import { Icon } from './icon'

interface TimelineMilestone {
  readonly code: string
  readonly name: string
  readonly plannedAt: Date | null
  readonly revisedAt: Date | null
  readonly actualAt: Date | null
  readonly note?: string | null
}

export interface TimelineProps {
  readonly milestones: readonly TimelineMilestone[]
  /** Formats an instant in the reader's locale and the branch's time zone. */
  readonly formatDate: (date: Date) => string
  readonly labels: {
    readonly planned: string
    readonly revised: string
    readonly completed: string
    readonly next: string
    readonly pending: string
  }
  readonly className?: string
}

export function MilestoneTimeline({ milestones, formatDate, labels, className }: TimelineProps) {
  /** The first incomplete step is "now"; everything after it is ahead. */
  const currentIndex = milestones.findIndex((m) => m.actualAt === null)

  return (
    <ol className={['relative flex flex-col', className].filter(Boolean).join(' ')}>
      {milestones.map((milestone, index) => {
        const done = milestone.actualAt !== null
        const current = index === currentIndex
        const last = index === milestones.length - 1
        /** A revision later than the promise is a slip, and it is shown as one. */
        const slipped =
          !done &&
          milestone.revisedAt !== null &&
          milestone.plannedAt !== null &&
          milestone.revisedAt.getTime() > milestone.plannedAt.getTime()

        return (
          <li key={milestone.code} className="relative flex gap-3.5 pb-5 last:pb-0">
            {/* The rail. Solid behind completed steps, dashed ahead of them. */}
            {last ? null : (
              <span
                aria-hidden="true"
                className={`absolute start-[11px] top-6 bottom-0 w-px ${
                  done ? 'bg-positive/45' : 'bg-line'
                }`}
              />
            )}

            {/*
              Done is green; the step in progress is the accent.

              A completed milestone used to be a white tick on a red disc, and
              on a board where red means *alarm* a column of six red ticks
              reads as six problems. Green says finished, the accent ring says
              "this is where it is now", and the two together let someone see
              progress without reading a word.
            */}
            <span
              className={[
                'relative z-10 mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border-2',
                done
                  ? 'border-positive bg-positive text-on-brand'
                  : current
                    ? 'border-accent bg-surface text-accent ring-4 ring-accent/15'
                    : 'border-line bg-surface text-ink-subtle',
              ].join(' ')}
            >
              {done ? (
                <Icon name="check" size={13} strokeWidth={2.75} />
              ) : (
                <span
                  className={`size-1.5 rounded-full ${current ? 'bg-accent' : 'bg-line-strong'}`}
                />
              )}
            </span>

            <div className="min-w-0 flex-1 pt-0.5">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                <p
                  className={`text-body ${
                    current
                      ? 'font-semibold text-ink'
                      : done
                        ? 'font-medium text-ink'
                        : 'text-ink-muted'
                  }`}
                >
                  {milestone.name}
                </p>
                {milestone.actualAt ? (
                  <time className="numeric shrink-0 text-caption font-medium text-ink-muted">
                    {formatDate(milestone.actualAt)}
                  </time>
                ) : (milestone.revisedAt ?? milestone.plannedAt) ? (
                  <time
                    className={`numeric shrink-0 text-caption ${
                      slipped ? 'font-medium text-caution' : 'text-ink-subtle'
                    }`}
                  >
                    {formatDate((milestone.revisedAt ?? milestone.plannedAt)!)}
                  </time>
                ) : null}
              </div>

              <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-micro text-ink-subtle">
                <span>{done ? labels.completed : current ? labels.next : labels.pending}</span>
                {/*
                  The promise is kept on screen next to the revision. Dropping
                  it is how a two-week slip becomes invisible.
                */}
                {slipped && milestone.plannedAt ? (
                  <span className="numeric line-through">
                    {labels.planned} {formatDate(milestone.plannedAt)}
                  </span>
                ) : null}
              </p>

              {milestone.note ? (
                <p className="mt-1 text-caption text-ink-muted">{milestone.note}</p>
              ) : null}
            </div>
          </li>
        )
      })}
    </ol>
  )
}

/**
 * The same progress, compressed to one row for a board cell.
 *
 * Dots rather than a percentage bar: the operations board's rows are jobs at
 * different stages of *different* templates, and "60%" invites comparison
 * between a sea import and an air export that does not mean anything.
 */
export function MilestoneDots({
  total,
  completed,
  label,
}: {
  readonly total: number
  readonly completed: number
  readonly label?: string
}) {
  return (
    <span className="inline-flex items-center gap-1" title={label} aria-label={label}>
      {Array.from({ length: total }, (_, index) => (
        <span
          key={index}
          className={`size-1.5 rounded-full ${
            index < completed ? 'bg-positive' : 'bg-line-strong opacity-60'
          }`}
        />
      ))}
    </span>
  )
}
