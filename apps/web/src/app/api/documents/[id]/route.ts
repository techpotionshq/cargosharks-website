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
import { assets, documents, withActor } from '@qabandi/db'
import { getSession } from '@/lib/session'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  }

  const { id } = await params

  const record = await withActor(session.actor, async (tx) => {
    const [row] = await tx
      .select({
        storageKey: assets.storageKey,
        fileName: assets.fileName,
        contentType: assets.contentType,
        releasedAt: documents.releasedAt,
      })
      .from(documents)
      .innerJoin(assets, eq(assets.id, documents.assetId))
      .where(eq(documents.id, id))
      .limit(1)
    return row
  })

  // Invisible under RLS and genuinely absent are the same answer here.
  if (!record) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }

  /**
   * A customer may only have what has been released.
   *
   * Internal staff can retrieve a draft — reviewing one before it goes out is
   * the point of having drafts — but nobody outside the operator can.
   */
  if (!record.releasedAt && session.actor.type !== 'internal') {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }

  const bucket = process.env.S3_BUCKET
  const endpoint = process.env.S3_ENDPOINT
  if (!bucket || !endpoint) {
    /**
     * Storage is not configured in this environment.
     *
     * 503 with a plain explanation rather than a 500 or a broken stream: the
     * record is real and the caller is allowed it, and the only missing piece
     * is infrastructure the operator has not connected yet. Saying so is more
     * useful than an error page, and it is the truth.
     */
    return NextResponse.json(
      {
        error: 'storage_not_configured',
        message:
          'The file store is not connected in this environment. Set S3_BUCKET and ' +
          'S3_ENDPOINT to enable downloads; the document record itself is intact.',
        fileName: record.fileName,
      },
      { status: 503 },
    )
  }

  /**
   * Redirect to the object rather than proxying it through the application.
   *
   * A Node process streaming a 40MB bill of lading holds a request open for
   * the duration and gains nothing — the storage layer does this better. The
   * redirect is `307` so the method is preserved and nothing caches it, since
   * the URL is only valid for this caller.
   */
  const object = `${endpoint.replace(/\/$/, '')}/${bucket}/${record.storageKey}`
  return NextResponse.redirect(object, {
    status: 307,
    headers: {
      'Cache-Control': 'private, no-store',
      'Content-Disposition': `attachment; filename="${record.fileName.replace(/"/g, '')}"`,
    },
  })
}
