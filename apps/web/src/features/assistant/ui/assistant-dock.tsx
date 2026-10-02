'use client'

/**
 * The dock — the assistant as a messaging window, not a modal.
 *
 * A dialog was the wrong shape and it took using it to see why. A modal takes
 * the screen away, and the whole point of this thing is to be asked something
 * *while* doing something else: a coordinator mid-quote wants to know what the
 * agent charged last time, and an overlay that hides the quote makes them
 * choose between the question and the work.
 *
 * So it behaves like the messaging window every one of these people already
 * has open in another tab. Three states, and the middle one is the default:
 *
 *   `closed`     a launcher in the corner
 *   `docked`     a column beside the work, which stays usable
 *   `expanded`   wide, for reading a long thread without leaving the page
 *
 * `/assistant` is the fourth surface and it is a real page rather than a
 * fourth state — somewhere to go when the conversation *is* the task.
 *
 * ## It is not a modal, and that is enforced rather than described
 *
 * No `aria-modal`, no focus trap, no backdrop. Those are the things that make
 * a dialog take the screen away, and leaving them out is what keeps the page
 * behind it live: a person can click a shipment while a question is still
 * running and come back to the answer.
 */

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { Route } from 'next'
import { Icon } from '@/ui/icon'
import { Conversation, type ConversationLabels } from './conversation'
import { useAssistant } from './use-assistant'

export interface DockLabels extends ConversationLabels {
  readonly title: string
  readonly newThread: string
  readonly threads: string
  readonly noThreads: string
  readonly closeThread: string
  readonly expand: string
  readonly collapse: string
  readonly minimise: string
  readonly openFull: string
  readonly loading: string
}

type Size = 'closed' | 'docked' | 'expanded'

/**
 * Remembered across navigations, because a docked panel that closes on every
 * link is a docked panel nobody keeps open. `sessionStorage` rather than a
 * cookie: it is a property of this tab, not of the account, and a second tab
 * opened deliberately should start closed.
 */
const SIZE_KEY = 'qabandi.assistant.size'

