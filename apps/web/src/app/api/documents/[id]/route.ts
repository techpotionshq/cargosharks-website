/**
 * Document download.
 *
 * ## Why this lives under `api/`
 *
 * It used to sit at `app/documents/[id]/route.ts`, on the reasoning that App
 * Router has no `api/` requirement — that is a Pages Router habit — and that a
 * person clicking a link to get a file is not calling an API. Both true, and
 * both beside the point: `app/(ops)/documents/page.tsx` already serves
 * `/documents`, and every other register here has an `[id]` detail page. The
 * day somebody adds `app/(ops)/documents/[id]/page.tsx` — the obvious next
 * page — it resolves to the same path as this handler and the **build fails**.
 * A route handler has no business squatting on a register's own URL space.
 *
 * `api/` now means what it says: the handlers that answer to a machine or hand
 * back a file, as opposed to the pages a person reads. Nothing else in the
 * product posts to one — server actions are the only mutation path.
 *
 * ## Nothing links here yet
 *
 * The documents register links each row to its *job*, not to the file, so this
 * is reachable only by typing the URL. It is not dead code to delete: it is the
 * missing half of a screen that lists documents you cannot open. Wiring the
 * register to it is a small change and a deliberate one, because it decides
 * whether a draft is downloadable from a list — see the release check below.
 *
 * **Authorisation is the whole job.** A document id is a UUID in a URL, and a
 * route that streams a file to whoever holds one is a leak with extra steps.
 * So the lookup runs under the caller's own actor, and the RLS policy on
 * `documents` decides what they can see: an internal user sees their branches'
 * files, a customer contact sees their own company's, an agent contact sees
 * the jobs their partner is named on. A document outside that is *not found*
 * rather than *forbidden* — no enumeration signal (FR-ID-04).
 *
 * The public tracking page deliberately does **not** link here. It is
 * authenticated by a reference and a verifier rather than by a session, and
 * carrying that pair into a download URL would put the proof in a query string
 * and in every log along the way. The tracking page lists what is released and
 * points at the portal.
 *
 * Unreleased drafts are refused even to someone who can see them, because a
 * document is not a document until it is issued, and a half-finished bill of
 * lading in a customer's hands is worse than none.
 */

import { NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { assets, documentTypes, documents, systemActor, withActor } from '@qabandi/db'
import { getSession } from '@/lib/session'
import { fileRefusal } from '@/lib/file-refusal'
import { usePilotFixtures } from '@/lib/pilot/source'
import { isUuid } from '@/lib/ids'

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession()
  // A page for a browser (an expired session following a download link), the
  // same JSON as before for anything else.
  if (!session) return fileRefusal(request, 'unauthenticated')

  // Fixture mode has no database and no file store behind it. Without this the
  // lookup below threw, and a person following a document link on the demo
  // got a blank 500 instead of a page saying files are not part of it.
  if (usePilotFixtures()) return fileRefusal(request, 'not_available')

  const { id } = await params

  // Not a uuid is not a document — and used to be a 500 from the cast (A17).
  if (!isUuid(id)) return fileRefusal(request, 'not_found')

  const record = await withActor(session.actor, async (tx) => {
    const [row] = await tx
      .select({
        assetId: documents.assetId,
        releasedAt: documents.releasedAt,
        supersededById: documents.supersededById,
        isCustomerVisible: documentTypes.isCustomerVisible,
      })
      .from(documents)
      .innerJoin(documentTypes, eq(documentTypes.id, documents.documentTypeId))
      .where(eq(documents.id, id))
      .limit(1)
    return row
  })

  // Invisible under RLS and genuinely absent are the same answer here.
  if (!record) {
    return fileRefusal(request, 'not_found')
  }

  /**
   * Somebody outside the operator may only have what the portal would show
   * them — A12.
   *
   * Released, current, and of a type marked for customers: the same three
   * conditions the portal and the tracking page list documents by. This
   * checked only the first, so a customer holding the id of a superseded bill
   * of lading, or of an internal-only document type on their own job, could
   * download it by typing the URL. Internal staff can retrieve any of them —
   * reviewing a draft or an old version is the point of keeping them.
   */
  const customerMayHave =
    record.releasedAt !== null && record.supersededById === null && record.isCustomerVisible
  if (session.actor.type !== 'internal' && !customerMayHave) {
    return fileRefusal(request, 'not_found')
  }

  /*
    The file behind the document, read as the system principal.

    `assets` is scoped for staff only — its policy is false for a customer or
    agent contact — so the join this used to do under the caller's actor found
    nothing for them, and every portal download was a 404 whatever the
    document. The decision is made above, on the document, under the caller's
    own RLS and the three conditions; this reads one asset by the id that
    decision produced, and nothing a caller supplies reaches it.
  */
  const [file] = await withActor(systemActor(), (tx) =>
    tx
      .select({
        storageKey: assets.storageKey,
        fileName: assets.fileName,
        contentType: assets.contentType,
      })
      .from(assets)
      .where(eq(assets.id, record.assetId))
      .limit(1),
  )
  if (!file) return fileRefusal(request, 'not_found')

  const serviceUrl = process.env.SERVICE_URL
  const secret = process.env.INTERNAL_API_SECRET
  if (!serviceUrl || !secret) {
    /**
     * Storage is not reachable from this environment.
     *
     * 503 with a plain explanation rather than a 500 or a broken stream: the
     * record is real and the caller is allowed it, and the only missing piece
     * is infrastructure the operator has not connected yet. Saying so is more
     * useful than an error page, and it is the truth.
     */
    return fileRefusal(request, 'not_configured', { fileName: file.fileName })
  }

  /**
   * The service signs the link; this route never sees the storage credentials.
   *
   * It used to build `${endpoint}/${bucket}/${storageKey}` by hand, which was
   * wrong twice over: unsigned, so it only worked against a public bucket, and
   * it put the object's address in the browser's history whether or not the
   * bytes ever arrived. Signing lives with the credentials, in `apps/service`.
   */
  const signed = await fetch(`${serviceUrl.replace(/\/$/, '')}/internal/files/signed-url`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-internal-secret': secret },
    body: JSON.stringify({ storageKey: file.storageKey, fileName: file.fileName }),
    cache: 'no-store',
  })

  if (!signed.ok) {
    return fileRefusal(request, 'storage_unavailable', { fileName: file.fileName })
  }

  const { url } = (await signed.json()) as { url: string }

  /**
   * Redirect to the object rather than proxying it through the application.
   *
   * A Node process streaming a 40MB bill of lading holds a request open for the
   * duration and gains nothing — the storage layer does this better. `307`
   * preserves the method, and the caching headers matter more than usual here:
   * the URL carries a signature that is valid for anyone who has it, for as
   * long as it lasts.
   */
  return NextResponse.redirect(url, {
    status: 307,
    headers: { 'Cache-Control': 'private, no-store' },
  })
}
