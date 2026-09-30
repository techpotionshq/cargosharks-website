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
import { getLocale, getTranslations } from 'next-intl/server'
import { requireSession } from '@/lib/session'
import { assertCan, assertInBranch } from '@/lib/permissions'
import { fail, failWith, succeed, type ActionState, type Translate } from '@/lib/form-state'

function read(form: FormData, key: string): string | undefined {
  const value = form.get(key)
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

/**
 * What the service's 422 carries. `error` is the code this file translates;
 * `message` is the same fact in English, kept for the service's own log and
 * never shown here; `values` is what the sentence names.
 */
interface ServiceRefusal {
  readonly error?: string
  readonly message?: string
  readonly values?: Readonly<Record<string, string>>
}

/**
 * Every refusal code the export and void routes send.
 *
 * The first four are `ExportError`s the service raises itself; the three
 * `journal_*` are the accounting engine's own, passed through by code and
 * values (`AccountingError`); the last
 * three are the void's. Anything else — a code added in the service before a
 * sentence here, or a service that sent none — gets the action's own fallback,
 * never the English `message`.
 */
const EXPORT_REFUSALS = [
  'period_reversed',
  'branch_not_found',
  'unmapped_charge_types',
  'asset_conflict',
  'journal_unbalanced',
  'journal_unmapped',
  'journal_unmapped_line',
  'not_found',
  'already_void',
  'void_needs_reason',
] as const

type ExportRefusal = (typeof EXPORT_REFUSALS)[number]

function isExportRefusal(code: unknown): code is ExportRefusal {
  return typeof code === 'string' && (EXPORT_REFUSALS as readonly string[]).includes(code)
}

/**
 * A refusal in the reader's language, or null where there is nothing to say
 * better than the caller's fallback.
 *
 * The unmapped charge types arrive named in both languages, joined by the
 * service, because the list sits inside the sentence and an Arabic sentence
 * naming "Ocean Freight" reads as a half-finished translation. Either list
 * stands in for the other rather than printing an empty one.
 */
function refusal(
  tv: Translate<'ledgerValidation'>,
  reason: ExportRefusal,
  values: Readonly<Record<string, string>>,
  locale: string,
): string | null {
  switch (reason) {
    case 'period_reversed':
      return tv('periodEndsBeforeStart')
    case 'branch_not_found':
      return tv('exportBranchNotFound')
    case 'unmapped_charge_types': {
      const names =
        (locale === 'ar' ? values.namesAr : values.namesEn) || values.namesEn || values.namesAr
      return names ? tv('exportUnmappedChargeTypes', { names }) : null
    }
    case 'asset_conflict':
      return tv('exportAssetConflict')
    /*
      The three engine refusals name the invoice or account they are about
      (`AccountingError.values`). The enums — which account, which kind of
      document — are worded by ICU `select` in the sentence, whose `other`
      branch covers one the engine learns before this catalogue does. A reply
      without values (a service older than this file) keeps the unnamed
      sentence rather than printing empty placeholders.
    */
    case 'journal_unbalanced':
      return values.amount && values.currency
        ? tv('exportJournalUnbalancedBy', { amount: values.amount, currency: values.currency })
        : tv('exportJournalUnbalanced')
    case 'journal_unmapped': {
      if (!values.account || !values.document) return tv('exportJournalUnmapped')
      const chargeType =
        (locale === 'ar' ? values.chargeTypeAr : values.chargeTypeEn) ||
        values.chargeTypeEn ||
        values.chargeTypeAr
      return chargeType
        ? tv('exportJournalChargeTypeUnmapped', {
            chargeType,
            account: values.account,
            document: values.document,
            reference: values.reference ?? '',
          })
        : tv('exportJournalAccountMissing', {
            account: values.account,
            document: values.document,
            reference: values.reference ?? '',
          })
    }
    case 'journal_unmapped_line':
      return values.reference && values.document
        ? tv('exportJournalLineNoChargeType', {
            line: values.line ?? '',
            document: values.document,
            reference: values.reference,
          })
        : tv('exportJournalUnmappedLine')
    case 'not_found':
      return tv('exportNotFound')
    case 'already_void':
      return tv('exportAlreadyVoid')
    case 'void_needs_reason':
      return tv('sayWhyUnwound')
    default: {
      const unhandled: never = reason
      return unhandled
    }
  }
}

/** The service's refusal body, translated, or null for the caller's fallback. */
async function translatedRefusal(
  tv: Translate<'ledgerValidation'>,
  response: Response,
): Promise<string | null> {
  const detail = (await response.json().catch(() => null)) as ServiceRefusal | null
  if (!isExportRefusal(detail?.error)) return null
  return refusal(tv, detail.error, detail.values ?? {}, await getLocale())
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
  const tv = await getTranslations('ledgerValidation')

  const branchId = read(form, 'branchId')
  const from = read(form, 'from')
  const to = read(form, 'to')
  const post = read(form, 'post') === 'true'

  if (!branchId || !from || !to) return failWith(tv('chooseBranchAndPeriod'))
  if (!ISO_DATE.test(from) || !ISO_DATE.test(to)) return failWith(tv('datesFormat'))
  if (to < from) return failWith(tv('periodEndsBeforeStart'))

  assertInBranch(session, branchId)

  const target = service()
  if (!target) return failWith(tv('exportServiceNotConfigured'))

  const response = await fetch(`${target.url}/internal/accounting/export`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-internal-secret': target.secret },
    body: JSON.stringify({ actor: session.actor, branchId, from, to, post }),
    cache: 'no-store',
    signal: AbortSignal.timeout(120_000),
  })

  if (!response.ok) {
    /*
      422 carries a reason the finance manager can act on — an unmapped
      charge type names itself, a missing control account says so, an
      unbalanced journal says so. Every one of them is a row they can go and
      fix, and replacing it with "the export failed" sends them to support
      about their own chart of accounts. So the code is translated here rather
      than dropped; only a code this file does not know falls back.
    */
    return failWith(
      (await translatedRefusal(tv, response)) ??
        tv('exportServiceRefused', { status: String(response.status) }),
    )
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

  if (result.rowCount === 0) return failWith(tv('nothingToPost'))

  return succeed(result.exportId)
}

/**
 * Unwind a posted period, with a reason.
 *
 * Returns an `ActionState` rather than throwing, which is a change from how it
 * was first written and the reason it could not be reached from a screen:
 * `RecordDialog` drives `(state, form) => ActionState`, and every refusal here
 * is something the finance manager can act on. "That export has already been
 * voided" and "a void needs a reason" belong on the form beside the field, not
 * on an error boundary that loses what they typed.
 */
export async function voidAccountingExportAction(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const session = await requireSession()
  assertCan(session, 'finance.export')
  const tv = await getTranslations('ledgerValidation')

  const exportId = read(form, 'exportId')
  const reason = read(form, 'reason')
  if (!exportId) return failWith(tv('nothingToVoid'))
  /*
    On the field, not as a banner. The reason *is* the record — "why was March
    posted twice" is answered by this column or by nobody — so an empty one is
    a field error, and the dialog keeps the rest of what was typed.
  */
  if (!reason) return fail({ reason: tv('sayWhyUnwound') })

  const target = service()
  if (!target) return failWith(tv('serviceSecretsRequired'))

  const response = await fetch(`${target.url}/internal/accounting/export/${exportId}/void`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-internal-secret': target.secret },
    body: JSON.stringify({ actor: session.actor, reason }),
    cache: 'no-store',
  })

  if (!response.ok) {
    // The service refuses by name — `already_void`, `not_found` — and the
    // name is what is translated (see `ExportError`).
    return failWith((await translatedRefusal(tv, response)) ?? tv('exportNotVoided'))
  }

  revalidatePath('/finance')
  return succeed(exportId)
}
