'use client'

/**
 * The client half of a conversation: threads, turns, and one question in flight.
 *
 * A hook rather than a context, because the dock and the full page are never on
 * screen together and neither needs to know about the other's state. A provider
 * would exist only to be read in one place at a time.
 *
 * ## The transcript is the server's, not the browser's
 *
 * Turns are held here to render them, and they are never *sent* anywhere. When
 * a question goes out it carries a thread id and nothing else; the service
 * reads the history back under the same actor. A client that posted its own
 * transcript could post one it was never given, and a rewritten "earlier turn"
 * is the cheapest prompt injection there is — arriving from an authenticated
 * session, looking exactly like the real thing.
 */

import { useCallback, useEffect, useState } from 'react'
import type { AssistantProposal, Turn } from './conversation'

export interface ThreadSummary {
  readonly id: string
  readonly title: string
  readonly lastMessageAt: string
}

/** One server-sent event from the assistant stream. */
type StreamEvent =
  | { readonly type: 'step'; readonly tool: string }
  | { readonly type: 'text'; readonly text: string }
  | {
      readonly type: 'done'
      readonly reply: string
      readonly proposals?: readonly AssistantProposal[]
      readonly used?: readonly string[]
      readonly truncated?: 'turns' | 'tool_calls'
      readonly threadId?: string
      readonly title?: string
    }
  | { readonly type: 'failed'; readonly code: string; readonly message: string }

interface StoredTurn {
  readonly role: 'user' | 'assistant'
  readonly content: string
  readonly proposals?: readonly AssistantProposal[]
  readonly used?: readonly { name: string }[]
}

