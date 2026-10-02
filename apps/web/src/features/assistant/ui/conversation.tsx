'use client'

/**
 * The conversation itself — the part the dock and the full page both render.
 *
 * Extracted because there are two surfaces and they must not drift. A docked
 * panel and a full screen that each grew their own message list would end up
 * disagreeing about how a proposal looks, which is precisely the thing a
 * coordinator has to be able to recognise instantly. One component, two
 * frames.
 *
 * Everything about *where* it sits — size, docking, the thread list — belongs
 * to the frame. Everything about what a turn looks like belongs here.
 *
 * ## It is a record of enquiries, not a chat window
 *
 * Two columns of coloured bubbles is the house style of consumer messaging and
 * it is the wrong borrowing twice over. An answer here is usually a figure
 * somebody is about to act on and often a table, and neither survives being
 * wrapped in a saturated rounded rectangle at 85% width. And the shape of the
 * work is not banter — it is *question, then finding*, the same shape as every
 * other record in this product.
 *
 * So each exchange is set like an entry in a log: the question ruled at the
 * inline start in the display face, the answer beneath it as prose at full
 * measure, a hairline between one exchange and the next. It reads as work that
 * was done rather than as a conversation that happened, which is what somebody
 * scrolling back through Tuesday actually wants.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Icon } from '@/ui/icon'
import { Markdown } from './markdown'
import type { AssistantFailure } from '../failures'

export interface AssistantProposal {
  readonly entity: 'job' | 'enquiry' | 'quote' | 'invoice' | 'customs'
  readonly reference: string
  /** The record's own id — see `recordHref`. */
  readonly targetId: string
  readonly from: string
  readonly to: string
  readonly label: string
  readonly reason?: string
}

export interface Turn {
  readonly role: 'user' | 'assistant'
  readonly content: string
  readonly proposals?: readonly AssistantProposal[]
  /**
   * Which lookups ran, by name.
   *
   * The *name*, never the call. `list_overdue_invoices({"customer":null})` is
   * our schema, and showing it to a coordinator is showing them the plumbing
   * in a language that is not theirs — the interface turns each name into a
   * sentence in the reader's own.
   */
  readonly used?: readonly { name: string }[]
  readonly unavailable?: boolean
  /** Why it is unavailable, as a code the labels word (U1) — `failures.ts`. */
  readonly failure?: AssistantFailure
  readonly truncated?: boolean
  /** Still arriving — renders a caret and suppresses the empty-answer copy. */
  readonly streaming?: boolean
  /** The lookup running right now, by name. Cleared when the turn settles. */
  readonly step?: string
}

export interface ConversationLabels {
  readonly placeholder: string
  readonly ask: string
  readonly composerHint: string
  readonly thinking: string
  readonly emptyTitle: string
  readonly emptyHint: string
  readonly looked: string
  /**
   * One plain sentence per lookup, keyed by the name the stream sends.
   *
   * Data rather than a function, because these props cross the server-to-client
   * boundary and a function has no serialisation — see `labels.ts`.
   */
  readonly tools: Record<string, string>
  readonly toolUnknown: string
  /**
   * Carries `%label%`, substituted below.
   *
   * `%label%` rather than `{label}`, because `next-intl` parses braces as ICU
   * placeholders and throws when the argument is not supplied — and it cannot
   * be supplied here, since the value is only known once a tool starts running
   * on the client.
   */
  readonly checking: string
  readonly confirm: string
  readonly proposalNote: string
  readonly truncated: string
  readonly emptyReply: string
  readonly notConfigured: string
  readonly notConfiguredHint: string
  readonly openSettings: string
  readonly unreachable: string
  readonly unreachableHint: string
  /** No service to run in — `SERVICE_URL` unset (U3). */
  readonly serviceMissing: string
  readonly serviceMissingHint: string
  /** One sentence per failure code, in the reader's language (U1). */
  readonly failures: Record<AssistantFailure, string>
  readonly suggestions: readonly string[]
}

/**
 * Where a proposal's confirm button sends the person: the record itself.
 *
 * The detail page, never a register with a query string. The registers filter
 * by status and by a named filter — not by reference — so a link built from a
 * reference lands on an unfiltered list of a hundred shipments with nothing
 * indicating which one was meant, which is worse than no button at all.
 *
 * A customs proposal carries the *job's* id, because clearance has no screen of
 * its own and the shipment is where it is acted on.
 */
