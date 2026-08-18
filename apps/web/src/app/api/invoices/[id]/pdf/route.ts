import { NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
import { usePilotFixtures } from '@/lib/pilot/source'

/**
 * The invoice PDF — bilingual, rendered on demand.
 *
 * A thin proxy, and deliberately so. Chromium lives in the service image
 * because a browser has no business in the request path that serves the
 * operations board, so this resolves the session, hands the actor across one
 * process boundary, and streams the bytes back.
 *
 * `?locale=ar` renders the Arabic document. The two are the same template
 * mirrored by `dir`, not two templates — see `pdf/invoice.ts`.
 */

export const dynamic = 'force-dynamic'

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })

  /*
    The pilot renders no documents, and says so.

    Fixture mode has no database behind it, so there is no invoice to render.
    Answering 501 with a reason beats a proxy error that reads like the service
    is down.
  */
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
    `${serviceUrl.replace(/\/$/, '')}/internal/documents/invoice/${id}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-internal-secret': secret },
      /*
      The actor crosses the boundary, and the service stamps it into the
      transaction — so row-level security decides what the document may
      contain, exactly as it would in-process. Nothing here filters; the
      database does (§5.2).
    */
      body: JSON.stringify({ actor: session.actor, locale }),
      signal: AbortSignal.timeout(45_000),
    },
  )

  if (!response.ok) {
    // 404 is passed through unchanged: an invoice outside this principal's
    // branches is invisible, not forbidden (FR-ID-04).
    return NextResponse.json(
      { error: response.status === 404 ? 'not_found' : 'render_failed' },
      { status: response.status === 404 ? 404 : 502 },
    )
  }

  return new Response(response.body, {
    headers: {
      'content-type': 'application/pdf',
      'content-disposition':
        response.headers.get('content-disposition') ?? `inline; filename="invoice-${locale}.pdf"`,
      'cache-control': 'private, no-store',
    },
  })
}
