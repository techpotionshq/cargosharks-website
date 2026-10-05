import { getSession } from '@/lib/session'
import { usePilotFixtures } from '@/lib/pilot/source'
import { fileRefusal } from '@/lib/file-refusal'
import { mayDownload } from '@/lib/download-access'
import { isUuid } from '@/lib/ids'

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
  // A page for a browser (an expired session following a download link), the
  // same JSON as before for anything else.
  if (!session) return fileRefusal(request, 'unauthenticated')
  // The same rule as the page that links here, before anything else runs, so a
  // role the page refuses is refused here too (R4, `lib/download-access.ts`).
  if (!mayDownload(session, 'manifest')) return fileRefusal(request, 'not_found')

  if (usePilotFixtures()) {
    return fileRefusal(request, 'not_available')
  }

  const { id } = await context.params
  // Not a uuid is not a record, and used to reach the service as a 500 (A17).
  if (!isUuid(id)) return fileRefusal(request, 'not_found')
  const locale = new URL(request.url).searchParams.get('locale') === 'ar' ? 'ar' : 'en'

  const serviceUrl = process.env.SERVICE_URL
  const secret = process.env.INTERNAL_API_SECRET

  if (!serviceUrl || !secret) {
    return fileRefusal(request, 'not_configured')
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
    return fileRefusal(request, response.status === 404 ? 'not_found' : 'render_failed')
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