function recordHref(proposal: AssistantProposal): string {
  const segment = {
    job: 'jobs',
    enquiry: 'enquiries',
    quote: 'quotes',
    invoice: 'invoices',
    customs: 'jobs',
  }[proposal.entity]
  return `/${segment}/${encodeURIComponent(proposal.targetId)}`
}

/**
 * The blinking cursor at the point the next word will appear.
 *
 * The same mark in both places it is needed — at the end of an answer still
 * being written, and alone on the line while the model has yet to say anything
 * — because they are the same statement: *this is where the text is coming*.
 * A skeleton was wrong for the second one; bars in the shape of an answer that
 * has not been written yet promise a length nobody has committed to, and they
 * settle into something a different size a second later. A cursor promises
 * only that something is on its way, which is all that is known.
 */
function Caret() {
  return (
    /*
      A dot rather than a bar, and aligned to the middle of the line box.

      `align-middle` is what keeps it on the baseline of whatever text it
      follows — an inline element sized in `em` and nudged with a translate
      sits differently in an empty line than it does after a full stop, which
      is where the stray gap above it came from.
    */
    <span
      aria-hidden
      className="qb-caret ms-1 inline-block size-2 rounded-full bg-brand align-middle"
    />
  )
}

/**
 * What a thread looks like before it has arrived.
 *
 * Two exchanges' worth of bars in the shape the real entries take — a short
 * ruled line for the question, three lines of answer under it. It replaced an
 * "Opening…" notice above the composer, which said that something was
 * happening without saying where, and left the reader looking at the last
 * thread's messages while the next one loaded.
 */
function TranscriptSkeleton() {
  return (
    <div aria-hidden className="flex flex-col gap-8 py-2">
      {[0, 1].map((entry) => (
        <div key={entry} className="flex flex-col gap-3.5">
          <div className="qb-skeleton h-4" style={{ width: entry === 0 ? '42%' : '58%' }} />
          <div className="flex flex-col gap-2">
            <div className="qb-skeleton h-3 w-[92%]" />
            <div className="qb-skeleton h-3 w-[86%]" />
            <div className="qb-skeleton h-3 w-[54%]" />
          </div>
        </div>
      ))}
    </div>
  )
}

export interface ConversationProps {
  readonly labels: ConversationLabels
  readonly turns: readonly Turn[]
  readonly pending: boolean
  readonly onSend: (question: string) => void
  /** A thread is being read back — the transcript renders as a skeleton. */
  readonly loading?: boolean
  readonly autoFocus?: boolean
  /**
   * Whether a model key exists — resolved on the server, before render.
   *
   * The composer is replaced when this is false, because there is genuinely
   * nothing to ask and the fix is a setting.
   */
  readonly configured?: boolean
  /**
   * The service did not answer the last call.
   *
   * A separate state from `configured`, and keeping them apart is the whole
   * point: an administrator who has just added a key must not be told to add
   * one because a worker is down. Shown as a notice above a *live* composer,
   * since the fix is usually somebody starting a process and retrying costs
   * nothing.
   */
  readonly unreachable?: boolean
  /** There is no service to ask — `SERVICE_URL` is not set (U3). */
  readonly serviceMissing?: boolean
}

