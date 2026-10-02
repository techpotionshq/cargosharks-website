/**
 * Panels — the board's unit of meaning.
 *
 * A `Panel` differs from a `Card` in one respect that turns out to matter: it
 * requires a `title` and accepts an `explain`, and the explain line is rendered
 * in the same place at the same size on every panel in the product.
 *
 * That is the single highest-leverage thing in this file for the stated goal —
 * a board a layman can use. A chart with a title tells you what it is called;
 * a chart with one sentence underneath tells you what it is saying and what to
 * do if it looks wrong. Making the slot part of the component, rather than
 * something a call site may or may not remember, is what makes it universal.
 */

import type { Route } from 'next'
import Link from 'next/link'
import type { ReactNode } from 'react'
import { Icon, type IconName } from './icon'

export interface PanelProps {
  readonly title: ReactNode
  /** One sentence: what this panel says, in words a newcomer understands. */
  readonly explain?: ReactNode
  readonly icon?: IconName
  /** Filters, a period switch, a link to the full register. */
  readonly actions?: ReactNode
  /** A "view all" affordance rendered as the panel's footer. */
  readonly footerHref?: string
  readonly footerLabel?: ReactNode
  readonly children: ReactNode
  /** `flush` for a panel whose body is a full-bleed list or table. */
  readonly padding?: 'none' | 'md'
  readonly className?: string
  readonly bodyClassName?: string
}

export function Panel({
  title,
  explain,
  icon,
  actions,
  footerHref,
  footerLabel,
  children,
  padding = 'md',
  className,
  bodyClassName,
}: PanelProps) {
  return (
    <section
      className={['flex flex-col rounded-card border border-line bg-surface', className]
        .filter(Boolean)
        .join(' ')}
    >
      <header className="flex items-start justify-between gap-4 px-5 pt-4 pb-3">
        <div className="flex min-w-0 items-start gap-2.5">
          {icon ? (
            <span className="mt-px flex size-7 shrink-0 items-center justify-center rounded-full bg-surface-sunken text-ink-muted">
              <Icon name={icon} size={15} />
            </span>
          ) : null}
          <div className="min-w-0">
            <h2 className="text-title leading-tight font-semibold text-ink">{title}</h2>
            {explain ? (
              <p className="mt-1 text-body-sm leading-snug text-ink-muted">{explain}</p>
            ) : null}
          </div>
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-1.5">{actions}</div> : null}
      </header>

      <div
        className={[
          'min-w-0 flex-1',
          padding === 'md' ? 'px-5 pb-5' : '',
          padding === 'none' ? 'border-t border-line' : '',
          bodyClassName,
        ]
          .filter(Boolean)
          .join(' ')}
      >
        {children}
      </div>

      {footerHref ? (
        <Link
          href={footerHref as Route}
          className="flex items-center justify-center gap-1.5 border-t border-line px-5 py-2.5 text-body-sm font-medium text-ink-muted transition-colors hover:bg-surface-sunken hover:text-accent"
        >
          {footerLabel}
          <Icon name="chevron-end" size={14} />
        </Link>
      ) : null}
    </section>
  )
}

/**
 * The readout: what a chart says, written out.
 *
 * Lifted straight from the reference boards, and it is the most useful idea in
 * any of them. Beside every plot sits a short list of named facts — "Busiest
 * lane: Shanghai → Shuwaikh", "Worst month for delays: May" — because reading
 * a superlative off a bar chart is a skill, and stating it is free.
 *
 * Values are set in the same weight as the label rather than shouted, since
 * the point is a sentence you read, not a number you compare.
 */
export function Readout({
  facts,
  className,
}: {
  readonly facts: readonly {
    readonly icon?: IconName
    readonly label: ReactNode
    readonly value: ReactNode
    readonly href?: string
  }[]
  readonly className?: string
}) {
  return (
    <dl className={['flex flex-col gap-2.5', className].filter(Boolean).join(' ')}>
      {facts.map((fact, index) => {
        /*
          Both halves can shrink and both truncate.
          The value used to be `shrink-0` on the reasoning that a number must
          never be clipped — right for a number, wrong for the facts that are
          *names*. "Felixstowe → Dubai International Airport" is a legitimate
          value here and it pushed itself straight out of the panel. Capping
          the label at 60% keeps the pair balanced, and `title` on *both* halves
          means the full text is still recoverable.

          Both halves, because the label is the half that actually loses. A
          narrow panel clips "Busiest route" to "Bus…", and with the hover title
          only on the value there was no way to read it back — the fact was
          simply gone, which is worse than not stating it.
        */
        const body = (
          <>
            <dt className="flex min-w-0 max-w-[60%] items-center gap-2 text-body-sm text-ink-muted">
              {fact.icon ? (
                <Icon name={fact.icon} size={14} className="shrink-0 text-ink-subtle" />
              ) : null}
              {/* Two lines before an ellipsis: "Received this …" told nobody
                  anything, and the panel had the height to spare. */}
              <span
                className="line-clamp-2"
                title={typeof fact.label === 'string' ? fact.label : undefined}
              >
                {fact.label}
              </span>
            </dt>
            <dd
              className="line-clamp-2 min-w-0 text-end text-body-sm font-semibold break-words text-ink"
              title={typeof fact.value === 'string' ? fact.value : undefined}
            >
              {fact.value}
            </dd>
          </>
        )

        return fact.href ? (
          <Link
            key={index}
            href={fact.href as Route}
            className="-mx-1.5 flex items-baseline justify-between gap-3 rounded-sm px-1.5 py-0.5 transition-colors hover:bg-surface-sunken"
          >
            {body}
          </Link>
        ) : (
          <div key={index} className="flex items-baseline justify-between gap-3">
            {body}
          </div>
        )
      })}
    </dl>
  )
}

/**
 * An event feed entry.
 *
 * The reference boards all lay this out the same way and it is worth copying
 * exactly: **time on the left**, a dot on a connecting rule, then the event
 * name in bold with a plain-English detail line underneath. The timestamp
 * being first — in its own column, monospaced and aligned — is what makes a
 * column of twenty of these scannable rather than a wall of text.
 */
export function EventRow({
  time,
  date,
  title,
  detail,
  tone = 'muted',
  last = false,
}: {
  readonly time: ReactNode
  readonly date?: ReactNode
  readonly title: ReactNode
  readonly detail?: ReactNode
  readonly tone?: 'brand' | 'positive' | 'caution' | 'critical' | 'muted'
  readonly last?: boolean
}) {
  const dot = {
    brand: 'bg-accent',
    positive: 'bg-positive',
    caution: 'bg-caution',
    critical: 'bg-critical',
    muted: 'bg-line-strong',
  }[tone]

  return (
    <li className="flex gap-3">
      <div className="w-14 shrink-0 pt-0.5 text-end">
        <p className="numeric text-caption font-semibold text-ink">{time}</p>
        {date ? <p className="numeric text-micro text-ink-subtle">{date}</p> : null}
      </div>

      {/* The rule is drawn by the row, not between rows, so the last entry can
          simply omit it rather than needing a wrapper that knows the count. */}
      <div className="flex shrink-0 flex-col items-center pt-1.5">
        <span className={`size-2 rounded-full ${dot}`} />
        {last ? null : <span className="w-px flex-1 bg-line" />}
      </div>

      <div className={`min-w-0 flex-1 ${last ? 'pb-0' : 'pb-4'}`}>
        <p className="text-body-sm leading-tight font-medium text-ink">{title}</p>
        {detail ? (
          <p className="mt-0.5 text-caption leading-snug text-ink-muted">{detail}</p>
        ) : null}
      </div>
    </li>
  )
}