export function AssistantDock({
  labels,
  configured,
}: {
  readonly labels: DockLabels
  /**
   * Whether a model key exists, resolved on the server before render.
   *
   * A prop rather than something the panel discovers by asking, because while
   * the dock is closed nothing had asked — so the launcher was offered whether
   * or not it led anywhere, and the only way to find out was to click it.
   */
  readonly configured: boolean
}) {
  const [size, setSize] = useState<Size>('closed')
  const [showThreads, setShowThreads] = useState(false)
  const pathname = usePathname()

  /*
    Not on its own page.

    The dock is mounted in the layout, so without this `/assistant` renders a
    floating launcher on top of the full-screen assistant — offering to open
    the thing already filling the screen. It also means two `useAssistant`
    hooks polling the same inbox for one person looking at one list.
  */
  const onOwnPage = pathname?.startsWith('/assistant') ?? false
  const assistant = useAssistant(configured && !onOwnPage && size !== 'closed')

  useEffect(() => {
    const stored = window.sessionStorage.getItem(SIZE_KEY)
    if (stored === 'docked' || stored === 'expanded') setSize(stored)
  }, [])

  const resize = useCallback((next: Size) => {
    setSize(next)
    window.sessionStorage.setItem(SIZE_KEY, next)
  }, [])

  useEffect(() => {
    if (onOwnPage) return

    function onKey(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        resize(size === 'closed' ? 'docked' : 'closed')
      }
      /*
        Escape collapses rather than closing, and only from expanded.

        In a modal Escape means "give me the page back", which is already true
        here — the page was never taken. Closing on Escape would throw away a
        conversation somebody was reading because they reached for the key out
        of habit.
      */
      if (event.key === 'Escape' && size === 'expanded') resize('docked')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [size, resize, onOwnPage])

  if (onOwnPage) return null

  /*
    No key, no dock.

    Not a disabled button: a launcher that opens a panel whose only content is
    "there is no key" is a click that leads nowhere, and the person who can fix
    it is an administrator who will be on the settings screen rather than
    hunting a greyed-out corner. `/assistant` is still reachable from the nav
    and says what is missing — one discoverable explanation is enough.
  */
  if (!configured) return null

  if (size === 'closed') {
    return (
      <button
        type="button"
        onClick={() => resize('docked')}
        className="fixed bottom-5 end-5 z-40 inline-flex h-11 items-center gap-2 rounded-full bg-brand ps-4 pe-5 text-[0.875rem] font-semibold text-on-brand shadow-lg transition-colors hover:bg-brand-hover"
      >
        <Icon name="assistant" className="h-4 w-4" />
        {labels.title}
        <kbd className="ms-1 rounded-sm bg-on-brand/15 px-1.5 py-0.5 text-[0.6875rem] font-medium">
          ⌘K
        </kbd>
      </button>
    )
  }

  const expanded = size === 'expanded'

  return (
    <section
      aria-label={labels.title}
      className={[
        'fixed bottom-0 end-0 z-40 flex flex-col overflow-hidden border border-line bg-surface shadow-2xl',
        'rounded-t-lg sm:bottom-4 sm:end-4 sm:rounded-lg',
        expanded
          ? 'h-[85vh] w-full sm:w-[min(56rem,calc(100vw-2rem))]'
          : 'h-[32rem] w-full sm:w-[24rem]',
      ].join(' ')}
    >
      <header className="flex items-center gap-1 border-b border-line bg-surface-sunken px-3 py-2">
        <button
          type="button"
          onClick={() => setShowThreads((was) => !was)}
          aria-label={labels.threads}
          aria-expanded={showThreads}
          className="rounded-sm p-1.5 text-ink-muted transition-colors hover:bg-surface hover:text-ink"
        >
          <Icon name="menu" className="h-4 w-4" />
        </button>

        <h2 className="me-auto truncate text-[0.875rem] font-semibold text-ink">{labels.title}</h2>

        <button
          type="button"
          onClick={assistant.startNew}
          aria-label={labels.newThread}
          className="rounded-sm p-1.5 text-ink-muted transition-colors hover:bg-surface hover:text-ink"
        >
          <Icon name="plus" className="h-4 w-4" />
        </button>
        <Link
          href={'/assistant' as Route}
          aria-label={labels.openFull}
          className="rounded-sm p-1.5 text-ink-muted transition-colors hover:bg-surface hover:text-ink"
        >
          <Icon name="external" className="h-4 w-4" />
        </Link>
        <button
          type="button"
          onClick={() => resize(expanded ? 'docked' : 'expanded')}
          aria-label={expanded ? labels.collapse : labels.expand}
          className="rounded-sm p-1.5 text-ink-muted transition-colors hover:bg-surface hover:text-ink"
        >
          <Icon name={expanded ? 'dot' : 'plus'} className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => resize('closed')}
          aria-label={labels.minimise}
          className="rounded-sm p-1.5 text-ink-muted transition-colors hover:bg-surface hover:text-ink"
        >
          <Icon name="close" className="h-4 w-4" />
        </button>
      </header>

      <div className="flex min-h-0 flex-1">
        {showThreads ? (
          <ThreadList
            labels={labels}
            threads={assistant.threads}
            loading={assistant.loadingThreads}
            current={assistant.threadId}
            onOpen={(id) => {
              assistant.open(id)
              if (!expanded) setShowThreads(false)
            }}
            onClose={assistant.close}
            className={expanded ? 'w-64 border-e border-line' : 'w-full'}
          />
        ) : null}

        {/*
          Hidden rather than unmounted when the narrow dock shows its list.

          Unmounting would discard the in-flight question along with the
          scroll position, so a person who opened the list to check something
          while an answer was coming back would lose the answer.
        */}
        <div
          className={[
            'flex min-h-0 flex-1 flex-col',
            showThreads && !expanded ? 'hidden' : 'flex',
          ].join(' ')}
        >
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
    </section>
  )
}

