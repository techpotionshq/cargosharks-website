import { NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
import { usePilotFixtures } from '@/lib/pilot/source'

/**
 * The quotation PDF — bilingual, rendered on demand — FR-EQ-08.
 *
 * The same thin proxy as the invoice route beside it, and for the same reason:
 * Chromium lives in the service image because a browser has no business in the
 * request path that serves the operations board. This resolves the session,
 * hands the actor across one boundary, and streams the bytes back.
 *
 * `?locale=ar` renders the Arabic offer. The two are one template mirrored by
 * `dir`, not two documents that can drift — see `pdf/quotation.ts`.
 *
 * A `GET` because it stores nothing. That is worth stating, since the job
 * document route next door has a sibling server action that *does* store, and
 * the distinction there is load-bearing. Here there is nothing to store: a
 * revision is a new quote row (FR-RT-08), so the record already keeps every
 * version, and this is only ever a rendering of one of them.
 */

export const dynamic = 'force-dynamic'

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })

  // Fixture mode has no database behind it, so there is no quote to render.
  // A 501 with a reason beats a proxy error that reads like the service is down.
  if (usePilotFixtures()) {
    return NextResponse.json(
      { error: 'not_available', detail: 'Document rendering needs a database.' },
      { status: 501 },
    )
  }

  const { id } = await context.params
  const locale = new URL(request.url).searchParams.get('locale') === 'ar' ? 'ar' : 'en'

  const serviceUrl = process.env.SERVICE_URL
  const secret = process.env.INTERNAL_API_SECRET

  if (!serviceUrl || !secret) {
    return NextResponse.json(
      { error: 'not_configured', detail: 'SERVICE_URL and INTERNAL_API_SECRET are required.' },
      { status: 503 },
    )
  }

  const response = await fetch(
    `${serviceUrl.replace(/\/$/, '')}/internal/documents/quotation/${id}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-internal-secret': secret },
      /*
        The actor crosses the boundary and the service stamps it into the
        transaction, so row-level security decides what the document may
        contain exactly as it would in-process. Nothing here filters (§5.2).
      */
      body: JSON.stringify({ actor: session.actor, locale }),
      signal: AbortSignal.timeout(45_000),
    },
  )

  if (!response.ok) {
    // Passed through unchanged: a quote outside this principal's branches is
    // invisible, not forbidden (FR-ID-04).
    return NextResponse.json(
      { error: response.status === 404 ? 'not_found' : 'render_failed' },
      { status: response.status === 404 ? 404 : 502 },
    )
  }

  return new Response(response.body, {
    headers: {
      'content-type': 'application/pdf',
      'content-disposition':
        response.headers.get('content-disposition') ?? `inline; filename="quotation-${locale}.pdf"`,
      'cache-control': 'private, no-store',
    },
  })
}
