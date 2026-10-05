import { getSession } from '@/lib/session'
import { usePilotFixtures } from '@/lib/pilot/source'
import { fileRefusal } from '@/lib/file-refusal'
import { mayDownload } from '@/lib/download-access'
import { isUuid } from '@/lib/ids'

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
  // A page for a browser (an expired session following a download link), the
  // same JSON as before for anything else.
  if (!session) return fileRefusal(request, 'unauthenticated')
  // The same rule as the page that links here, before anything else runs, so a
  // role the page refuses is refused here too (R4, `lib/download-access.ts`).
  if (!mayDownload(session, 'invoice')) return fileRefusal(request, 'not_found')

  /*
    The pilot renders no documents, and says so.

    Fixture mode has no database behind it, so there is no invoice to render.
    Answering 501 with a reason beats a proxy error that reads like the service
    is down.
  */
  if (usePilotFixtures()) {
    return fileRefusal(request, 'not_available')
  }

  const { id } = await context.params
  // Not a uuid is not a record, and used to reach the service as a 500 (A17).
  if (!isUuid(id)) return fileRefusal(request, 'not_found')
  // Named by the EN and AR buttons; a link that names neither gets the
  // invoice's own language, which the service reads (NEW-6).
  const requested = new URL(request.url).searchParams.get('locale')
  const locale = requested === 'ar' || requested === 'en' ? requested : undefined

  const serviceUrl = process.env.SERVICE_URL
  const secret = process.env.INTERNAL_API_SECRET

  if (!serviceUrl || !secret) {
    return fileRefusal(request, 'not_configured')
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
    return fileRefusal(request, response.status === 404 ? 'not_found' : 'render_failed')
  }

  return new Response(response.body, {
    headers: {
      'content-type': 'application/pdf',
      'content-disposition':
        response.headers.get('content-disposition') ??
        `inline; filename="invoice-${locale ?? 'en'}.pdf"`,
      'cache-control': 'private, no-store',
    },
  })
}
