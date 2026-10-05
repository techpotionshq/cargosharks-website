/**
 * Who may download what — the file routes' half of each page's permission
 * check (run 5, R4).
 *
 * ## Why a table and not a line in each route
 *
 * A download route and the page that links to it are two doors to the same
 * record, and they drifted: `/invoices/[id]` refused anyone without
 * `receivable.read`, while `/api/invoices/[id]/pdf` checked only that a
 * session existed, so read-only, coordinator, sales and customs-broker staff
 * could fetch any tax invoice in their branch by URL. Row-level security held
 * the branch line and nothing else, because a role is not a row policy.
 *
 * Stating every file route's rule here, next to the page each one mirrors,
 * makes the next drift a diff to this table rather than a forgotten line in a
 * handler, and lets one test walk every route against every shell.
 *
 * ## The rule for each
 *
 *   invoice      Staff need `receivable.read`, as `(ops)/invoices/[id]` does.
 *                A customer contact may have their own (`portal/invoices/[id]`
 *                links the PDF; RLS narrows it to their company). An agent
 *                shell shows no invoices.
 *   quote        Any staff member, as `(ops)/quotes/[id]` has no permission
 *                gate. A customer contact may have their own (`portal/quotes`).
 *                An agent shell shows no quotes.
 *   jobDocument  A preview of a house bill, delivery order, packing list or
 *                customs pack, rendered from the live job. Staff only: the job
 *                page is where the preview links are, and a customer or agent
 *                gets issued documents through `api/documents/[id]`, which
 *                applies the release rule. A preview is a draft by definition.
 *   manifest     Staff only. A consolidation exists only in the ops shell.
 *   asset        Staff only. `assets` is internal under RLS already (0004);
 *                stated here so the route refuses before it asks the database.
 *
 * `api/documents/[id]` is not in the table: its rule depends on the document
 * row (released, current, customer-visible), so it stays in that route. The
 * CSV routes (`audit.csv`, `reports/margin.csv`, `templates/[kind]`) already
 * check the same key as their pages and are tested where they live.
 *
 * Refusals answer *not found*, never *forbidden*, the same as the pages
 * (FR-ID-04): a caller learns nothing about which ids exist.
 */

import type { Session } from './session'

export type DownloadKind = 'invoice' | 'quote' | 'jobDocument' | 'manifest' | 'asset'

type Who = Pick<Session, 'actor' | 'permissions'>

const RULES: Record<DownloadKind, (session: Who) => boolean> = {
  invoice: (session) =>
    session.actor.type === 'internal'
      ? session.permissions.has('receivable.read')
      : session.actor.type === 'customer_contact',
  quote: (session) =>
    session.actor.type === 'internal' || session.actor.type === 'customer_contact',
  jobDocument: (session) => session.actor.type === 'internal',
  manifest: (session) => session.actor.type === 'internal',
  asset: (session) => session.actor.type === 'internal',
}

/** Whether this session may download a file of this kind at all. */
export function mayDownload(session: Who, kind: DownloadKind): boolean {
  return RULES[kind](session)
}
