import 'server-only'
import { and, desc, eq, inArray, isNull } from 'drizzle-orm'
import {
  assets,
  messageAttachments,
  messages,
  supplierInvoices,
  withActor,
  type Actor,
} from '@qabandi/db'
import { usePilotFixtures } from '@/lib/pilot/source'
import { pilotPartnerMail } from '@/lib/pilot/fixtures'
import type { PartnerMailLike } from '@/lib/pilot/types'

/** What "Read as a bill" can send to the model — the invoice reader's own list. */
const READABLE = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])

/** The newest mail is the one waiting; a supplier's whole history is the mailbox's job. */
const LIMIT = 20

/**
 * A supplier's mail that the intake filed on no record and nobody has dealt
 * with yet — the partner page's list.
 *
 * A known supplier's mail no longer opens a customer enquiry (`ingestMessage`).
 * A bill attached to it is read automatically; everything else — a revised
 * cut-off, a rate notice, a complaint — would otherwise sit on no screen at all.
 * This is that screen: each row with its attachments, the bill already captured
 * from each where there is one, and the actions to attach it to a job, read it
 * as a bill, or mark it dealt with (`read_at`, so nothing is deleted).
 *
 * Row-level security narrows it to the reader's branches, like every message.
 */
export async function partnerMail(actor: Actor, partnerId: string): Promise<PartnerMailLike[]> {
  if (usePilotFixtures()) return pilotPartnerMail(partnerId)
  if (!partnerId) return []

  return withActor(actor, async (tx) => {
    const rows = await tx
      .select({
        id: messages.id,
        branchId: messages.branchId,
        receivedAt: messages.sentAt,
        createdAt: messages.createdAt,
        fromAddress: messages.fromAddress,
        subject: messages.subject,
        body: messages.body,
      })
      .from(messages)
      .where(
        and(
          eq(messages.partnerId, partnerId),
          eq(messages.direction, 'inbound'),
          isNull(messages.enquiryId),
          isNull(messages.jobId),
          isNull(messages.readAt),
        ),
      )
      .orderBy(desc(messages.createdAt))
      .limit(LIMIT)
    if (rows.length === 0) return []

    const files = await tx
      .select({
        messageId: messageAttachments.messageId,
        assetId: assets.id,
        fileName: assets.fileName,
        contentType: assets.contentType,
        storageKey: assets.storageKey,
        billId: supplierInvoices.id,
      })
      .from(messageAttachments)
      .innerJoin(assets, eq(assets.id, messageAttachments.assetId))
      .leftJoin(supplierInvoices, eq(supplierInvoices.assetId, assets.id))
      .where(
        inArray(
          messageAttachments.messageId,
          rows.map((r) => r.id),
        ),
      )

    return rows.map((row) => ({
      id: row.id,
      branchId: row.branchId,
      receivedAt: row.receivedAt ?? row.createdAt,
      fromAddress: row.fromAddress,
      subject: row.subject,
      excerpt: row.body.trim().slice(0, 240),
      attachments: files
        .filter((f) => f.messageId === row.id)
        // One row per file, even if two bills were captured from it.
        .filter((f, i, all) => all.findIndex((g) => g.assetId === f.assetId) === i)
        .map((f) => ({
          assetId: f.assetId,
          fileName: f.fileName,
          readable: READABLE.has(f.contentType) && !f.storageKey.startsWith('oversized:'),
          billId: f.billId,
        })),
    }))
  })
}
