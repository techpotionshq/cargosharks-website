/**
 * Storing a generated document — the moment it stops being a view and becomes
 * a record.
 *
 * `renderInvoicePdf` renders on demand and streams, and the comment there
 * explains why that is right for a draft: an invoice PDF is a *view* of rows
 * that can still change, and a stored copy goes stale the moment a line is
 * edited. That reasoning holds until the document is issued, and then inverts
 * completely.
 *
 * A house bill of lading that was handed to a customer and can be regenerated
 * differently tomorrow is not a document — it is a report that happens to look
 * like one. So issue takes a copy: the bytes are written to storage, an
 * `assets` row records them, and a `documents` row at the next version points
 * at it. What was given out is what is kept.
 *
 * ## Versions rather than overwrites
 *
 * Regenerating never replaces. It writes version N+1 and marks N superseded,
 * which is the shape `documents` was built for — `version`, `superseded_by_id`
 * and `released_at` have been there since 0000. A corrected bill of lading is
 * a new original with the old one recalled, in the trade as much as in this
 * table, and a system that silently overwrote it would be unable to answer
 * which one the consignee is holding.
 */

import { createHash } from 'node:crypto'
import { and, desc, eq } from 'drizzle-orm'
import {
  assets,
  documentTypes,
  documents,
  jobs,
  withActor,
  type Actor,
} from '@qabandi/db'
import { adapters } from '../adapters/index'
import { DocumentNotFoundError } from './documents'
import type { DocumentLocale } from './document-kit'
import { DOCUMENT_TYPE_KEYS, type JobDocumentKind } from './job-documents'

export interface StoredDocument {
  readonly documentId: string
  readonly assetId: string
  readonly version: number
  readonly filename: string
  readonly storageKey: string
}

/**
 * Where a document lives in the bucket.
 *
 * Keyed by job and version rather than by a random id, so an operator with
 * bucket access can find a shipment's documents without joining anything, and
 * so a re-render of the same version is idempotent rather than accumulating
 * orphans. The checksum is not in the key: two renders of the same version
 * *should* collide, because the second is a correction of the first within one
 * transaction that failed.
 */
export function storageKeyFor(
  branchCode: string,
  jobReference: string,
  kind: string,
  version: number,
  locale: DocumentLocale,
): string {
  const safe = (s: string): string => s.replace(/[^A-Za-z0-9._-]/g, '-')
  return `documents/${safe(branchCode)}/${safe(jobReference)}/${safe(kind)}-v${version}-${locale}.pdf`
}

export async function storeJobDocument(
  actor: Actor,
  jobId: string,
  kind: JobDocumentKind,
  locale: DocumentLocale,
  pdf: Buffer,
  filename: string,
): Promise<StoredDocument> {
  const fileStore = adapters().fileStore

  /*
    Read, write to storage, then record — in that order, and the order matters.

    A row pointing at bytes that were never written is a download that 404s
    from a screen that says the document exists. Bytes with no row are an
    orphan in a bucket, which costs pennies and confuses nobody. So storage
    goes first and the transaction second.
  */
  const context = await withActor(actor, async (tx) => {
    const [job] = await tx
      .select({ reference: jobs.reference, branchId: jobs.branchId })
      .from(jobs)
      .where(eq(jobs.id, jobId))
      .limit(1)

    if (!job) throw new DocumentNotFoundError(jobId)

    const [type] = await tx
      .select({ id: documentTypes.id })
      .from(documentTypes)
      .where(eq(documentTypes.code, DOCUMENT_TYPE_KEYS[kind]))
      .limit(1)

    if (!type) {
      throw new DocumentNotFoundError(
        `document type ${DOCUMENT_TYPE_KEYS[kind]} — run pnpm db:seed`,
      )
    }

    const [previous] = await tx
      .select({ id: documents.id, version: documents.version })
      .from(documents)
      .where(and(eq(documents.jobId, jobId), eq(documents.documentTypeId, type.id)))
      .orderBy(desc(documents.version))
      .limit(1)

    return {
      reference: job.reference,
      branchId: job.branchId,
      documentTypeId: type.id,
      previousId: previous?.id ?? null,
      version: (previous?.version ?? 0) + 1,
    }
  })

  const storageKey = storageKeyFor(
    context.branchId.slice(0, 8),
    context.reference,
    kind,
    context.version,
    locale,
  )

  const stored = await fileStore.put(storageKey, pdf, 'application/pdf')

  return withActor(actor, async (tx) => {
    const [asset] = await tx
      .insert(assets)
      .values({
        branchId: context.branchId,
        storageKey: stored.storageKey,
        fileName: filename,
        contentType: 'application/pdf',
        byteSize: pdf.byteLength,
        checksum: stored.checksum,
        uploadedById: actor.principalId,
        meta: { kind, locale, generated: true },
      })
      .returning({ id: assets.id })

    const [document] = await tx
      .insert(documents)
      .values({
        jobId,
        documentTypeId: context.documentTypeId,
        assetId: asset!.id,
        version: context.version,
        authorId: actor.principalId,
        generatedFrom: kind,
        locale,
      })
      .returning({ id: documents.id })

    /*
      The previous version is superseded, not deleted.

      `documents_scope` shows a customer only released documents, so a
      superseded original stays visible to staff and disappears from the
      portal — which is exactly the behaviour a recalled bill of lading needs.
    */
    if (context.previousId) {
      await tx
        .update(documents)
        .set({ supersededById: document!.id, updatedAt: new Date() })
        .where(eq(documents.id, context.previousId))
    }

    return {
      documentId: document!.id,
      assetId: asset!.id,
      version: context.version,
      filename,
      storageKey: stored.storageKey,
    }
  })
}