export function Conversation({
  labels,
  turns,
  pending,
  onSend,
  loading,
  autoFocus,
  configured,
  unreachable,
  serviceMissing,
}: ConversationProps) {
  /*
    A name in, a sentence out. Falls back to the generic line rather than to
    the raw name: a tool added without its label should read as "Looked
    something up", never as `get_supplier_variance` — which is our schema
    leaking onto somebody's screen in a language they do not use.
  */
  const toolLabel = (name: string): string => labels.tools[name] ?? labels.toolUnknown

  const [question, setQuestion] = useState('')
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus()
  }, [autoFocus])

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [turns, pending])

  /*
    The composer grows with the question, up to a cap.

    A single-row box that scrolls internally hides the top of a three-line
    question while it is being written, which is when a person most wants to
    re-read it. Height is reset to `auto` first because `scrollHeight` of an
    element already tall enough only ever grows — measure, then set, or the box
    never shrinks back after a deletion. `useLayoutEffect` so the resize lands
    in the same frame as the keystroke rather than one after it.
  */
  useLayoutEffect(() => {
    const box = inputRef.current
    if (!box) return
    box.style.height = 'auto'
    box.style.height = `${Math.min(box.scrollHeight, 160)}px`
  }, [question])

  const send = useCallback(
    (text: string) => {
      const trimmed = text.trim()
      if (!trimmed || pending) return
      setQuestion('')
      onSend(trimmed)
    },
    [onSend, pending],
  )

  /*
    "Looking…" only while there is nothing else to look at.

    Once a lookup names itself, or the first words arrive, the turn is already
    saying what is happening — and a second progress line beneath it is the
    interface talking about itself.
  */
  const last = turns[turns.length - 1]
  const waiting = pending && (!last || last.role !== 'assistant' || (!last.content && !last.step))
  const empty = turns.length === 0 && !loading

  return (
    <>
      {/*
        A measured column, and the transcript sits at the *bottom* of it.

        Prose at the full width of a 1600px screen is unreadable — the eye
        loses the line on the way back — and a short thread pinned to the top
        of a tall screen leaves a hand's width of nothing between the last
        answer and the box you type into. `justify-end` puts the newest
        exchange where the reader's attention already is: just above the
        composer. The dock is 24rem and never reaches the cap, so one rule
        serves both frames rather than each growing its own.
      */}
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col px-6 py-6 sm:px-8">
          {loading ? (
            <TranscriptSkeleton />
          ) : empty ? (
            /*
              The first screen, and it is a menu rather than a mascot.

              An empty chat is mostly empty by definition; what fills the space
              usefully is the four questions this thing is actually good at,
              because a coordinator who has never used it does not know what to
              type. No large glyph in a circle — it says nothing the heading
              does not, and it is the single most recognisable piece of chatbot
              furniture there is.
            */
            <div className="my-auto flex flex-col gap-5">
              <div className="flex flex-col gap-2">
                <h2 className="font-display text-lg font-semibold tracking-tight text-ink">
                  {labels.emptyTitle}
                </h2>
                <p className="max-w-prose text-[0.8125rem] leading-relaxed text-pretty text-ink-muted">
                  {labels.emptyHint}
                </p>
              </div>

              {configured === false ? null : (
                <ul className="flex flex-col divide-y divide-line border-y border-line">
                  {labels.suggestions.map((suggestion) => (
                    <li key={suggestion}>
                      <button
                        type="button"
                        onClick={() => send(suggestion)}
                        className="group flex w-full items-center gap-3 py-2.5 text-start text-[0.8125rem] text-ink-muted transition-colors hover:text-accent"
                      >
                        <span className="min-w-0 flex-1">{suggestion}</span>
                        <Icon
                          name="arrow-end"
                          size={13}
                          className="shrink-0 text-ink-subtle opacity-0 transition-opacity group-hover:text-accent group-hover:opacity-100"
                        />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : (
            /*
              `mt-auto` rather than `justify-end` on the column: a flex
              container justified to the end clips content taller than itself,
              and the first exchange of a long thread is precisely what
              somebody scrolls back for. Pushed down by a margin, a short
              thread sits above the composer and a long one still starts at
              the top.
            */
            <ol className="mt-auto flex flex-col">
              {turns.map((turn, index) => (
                <li
                  key={index}
                  className={
                    /*
                      The rule sits above each *question*, so it separates one
                      exchange from the next rather than one message from the
                      next — a question and the answer it produced are one
                      entry, and drawing a line between them would say they
                      were two.
                    */
                    turn.role === 'user'
                      ? 'border-t border-line pt-7 first:border-0 first:pt-0'
                      : 'pt-2.5'
                  }
                >
                  {turn.role === 'user' ? (
                    /*
                      The question is a heading, not a bubble and not a ruled
                      quote — no container of any kind. An entry in a log is
                      "what was asked" set as a title with the finding beneath
                      it, and every device that would mark the question as a
                      *message* (a tinted block, a coloured edge, an avatar) is
                      the chat-app idiom coming back in through a side door.
                      The display face at a heavier weight says it already.
                    */
                    <h3 className="font-display text-[1.0625rem] leading-snug font-semibold tracking-tight whitespace-pre-wrap text-ink">
                      {turn.content}
                    </h3>
                  ) : (
                    <div className="flex flex-col gap-3 pb-7">
                      {turn.unavailable ? (
                        <p className="flex items-start gap-2 text-[0.875rem] leading-relaxed text-ink-muted italic">
                          <Icon name="alert" size={14} className="mt-1 shrink-0 text-caution" />
                          {turn.failure ? labels.failures[turn.failure] : turn.content}
                        </p>
                      ) : turn.content ? (
                        <div className="text-ink">
                          <Markdown text={turn.content} />
                          {/*
                            A caret while the words are still arriving, so a
                            pause between fragments reads as "still coming"
                            rather than as a finished, oddly short answer.
                          */}
                          {turn.streaming ? <Caret /> : null}
                        </div>
                      ) : null}

                      {/*
                        What it is doing, while it is doing it.

                        Only while a turn is still arriving and only before
                        there are words: once the answer starts, the answer is
                        the more useful thing on the screen and a progress line
                        beneath it is noise.
                      */}
                      {turn.streaming && !turn.content && turn.step ? (
                        <p className="flex items-center gap-2 text-[0.8125rem] text-ink-muted">
                          <Icon name="search" size={14} className="animate-pulse text-accent" />
                          {labels.checking.replace('%label%', toolLabel(turn.step))}
                        </p>
                      ) : null}

                      {turn.truncated ? (
                        <p className="flex items-center gap-1.5 text-[0.75rem] text-caution">
                          <Icon name="alert" size={13} />
                          {labels.truncated}
                        </p>
                      ) : null}

                      {turn.proposals && turn.proposals.length > 0 ? (
                        <div className="flex flex-col gap-2 rounded-lg border border-line bg-surface-sunken/60 p-3">
                          <p className="text-[0.75rem] leading-snug text-ink-muted">
                            {labels.proposalNote}
                          </p>
                          {turn.proposals.map((proposal) => (
                            <div
                              key={`${proposal.entity}-${proposal.reference}-${proposal.to}`}
                              className="flex flex-wrap items-center justify-between gap-2"
                            >
                              <span className="text-[0.8125rem] text-ink">
                                <span className="ref">{proposal.reference}</span>
                                {' → '}
                                <span className="font-medium">{proposal.label}</span>
                                {proposal.reason ? (
                                  <span className="text-ink-muted"> — {proposal.reason}</span>
                                ) : null}
                              </span>
                              {/*
                                A link to the record, not a submit button.

                                The transition belongs to that screen: the
                                confirmation copy, the fields some transitions
                                require and the optimistic update already live
                                there. Re-implementing any of it here would be a
                                second way to move a shipment, and the second
                                way is the one that drifts.
                              */}
                              <a
                                href={recordHref(proposal)}
                                className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-brand px-3 py-1.5 text-[0.75rem] font-semibold text-on-brand transition-colors hover:bg-brand-hover"
                              >
                                {labels.confirm}
                                <Icon name="arrow-end" size={13} />
                              </a>
                            </div>
                          ))}
                        </div>
                      ) : null}

                      {turn.used && turn.used.length > 0 && !turn.streaming ? (
                        /*
                          A quiet line of what was consulted, in the product's own
                          words — "Checked overdue invoices", not
                          `list_overdue_invoices({"customer":null})`.

                          Worth showing at all because an answer about money is only
                          as trustworthy as its sources, and somebody who can see the
                          overdue register was read believes the figure. What is not
                          worth showing is the function that read it.
                        */
                        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-line pt-2.5 text-[0.6875rem] text-ink-subtle">
                          <Icon name="check" size={11} className="text-positive" />
                          <span>{labels.looked}</span>
                          <span className="text-ink-muted">
                            {turn.used.map((call) => toolLabel(call.name)).join(' · ')}
                          </span>
                        </p>
                      ) : null}
                    </div>
                  )}
                </li>
              ))}

              {waiting ? (
                /*
                  A cursor on an empty line, exactly where the first word will
                  land — so the answer starts writing itself into the space the
                  reader is already looking at, with nothing to replace and
                  nothing to jump.
                */
                <li className="pt-2.5 pb-7" aria-live="polite">
                  <span className="sr-only">{labels.thinking}</span>
                  {/*
                    A line box of the answer's own height, so the dot sits
                    where the first line of text will sit — not on a line of
                    its own measured by an 8px span.
                  */}
                  <span aria-hidden className="flex h-6 items-center">
                    <Caret />
                  </span>
                </li>
              ) : null}
            </ol>
          )}

          <div ref={endRef} />
        </div>
      </div>

      {serviceMissing && configured !== false ? (
        /*
          Not "something is down": nothing is running. The fix is a deployment
          setting an administrator makes once, and saying so is the difference
          between a support call about an outage and a line in the env file.
        */
        <div className="flex shrink-0 items-start gap-2.5 border-t border-caution/25 bg-caution-soft px-4 py-2.5">
          <Icon name="alert" size={14} className="mt-0.5 shrink-0 text-caution" />
          <div className="flex min-w-0 flex-col gap-0.5">
            <p className="text-[0.75rem] font-semibold text-caution">{labels.serviceMissing}</p>
            <p className="text-[0.75rem] text-ink-muted">{labels.serviceMissingHint}</p>
          </div>
        </div>
      ) : null}

      {unreachable && !serviceMissing && configured !== false ? (
        /*
          Above a live composer, not instead of it. The key is set and the
          question is valid; something between here and the model is down, and
          the useful thing a person can do is try again in a minute.
        */
        <div className="flex shrink-0 items-start gap-2.5 border-t border-caution/25 bg-caution-soft px-4 py-2.5">
          <Icon name="alert" size={14} className="mt-0.5 shrink-0 text-caution" />
          <div className="flex min-w-0 flex-col gap-0.5">
            <p className="text-[0.75rem] font-semibold text-caution">{labels.unreachable}</p>
            <p className="text-[0.75rem] text-ink-muted">{labels.unreachableHint}</p>
          </div>
        </div>
      ) : null}

      {configured === false ? (
        /*
          The composer is replaced, not disabled.

          A greyed-out box invites somebody to click it, find nothing happens,
          and conclude the product is broken. Saying what is missing and where
          to fix it turns a dead end into one setting — and this is a state a
          deployment is allowed to be in: nothing in this product requires a
          model.
        */
        <div className="flex shrink-0 flex-wrap items-center gap-3 border-t border-caution/25 bg-caution-soft px-4 py-3">
          <Icon name="alert" size={16} className="shrink-0 text-caution" />
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <p className="text-[0.8125rem] font-semibold text-caution">{labels.notConfigured}</p>
            <p className="text-[0.75rem] text-ink-muted">{labels.notConfiguredHint}</p>
          </div>
          <a
            href="/settings/integrations"
            className="shrink-0 rounded-md bg-brand px-3 py-1.5 text-[0.75rem] font-semibold text-on-brand transition-colors hover:bg-brand-hover"
          >
            {labels.openSettings}
          </a>
        </div>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault()
            send(question)
          }}
          className="shrink-0 border-t border-line"
        >
          {/*
            The composer holds exactly the transcript's measure, so the box you
            type into is the width of the answers you get back. A field that
            spans a 1600px screen under a 42rem column is the detail that makes
            a workspace look assembled rather than designed.
          */}
          <div className="mx-auto w-full max-w-3xl px-6 pt-3.5 pb-4 sm:px-8">
            <div className="flex items-end gap-1.5 rounded-xl border border-line bg-surface-sunken py-1.5 pe-1.5 ps-3.5 transition-colors focus-within:border-line-strong focus-within:bg-surface">
              <textarea
                ref={inputRef}
                rows={1}
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
                onKeyDown={(event) => {
                  // Enter sends; Shift+Enter is a new line. A question here is one
                  // sentence far more often than it is a paragraph.
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault()
                    send(question)
                  }
                }}
                placeholder={labels.placeholder}
                aria-label={labels.placeholder}
                className="max-h-40 min-h-8 flex-1 resize-none bg-transparent py-1 text-[0.875rem] leading-relaxed text-ink placeholder:text-ink-subtle focus:outline-none"
              />
              <button
                type="submit"
                disabled={pending || question.trim() === ''}
                aria-label={labels.ask}
                title={labels.ask}
                className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-brand text-on-brand transition-colors hover:bg-brand-hover disabled:bg-line disabled:text-ink-subtle"
              >
                <Icon
                  name={pending ? 'dot' : 'arrow-end'}
                  size={pending ? 10 : 15}
                  weight={pending ? 'fill' : 'bold'}
                  className={pending ? 'animate-pulse' : undefined}
                />
              </button>
            </div>

            {/*
              The keyboard contract, stated once and quietly. Shift+Enter is
              the half nobody guesses, and a person who does not know it sends
              half a question and then sends the rest as a second one.
            */}
            <p className="mt-2 hidden text-[0.6875rem] text-ink-subtle sm:block">
              {labels.composerHint}
            </p>
          </div>
        </form>
      )}
    </>
  )
}
