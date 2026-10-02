'use client'

/**
 * The full-page assistant: an inbox beside a conversation.
 *
 * The same two components the dock uses, in a frame with room for both at
 * once. The dock has to choose — a 24rem column cannot show a list and a
 * conversation together — and choosing is right there and wrong here, where
 * the reason somebody navigated to a page at all is that they are working
 * through more than one thing.
 *
 * It fills the viewport rather than the content box, which is what
 * `qb-viewport-page` asks for (`globals.css`). A chat whose composer sits
 * wherever the messages happen to end is a chat you have to scroll to type
 * into — so this page is the one screen in the product where the document does
 * not scroll and the two lists scroll inside themselves instead.
 */

import { useEffect } from 'react'
import { Conversation } from './conversation'
import { ThreadList, type DockLabels } from './assistant-dock'
import { useAssistant } from './use-assistant'
import { Icon } from '@/ui/icon'

export function AssistantPage({
  labels,
  configured,
  locale,
}: {
  readonly labels: DockLabels
  readonly configured: boolean
  /** For the inbox's timestamps — the app's locale, not the browser's. */
  readonly locale: string
}) {
  const assistant = useAssistant(configured)

  /*
    The most recent conversation opens on arrival.

    Someone reaching this page has usually come back to something rather than
    started something, and an empty composer beside a list of twelve threads
    makes them click twice to reach where they already were. Anyone who did
    want a fresh one presses New, which is the button beside the list.
  */
  useEffect(() => {
    if (!assistant.threadId && assistant.threads.length > 0) {
      assistant.open(assistant.threads[0]!.id)
    }
    // Keyed on the list alone: re-running when `threadId` changes would
    // reopen the top thread the moment somebody started a new one.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assistant.threads])

  const current = assistant.threads.find((thread) => thread.id === assistant.threadId)

  return (
    /*
      Flush to the chrome: no card, no canvas margin, no shadow.

      A rounded panel floating in six rems of grey is the right treatment for a
      register — a thing on a desk — and the wrong one for the screen somebody
      is going to spend an hour inside. Here the workspace *is* the page, and
      the only structure is hairlines.
    */
    <div className="qb-viewport-page flex min-h-0 flex-1 overflow-hidden bg-surface">
      {/*
        The inbox, sunken and hairline-separated from the conversation.

        A tone below the surface rather than a border alone, because the two
        halves of this screen are different kinds of thing — a list you scan
        and a document you read — and the eye should not have to work out which
        column it is in.
      */}
      <aside className="hidden w-64 shrink-0 flex-col border-e border-line bg-surface-sunken/40 lg:flex xl:w-72">
        <div className="flex h-14 shrink-0 items-center gap-2 border-b border-line px-4">
          <h2 className="eyebrow me-auto">{labels.threads}</h2>
          <button
            type="button"
            onClick={assistant.startNew}
            className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-caption font-medium text-ink shadow-card transition-colors hover:border-brand hover:text-accent"
          >
            <Icon name="plus" size={13} />
            {labels.newThread}
          </button>
        </div>

        <ThreadList
          labels={labels}
          locale={locale}
          threads={assistant.threads}
          loading={assistant.loadingThreads}
          current={assistant.threadId}
          onOpen={assistant.open}
          onClose={assistant.close}
          className="flex-1 p-2"
        />
      </aside>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {/*
          A header that names the open thread.

          Without it a returning conversation is a wall of messages with no
          statement of what it was about — and the title is the person's own
          first question, which is the most useful label available and cost
          nothing to produce. It is the same height as the inbox's header, so
          the rule across the top of this card is one line rather than two.
        */}
        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-line px-4 sm:px-5">
          <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent ring-1 ring-accent/15">
            <Icon name="assistant" size={15} weight="duotone" />
          </span>
          {/*
            The thread's own title, or a bar in its place while the inbox is
            still arriving. Falling back to "Assistant" for that second and
            then replacing it with the question reads as the header changing
            its mind.
          */}
          {assistant.loadingThreads ? (
            <div className="flex-1">
              <span aria-hidden className="qb-skeleton block h-3.5 w-52 max-w-[60%]" />
            </div>
          ) : (
            <h1 className="min-w-0 flex-1 truncate font-display text-title font-semibold tracking-tight text-ink">
              {current?.title ?? labels.title}
            </h1>
          )}
          <button
            type="button"
            onClick={assistant.startNew}
            className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-caption font-medium text-ink-muted transition-colors hover:bg-surface-sunken hover:text-ink lg:hidden"
          >
            <Icon name="plus" size={13} />
            {labels.newThread}
          </button>
        </header>

        <Conversation
          labels={labels}
          turns={assistant.turns}
          pending={assistant.pending}
          onSend={(question) => assistant.ask(question, labels.emptyReply)}
          loading={assistant.loadingThread}
          configured={configured}
          unreachable={assistant.unreachable}
          serviceMissing={assistant.serviceMissing}
          autoFocus
        />
      </div>
    </div>
  )
}
