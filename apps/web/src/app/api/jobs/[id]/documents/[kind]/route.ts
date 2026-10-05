import { getSession } from '@/lib/session'
import { usePilotFixtures } from '@/lib/pilot/source'
import { fileRefusal, reachService } from '@/lib/file-refusal'
import { mayDownload } from '@/lib/download-access'
import { isUuid } from '@/lib/ids'

/**
 * A job document, rendered on demand — preview, not issue.
 *
 * The same thin proxy as the invoice route, and for the same reason: Chromium
 * lives in the service image because a browser has no business in the request
 * path that serves the operations board. This resolves the session, hands the
 * actor across one boundary, and streams the bytes back.
 *
 * Nothing here stores anything. Issuing a document — taking the copy that was
 * handed over, versioning the one before it — is a server action behind
 * `document.generate`, because it is a write and a `GET` must not be one.
 * Somebody's link preview fetching this URL should produce a PDF, not a bill
 * of lading in the customer's portal.
 */

const KINDS = ['house_bill', 'delivery_order', 'packing_list', 'customs_pack'] as const

export const dynamic = 'force-dynamic'

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string; kind: string }> },
): Promise<Response> {
  const session = await getSession()
  // A page for a browser (an expired session following a download link), the
  // same JSON as before for anything else.
  if (!session) return fileRefusal(request, 'unauthenticated')
  // The same rule as the page that links here, before anything else runs, so a
  // role the page refuses is refused here too (R4, `lib/download-access.ts`).
  if (!mayDownload(session, 'jobDocument')) return fileRefusal(request, 'not_found')

  if (usePilotFixtures()) {
    return fileRefusal(request, 'not_available')
  }

  const { id, kind } = await context.params
  // Not a uuid is not a record, and used to reach the service as a 500 (A17).
  if (!isUuid(id)) return fileRefusal(request, 'not_found')
  if (!KINDS.includes(kind as (typeof KINDS)[number])) {
    return fileRefusal(request, 'unknown_kind', { allowed: KINDS })
  }

  const locale = new URL(request.url).searchParams.get('locale') === 'ar' ? 'ar' : 'en'

  const serviceUrl = process.env.SERVICE_URL
  const secret = process.env.INTERNAL_API_SECRET

  if (!serviceUrl || !secret) {
    return fileRefusal(request, 'not_configured')
  }

  // A service that is down or timed out is a failed render, not a 500.
  const response = await reachService(
    `${serviceUrl.replace(/\/$/, '')}/internal/documents/job/${id}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-internal-secret': secret },
      body: JSON.stringify({ actor: session.actor, locale, kind, store: false }),
      signal: AbortSignal.timeout(45_000),
    },
  )

  if (!response || !response.ok) {
    // Passed through unchanged: a job outside this principal's branches is
    // invisible, not forbidden (FR-ID-04).
    return fileRefusal(request, response?.status === 404 ? 'not_found' : 'render_failed')
  }

  return new Response(response.body, {
    headers: {
      'content-type': 'application/pdf',
      'content-disposition':
        response.headers.get('content-disposition') ?? `inline; filename="${kind}.pdf"`,
      'cache-control': 'private, no-store',
    },
  })
}