/**
 * When a thread was last spoken to, in the fewest characters that are still
 * unambiguous: a time today, a weekday this week, a date beyond that.
 *
 * Formatted against the *application's* locale rather than the browser's, so
 * an Arabic session does not get English weekdays — and computed on the client
 * only, which is safe here because the inbox itself arrives by fetch after
 * mount. There is no server render of these rows to disagree with.
 */
function when(iso: string, locale: string): string {
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return ''

  const days = (Date.now() - at.getTime()) / 86_400_000
  if (days < 1) return at.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' })
  if (days < 7) return at.toLocaleDateString(locale, { weekday: 'short' })
  return at.toLocaleDateString(locale, { day: 'numeric', month: 'short' })
}

export function ThreadList({
  labels,
  threads,
  current,
  onOpen,
  onClose,
  className,
  locale = 'en',
  loading,
}: {
  readonly labels: Pick<DockLabels, 'threads' | 'noThreads' | 'closeThread'>
  readonly threads: readonly { id: string; title: string; lastMessageAt: string }[]
  readonly current: string | null
  readonly onOpen: (id: string) => void
  readonly onClose: (id: string) => void
  readonly className?: string
  readonly locale?: string
  /** The inbox has not arrived — rows are drawn as placeholders. */
  readonly loading?: boolean
}) {
  return (
    <nav
      aria-label={labels.threads}
      className={`min-h-0 overflow-y-auto overscroll-contain ${className ?? ''}`}
    >
      {loading && threads.length === 0 ? (
        /*
          Rows in the shape of rows, not a spinner. Four of them, which is
          about what an inbox holds — and the list does not jump when the real
          ones land on top of them.
        */
        <ul aria-hidden className="flex flex-col gap-0.5">
          {[62, 78, 54, 70].map((width, row) => (
            <li key={row} className="flex flex-col gap-1.5 rounded-lg px-3 py-2.5">
              <div className="qb-skeleton h-3" style={{ width: `${width}%` }} />
              <div className="qb-skeleton h-2 w-10" />
            </li>
          ))}
        </ul>
      ) : threads.length === 0 ? (
        <p className="px-4 py-4 text-[0.8125rem] leading-relaxed text-ink-muted">
          {labels.noThreads}
        </p>
      ) : (
        <ul className="flex flex-col gap-0.5">
          {threads.map((thread) => {
            const open = thread.id === current
            return (
              <li key={thread.id} className="group/thread relative">
                <button
                  type="button"
                  onClick={() => onOpen(thread.id)}
                  aria-current={open ? 'true' : undefined}
                  /*
                    The whole row is the target, and the open one is marked by
                    lifting it onto the surface — the inbox sits a tone below,
                    so the current thread is the one row that looks like the
                    pane beside it. No coloured edge: a red tick down the side
                    of a list is the chat-app idiom, and the tone difference is
                    already unambiguous.
                  */
                  className={[
                    'flex w-full flex-col gap-0.5 rounded-lg py-2 pe-8 ps-3 text-start transition-colors',
                    open
                      ? 'bg-surface text-ink shadow-card ring-1 ring-line'
                      : 'text-ink-muted hover:bg-surface/70 hover:text-ink',
                  ].join(' ')}
                >
                  <span className="min-w-0 truncate text-[0.8125rem] font-medium">
                    {thread.title}
                  </span>
                  <span className="numeric ps-0 text-[0.6875rem] text-ink-subtle">
                    {when(thread.lastMessageAt, locale)}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => onClose(thread.id)}
                  aria-label={labels.closeThread}
                  /*
                    Always present for keyboard and touch, dimmed until hover for
                    the mouse. `opacity` rather than `hidden`, because an element
                    that is not rendered is not reachable by Tab — and this is the
                    only way to tidy an inbox.
                  */
                  className="absolute end-1.5 top-1.5 rounded-md p-1 text-ink-subtle opacity-0 transition-opacity hover:bg-surface-sunken hover:text-ink focus-visible:opacity-100 group-hover/thread:opacity-100"
                >
                  <Icon name="close" size={13} />
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </nav>
  )
}
