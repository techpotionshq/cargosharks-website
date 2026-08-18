'use server'

/**
 * Closing a period — building the journal, posting it, and voiding one.
 *
 * A separate file from `form-actions.ts` because it is a separate act. That
 * file is what a finance clerk does all day: raise an invoice, take a receipt,
 * allocate it. This is what happens once a month, needs a different
 * permission, and is the only operation in the product that reaches into
 * somebody else's statutory ledger.
 *
 * ## Why the work happens in the service
 *
 * The arithmetic is `@qabandi/core` and would run anywhere. The *file* has to
 * be stored, and storage credentials live in one process by design (§3) —
 * exactly as for documents and signed URLs. So this resolves the session,
 * checks the permission, and hands the actor across the boundary.
 *
 * ## Preview and post
 *
 * A draft builds the file and marks nothing, so a finance manager can generate
 * January four times before they believe it. Posting consumes the period: it
 * stamps every invoice, cost and receipt it covered, and a second export of
 * the same month then finds nothing. Getting back requires voiding, with a
 * reason — because "why was March posted twice" is answered by that row or by
 * nobody.
 */

import { revalidatePath } from 'next/cache'
import { requireSession } from '@/lib/session'
import { assertCan, assertInBranch } from '@/lib/permissions'
import { failWith, succeed, type ActionState } from '@/lib/form-state'

function read(form: FormData, key: string): string | undefined {
  const value = form.get(key)
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

interface ServiceRefusal {
  readonly error?: string
  readonly message?: string
}

function service(): { url: string; secret: string } | null {
  const url = process.env.SERVICE_URL
  const secret = process.env.INTERNAL_API_SECRET
  return url && secret ? { url: url.replace(/\/$/, ''), secret } : null
}

export async function createAccountingExport(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const session = await requireSession()
  assertCan(session, 'finance.export')

  const branchId = read(form, 'branchId')
  const from = read(form, 'from')
  const to = read(form, 'to')
  const post = read(form, 'post') === 'true'

  if (!branchId || !from || !to) return failWith('Choose a branch and a period.')
  if (!ISO_DATE.test(from) || !ISO_DATE.test(to)) return failWith('Dates must be YYYY-MM-DD.')
  if (to < from) return failWith('The period ends before it starts.')

  assertInBranch(session, branchId)

  const target = service()
  if (!target) {
    return failWith(
      'The export runs in the service, which is not configured. Set SERVICE_URL and INTERNAL_API_SECRET.',
    )
  }

  const response = await fetch(`${target.url}/internal/accounting/export`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-internal-secret': target.secret },
    body: JSON.stringify({ actor: session.actor, branchId, from, to, post }),
    cache: 'no-store',
    signal: AbortSignal.timeout(120_000),
  })

  if (!response.ok) {
    /*
      422 carries a sentence the finance manager can act on — an unmapped
      charge type names itself, a missing control account names itself, an
      unbalanced journal says so. Every one of them is a row they can go and
      fix, and replacing it with "the export failed" sends them to support
      about their own chart of accounts.
    */
    const detail = (await response.json().catch(() => null)) as ServiceRefusal | null
    return failWith(detail?.message ?? `The export service refused (${response.status}).`)
  }

  const result = (await response.json()) as {
    exportId: string
    status: string
    rowCount: number
    invoiceCount: number
    costCount: number
    paymentCount: number
  }

  revalidatePath('/finance')

  if (result.rowCount === 0) {
    return failWith(
      'Nothing in that period is waiting to be posted. Either it has all been exported already, or nothing was issued.',
    )
  }

  return succeed(result.exportId)
}

export async function voidAccountingExportAction(form: FormData): Promise<void> {
  const session = await requireSession()
  assertCan(session, 'finance.export')

  const exportId = read(form, 'exportId')
  const reason = read(form, 'reason')
  if (!exportId) throw new Error('Nothing to void')
  if (!reason) throw new Error('A void needs a reason')

  const target = service()
  if (!target) throw new Error('SERVICE_URL and INTERNAL_API_SECRET are required')

  const response = await fetch(`${target.url}/internal/accounting/export/${exportId}/void`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-internal-secret': target.secret },
    body: JSON.stringify({ actor: session.actor, reason }),
    cache: 'no-store',
  })

  if (!response.ok) {
    const detail = (await response.json().catch(() => null)) as ServiceRefusal | null
    throw new Error(detail?.message ?? 'The export could not be voided')
  }

  revalidatePath('/finance')
}
