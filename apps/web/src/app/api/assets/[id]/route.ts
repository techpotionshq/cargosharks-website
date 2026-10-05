/**
 * Asset download — a stored file that is not a *document*.
 *
 * `api/documents/[id]` serves things with a document type, a version and a
 * release gate: bills of lading, invoices, customs packs. A proof-of-delivery
 * photograph is none of those. It has no version, nothing releases it, and it
 * is evidence rather than paperwork — so it needs a route of its own rather
 * than a `released_at is null` special case bolted onto the document one.
 *
 * ## Authorisation is entirely the policy on `assets`
 *
 * The lookup runs under the caller's own actor and RLS decides. `assets` is
 * branch-scoped and internal-only (0004), which is the conservative answer and
 * the right one for now: a customer contact reaching a POD photograph would
 * need a policy arm joining through `pod_photos` to a job they own, and
 * writing that as a side effect of building the download route is how a
 * visibility rule gets made by accident. The portal shows that the delivery
 * happened and who signed; the photographs are internal until somebody decides
 * otherwise deliberately.
 *
 * An asset outside the caller's scope is *not found*, never *forbidden* — no
 * enumeration signal (FR-ID-04).
 *
 * A retired asset is refused. Nothing is deleted here (§5.5), so `retired_at`
 * is the only thing standing between "we took this file out of circulation"
 * and it continuing to serve.
 */

import { NextResponse } from 'next/server'
import { and, eq, isNull } from 'drizzle-orm'
import { assets, withActor } from '@qabandi/db'
import { getSession } from '@/lib/session'
import { fileRefusal } from '@/lib/file-refusal'
import { mayDownload } from '@/lib/download-access'
import { usePilotFixtures } from '@/lib/pilot/source'
import { isUuid } from '@/lib/ids'

export const dynamic = 'force-dynamic'

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession()
  // A page for a browser (an expired session following a download link), the
  // same JSON as before for anything else.
  if (!session) return fileRefusal(request, 'unauthenticated')
  // The same rule as the page that links here, before anything else runs, so a
  // role the page refuses is refused here too (R4, `lib/download-access.ts`).
  if (!mayDownload(session, 'asset')) return fileRefusal(request, 'not_found')

  // Fixture mode has no database and no file store behind it. Without this the
  // lookup below threw, and a person following a document link on the demo
  // got a blank 500 instead of a page saying files are not part of it.
  if (usePilotFixtures()) return fileRefusal(request, 'not_available')

  const { id } = await params
  // Not a uuid is not an asset, and used to be a 500 from the cast (A17).
  if (!isUuid(id)) return fileRefusal(request, 'not_found')

  const [record] = await withActor(session.actor, (tx) =>
    tx
      .select({
        storageKey: assets.storageKey,
        fileName: assets.fileName,
      })
      .from(assets)
      .where(and(eq(assets.id, id), isNull(assets.retiredAt)))
      .limit(1),
  )

  if (!record) return fileRefusal(request, 'not_found')

  const serviceUrl = process.env.SERVICE_URL
  const secret = process.env.INTERNAL_API_SECRET
  if (!serviceUrl || !secret) {
    return fileRefusal(request, 'not_configured', { fileName: record.fileName })
  }

  const signed = await fetch(`${serviceUrl.replace(/\/$/, '')}/internal/files/signed-url`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-internal-secret': secret },
    body: JSON.stringify({ storageKey: record.storageKey, fileName: record.fileName }),
    cache: 'no-store',
  })

  if (!signed.ok) {
    return fileRefusal(request, 'storage_unavailable', { fileName: record.fileName })
  }

  const { url } = (await signed.json()) as { url: string }

  // Redirected, not proxied — see `api/documents/[id]` for the reasoning. The
  // signature in the URL is valid for anyone holding it, so it is never cached.
  return NextResponse.redirect(url, {
    status: 307,
    headers: { 'Cache-Control': 'private, no-store' },
  })
}
