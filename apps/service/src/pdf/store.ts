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

import { and, desc, eq, isNull, sql } from 'drizzle-orm'
import { assets, documentTypes, documents, jobs, withActor, type Actor } from '@qabandi/db'
import { fileStore } from '../adapters/index'
import { DocumentNotFoundError } from './documents'
import type { DocumentLocale } from './document-kit'
import { DOCUMENT_TYPE_KEYS, type JobDocumentKind } from './job-documents'

/**
 * The deployment has no `document_types` row for this kind — never seeded, or
 * the row was retired.
 *
 * A `DocumentNotFoundError` still, so a caller that only knows that class
 * keeps treating it as a 404; its own class so the route can answer with a
 * code the screen words differently from "no such shipment", which sends the
 * operator looking for a job that is right there.
 */
export class DocumentTypeNotSeededError extends DocumentNotFoundError {
  constructor(readonly kind: JobDocumentKind) {
    super(`${DOCUMENT_TYPE_KEYS[kind]} — run pnpm db:seed`, 'seeded document type')
    this.name = 'DocumentTypeNotSeededError'
  }
}

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
  const store = await fileStore()

  /*
    Read, write to storage, then record — in that order, and the order matters.

    A row pointing at bytes that were never written is a download that 404s
    from a screen that says the document exists. Bytes with no row are an
    orphan in a bucket, which costs pennies and confuses nobody. So storage
    goes before the rows.

    All three in one transaction, under a lock on (job, kind, locale) — O13.
    The version was read in one transaction and written in another, so two
    issues at once both computed v3, both wrote the same storage key (the
    second render over the first's bytes and checksum) and both recorded v3.
    The lock makes the second wait and then read v3 as the previous version;
    the unique index on (job, type, locale, version) is the backstop, and a
    clash that still reaches it is refused rather than recorded twice.
  */
  return withActor(actor, async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`${jobId}:${kind}:${locale}`}, 0))`,
    )

    const [job] = await tx
      .select({ reference: jobs.reference, branchId: jobs.branchId })
      .from(jobs)
      .where(eq(jobs.id, jobId))
      .limit(1)

    if (!job) throw new DocumentNotFoundError(jobId, 'job')

    const [type] = await tx
      .select({ id: documentTypes.id })
      .from(documentTypes)
      .where(eq(documentTypes.code, DOCUMENT_TYPE_KEYS[kind]))
      .limit(1)

    /*
      A missing type is a deployment that was never seeded, not a shipment
      nobody may see. Still a 404 at the route, but its own subclass, so the
      route can send a code of its own: the screen used to show this English
      message verbatim, and a translated "no such shipment" would send the
      operator looking for a job that is right there.
    */
    if (!type) throw new DocumentTypeNotSeededError(kind)

    /*
      Per language. The Arabic and the English copy of a bill are two
      documents, each with its own history: versioned together, issuing the
      Arabic copy superseded the released English one, and it vanished from
      the customer's portal.
    */
    const [previous] = await tx
      .select({ id: documents.id, version: documents.version })
      .from(documents)
      .where(
        and(
          eq(documents.jobId, jobId),
          eq(documents.documentTypeId, type.id),
          eq(documents.locale, locale),
        ),
      )
      .orderBy(desc(documents.version))
      .limit(1)

    const context = {
      reference: job.reference,
      branchId: job.branchId,
      documentTypeId: type.id,
      previousId: previous?.id ?? null,
      version: (previous?.version ?? 0) + 1,
    }

    const storageKey = storageKeyFor(
      context.branchId.slice(0, 8),
      context.reference,
      kind,
      context.version,
      locale,
    )

    const stored = await store.put(storageKey, pdf, 'application/pdf')

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
        .where(and(eq(documents.id, context.previousId), isNull(documents.supersededById)))
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