async function post<T>(body: Record<string, unknown>): Promise<T> {
  const response = await fetch('/api/assistant', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  return (await response.json()) as T
}

export interface Assistant {
  /**
   * The service did not answer.
   *
   * Deliberately *not* folded into "no key is set", which is what an earlier
   * version did — and it produced the worst possible message: an administrator
   * who had just added a key being told to add a key, while the actual fault
   * was a service that was not running.
   *
   * They are different questions with different fixes and different people
   * responsible. Whether a key exists is answered on the server before render
   * and arrives as a prop; whether the service is up can only be discovered by
   * asking it, which is what this reports.
   */
  readonly unreachable: boolean
  readonly threads: readonly ThreadSummary[]
  /**
   * The inbox has not come back yet.
   *
   * Kept apart from "the inbox is empty", which looks identical in state and
   * means the opposite on screen: one is a list about to appear and gets a
   * skeleton, the other is a person with no conversations and gets a sentence.
   * Conflating them showed "Nothing here yet" for a beat every single time the
   * panel opened.
   */
  readonly loadingThreads: boolean
  readonly threadId: string | null
  readonly turns: readonly Turn[]
  readonly pending: boolean
  readonly loadingThread: boolean
  ask(question: string, emptyReply: string): void
  open(threadId: string): void
  startNew(): void
  close(threadId: string): void
  refreshThreads(): void
}

export function useAssistant(active: boolean): Assistant {
  const [threads, setThreads] = useState<readonly ThreadSummary[]>([])
  const [loadingThreads, setLoadingThreads] = useState(true)
  const [unreachable, setUnreachable] = useState(false)
  const [threadId, setThreadId] = useState<string | null>(null)
  const [turns, setTurns] = useState<readonly Turn[]>([])
  const [pending, setPending] = useState(false)
  const [loadingThread, setLoadingThread] = useState(false)

  const refreshThreads = useCallback(() => {
    void post<{ ok: boolean; threads?: ThreadSummary[] }>({ op: 'threads' })
      .then((body) => {
        setThreads(body.threads ?? [])
        setUnreachable(!body.ok)
      })
      .catch(() => {
        setThreads([])
        setUnreachable(true)
      })
      .finally(() => setLoadingThreads(false))
  }, [])

  /*
    Loaded when the surface becomes active, not on mount.

    The dock is rendered on every internal screen and is closed almost all of
    the time; fetching an inbox nobody opened would be a query per page view
    across the whole application, for a list that is only ever read after a
    deliberate click.
  */
  useEffect(() => {
    /*
      Inactive is not loading, and saying otherwise leaves a skeleton forever.

      `loadingThreads` starts true so the inbox draws a placeholder rather than
      an empty list on the way to its first answer. Nothing cleared it when the
      fetch never happened — and on `/assistant` with no model key the surface
      is never active, so the page's `h1` sat behind that flag permanently: a
      grey bar where the title goes, on every unconfigured deployment. It went
      unseen because `/assistant` was in no route list, which is the same gap
      `unswept()` in the e2e harness now fails on.
    */
    if (!active) {
      setLoadingThreads(false)
      return
    }

    setLoadingThreads(true)
    refreshThreads()
  }, [active, refreshThreads])

  /**
   * Read a server-sent stream, handing each event to `onEvent`.
   *
   * Written here rather than pulled in, because `EventSource` cannot POST and
   * this is a POST — the question, the thread and the session all travel in the
   * body. The parsing is the same three rules as the service side: split on a
   * blank line, keep the incomplete tail for the next read, ignore anything
   * that is not a `data:` line.
   */
  const readStream = useCallback(
    async (body: Record<string, unknown>, onEvent: (event: StreamEvent) => void) => {
      const response = await fetch('/api/assistant', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })

      if (!response.ok || !response.body) {
        const failure = (await response.json().catch(() => ({}))) as { unavailable?: string }
        onEvent({
          type: 'failed',
          code: 'unreachable',
          message: failure.unavailable ?? 'The assistant could not answer.',
        })
        return
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffered = ''

      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buffered += decoder.decode(value, { stream: true })

        const events = buffered.split(/\r?\n\r?\n/)
        buffered = events.pop() ?? ''

        for (const event of events) {
          for (const line of event.split(/\r?\n/)) {
            if (!line.startsWith('data:')) continue
            const payload = line.slice(5).trim()
            if (!payload) continue
            try {
              onEvent(JSON.parse(payload) as StreamEvent)
            } catch {
              // A keep-alive or a partial line the split did not catch.
            }
          }
        }
      }
    },
    [],
  )

  const open = useCallback((id: string) => {
    setThreadId(id)
    setLoadingThread(true)
    void post<{ ok: boolean; turns?: StoredTurn[] }>({ op: 'thread', threadId: id })
      .then((body) => {
        setTurns(
          (body.turns ?? []).map((turn) => ({
            role: turn.role,
            content: turn.content,
            proposals: turn.proposals,
            used: turn.used,
          })),
        )
      })
      .catch(() => setTurns([]))
      .finally(() => setLoadingThread(false))
  }, [])

  const startNew = useCallback(() => {
    setThreadId(null)
    setTurns([])
  }, [])

  const ask = useCallback(
    (question: string, emptyReply: string) => {
      if (pending) return

      const opened = !threadId

      /*
        Both turns are appended at once: the question, and an empty answer for
        the stream to fill. Appending the answer only when the first fragment
        arrives would make the list jump under the reader a second after they
        pressed send.
      */
      setTurns((previous) => [
        ...previous,
        { role: 'user', content: question },
        { role: 'assistant', content: '', streaming: true },
      ])
      setPending(true)

      const patch = (change: (turn: Turn) => Turn): void => {
        setTurns((previous) => {
          const next = [...previous]
          const last = next.length - 1
          if (last >= 0 && next[last]!.role === 'assistant') next[last] = change(next[last]!)
          return next
        })
      }

      void readStream({ op: 'ask', question, threadId }, (event) => {
        if (event.type === 'text') {
          patch((turn) => ({ ...turn, content: turn.content + event.text }))
          return
        }

        if (event.type === 'step') {
          patch((turn) => ({ ...turn, step: event.tool }))
          return
        }

        if (event.type === 'failed') {
          // A failed call is not a missing key. The two get different notices
          // because they have different fixes and different people to fix them.
          setUnreachable(event.code === 'unreachable')
          patch(() => ({ role: 'assistant', content: event.message, unavailable: true }))
          return
        }

        /*
          The settled turn replaces what was streamed rather than appending to
          it. The two are normally identical — but the server's copy is the one
          that was *stored*, and a reload must show the same words as the
          screen it replaced.
        */
        patch(() => ({
          role: 'assistant',
          content: event.reply.trim() || emptyReply,
          proposals: event.proposals,
          used: (event.used ?? []).map((name) => ({ name })),
          truncated: Boolean(event.truncated),
        }))

        if (event.threadId) {
          setThreadId(event.threadId)
          // Refreshed only when a thread was created. Reordering the inbox on
          // every reply would move the row a person is reading.
          if (opened) refreshThreads()
        }
      })
        .catch(() => {
          setUnreachable(true)
          patch(() => ({
            role: 'assistant',
            content: 'The assistant could not be reached.',
            unavailable: true,
          }))
        })
        .finally(() => setPending(false))
    },
    [pending, threadId, refreshThreads, readStream],
  )

  const close = useCallback(
    (id: string) => {
      void post({ op: 'close', threadId: id }).finally(() => {
        setThreads((previous) => previous.filter((thread) => thread.id !== id))
        if (id === threadId) startNew()
      })
    },
    [threadId, startNew],
  )

  return {
    unreachable,
    threads,
    loadingThreads,
    threadId,
    turns,
    pending,
    loadingThread,
    ask,
    open,
    startNew,
    close,
    refreshThreads,
  }
}
