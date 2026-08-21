/**
 * The assistant's HTTP surface — route handlers, deliberately not server actions.
 *
 * Two reasons, both of which Next 16 states plainly.
 *
 * **Server actions dispatch one at a time per client.** A question that takes
 * the model several turns can run for the better part of a minute, and every
 * other action that coordinator triggers — saving a milestone, sending a quote
 * — would queue behind it. The assistant is the least urgent thing on the
 * screen and would have become the most blocking.
 *
 * **A server action is a mutation primitive.** Its response carries a
 * re-rendered RSC payload so the page reflects the write. Asking a question
 * changes no record on the page, so all of that is work done and discarded on
 * every turn.
 *
 * One route with an `op`, rather than four files. These share their session
 * resolution, their branch resolution and their failure vocabulary, and
 * splitting them would mean four copies of all three.
 *
 * ## Nothing here can change a business record
 *
 * The service returns proposals as *data*. The panel renders them as links to
 * the record's own screen, where the ordinary action runs under the person's
 * own actor. There is no path from this file to a business write, and that is
 * what keeps the audit trail able to name a person.
 */

import { NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
import type { Session } from '@/lib/session'

export const dynamic = 'force-dynamic'

type Op = 'ask' | 'threads' | 'thread' | 'close'

interface Body {
  readonly op?: unknown
  readonly question?: unknown
  readonly threadId?: unknown
}

function service(): { url: string; secret: string } | null {
  const url = process.env.SERVICE_URL
  const secret = process.env.INTERNAL_API_SECRET
  return url && secret ? { url: url.replace(/\/$/, ''), secret } : null
}

const unavailable = (message: string, status = 503) =>
  NextResponse.json({ ok: false, unavailable: message }, { status })

/** One call into the service, with the session's identity attached. */
async function call(
  path: string,
  session: Session,
  payload: Record<string, unknown>,
  timeoutMs: number,
): Promise<Response> {
  const target = service()
  if (!target) throw new Error('unconfigured')

  return fetch(`${target.url}/internal/ai/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-internal-secret': target.secret },
    body: JSON.stringify({ actor: session.actor, ...payload }),
    cache: 'no-store',
    signal: AbortSignal.timeout(timeoutMs),
  })
}

export async function POST(request: Request): Promise<Response> {
  const session = await getSession()
  if (!session) return NextResponse.json({ ok: false }, { status: 401 })

  /*
    Internal staff only, and refused rather than merely unhelpful.

    A customer contact reaching this would get an assistant scoped by RLS to
    their own shipments, which sounds harmless and is not: the tool
    descriptions, the state vocabulary and the refusal messages are the
    operator's internal language, and none of it is written to be read by a
    customer. The portal is a different surface with a different voice.
  */
  if (session.actor.type !== 'internal') {
    return NextResponse.json({ ok: false }, { status: 403 })
  }

  const body = (await request.json().catch(() => ({}))) as Body
  const op = (typeof body.op === 'string' ? body.op : 'ask') as Op
  const threadId = typeof body.threadId === 'string' ? body.threadId : null

  if (!service()) {
    return unavailable('The assistant runs in the service, which is not configured here.')
  }

  try {
    if (op === 'threads') {
      const response = await call('threads', session, {}, 15_000)
      if (!response.ok) return unavailable('Could not load your conversations.', 502)
      /*
        Carries `configured` as well as the list. The panel asks this once when
        it opens, and the answer decides whether it offers a composer at all —
        telling somebody the key is missing before they type is the difference
        between a setting to change and a minute wasted.
      */
      return NextResponse.json({ ok: true, ...((await response.json()) as object) })
    }

    if (op === 'thread') {
      if (!threadId) return NextResponse.json({ ok: false }, { status: 400 })
      const response = await call('thread', session, { threadId }, 15_000)
      if (!response.ok) return unavailable('Could not open that conversation.', 502)
      return NextResponse.json({ ok: true, ...((await response.json()) as object) })
    }

    if (op === 'close') {
      if (!threadId) return NextResponse.json({ ok: false }, { status: 400 })
      const response = await call('thread/close', session, { threadId }, 15_000)
      if (!response.ok) return unavailable('Could not close that conversation.', 502)
      return NextResponse.json({ ok: true, ...((await response.json()) as object) })
    }

    /* --- ask, streamed --------------------------------------------------- */

    const question = typeof body.question === 'string' ? body.question.trim() : ''
    if (!question) return NextResponse.json({ ok: false }, { status: 400 })

    /*
      The branch the ledger row is filed under — the first this principal holds.

      Right for the single-branch staff who are most users, arbitrary for the
      few who hold several, and consequential for neither: it decides where the
      cost is booked, never what the assistant can see. That is RLS's answer,
      taken from every branch on the actor.
    */
    const branchId = session.actor.branchIds[0]
    if (!branchId) return unavailable('You are not assigned to a branch.')

    /*
      No transcript is posted from the browser.

      A client that sends its own history is a client that can send one it was
      never given — a rewritten "earlier turn" is the cheapest prompt injection
      there is, arriving from an authenticated session and looking exactly like
      the real thing. The service reads the thread back under the same actor.
    */
    const response = await call(
      'assistant/stream',
      session,
      {
        branchId,
        permissions: [...session.permissions],
        locale: session.principal.locale,
        question,
        threadId,
      },
      /*
        Generous, because the loop may take several model calls and somebody is
        watching. Still bounded: a request with no timeout is a tab that spins
        until the person reloads and asks again, doubling the spend.
      */
      180_000,
    )

    if (response.status === 503) {
      const failure = (await response.json().catch(() => ({}))) as { message?: string }
      /*
        Not configured and out of budget both arrive here, and both are "not
        right now" rather than "something broke". The service's own sentence
        says which, so it is passed through rather than replaced.
      */
      return unavailable(failure.message ?? 'The assistant is not available on this deployment.')
    }

    if (!response.ok || !response.body) return unavailable('The assistant could not answer.', 502)

    /*
      The service's stream, passed straight through.

      Not buffered and re-emitted: reading it here to re-serialise would undo
      the streaming entirely, and the events are already in the shape the panel
      wants. `no-transform` matters as much as `no-cache` — a proxy that
      helpfully compresses this will also buffer it.
    */
    return new Response(response.body, {
      headers: {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
      },
    })
  } catch (error) {
    const timedOut = error instanceof Error && error.name === 'TimeoutError'
    return unavailable(
      timedOut
        ? 'The assistant did not answer in time. Try a narrower question.'
        : 'The assistant could not be reached.',
      timedOut ? 504 : 502,
    )
  }
}
