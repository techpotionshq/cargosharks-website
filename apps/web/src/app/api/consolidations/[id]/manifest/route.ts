import { NextResponse } from 'next/server'
import { getSession } from '@/lib/session'
import { usePilotFixtures } from '@/lib/pilot/source'

/**
 * The cargo manifest for a consolidation.
 *
 * Streamed every time rather than stored, which is the one place a manifest
 * differs from the documents beside it: the house list is exactly what changes
 * up to the cut-off, so a stored copy would be authoritative and stale at
 * once. After the cut-off nothing changes and every render is identical.
 */

export const dynamic = 'force-dynamic'

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })

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
    `${serviceUrl.replace(/\/$/, '')}/internal/documents/manifest/${id}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-internal-secret': secret },
      body: JSON.stringify({ actor: session.actor, locale }),
      signal: AbortSignal.timeout(45_000),
    },
  )

  if (!response.ok) {
    return NextResponse.json(
      { error: response.status === 404 ? 'not_found' : 'render_failed' },
      { status: response.status === 404 ? 404 : 502 },
    )
  }

  return new Response(response.body, {
    headers: {
      'content-type': 'application/pdf',
      'content-disposition':
        response.headers.get('content-disposition') ?? 'inline; filename="manifest.pdf"',
      'cache-control': 'private, no-store',
    },
  })
}
