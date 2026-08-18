/**
 * Closing the month — the panel that gets the ledger out of this system.
 *
 * Two buttons, and the gap between them is the whole design. **Preview**
 * builds the file and marks nothing, so a finance manager can run January four
 * times before they believe it. **Post** consumes the period: every invoice,
 * cost and receipt it covered is stamped, and a second export of the same
 * month then finds nothing to carry.
 *
 * The period defaults to last month because that is the month somebody is
 * closing. Defaulting to the current one offers a half-finished period as the
 * obvious choice, which is the one thing nobody wants to post.
 */

import { getTranslations } from 'next-intl/server'
import { requireSession } from '@/lib/session'
import { can } from '@/lib/permissions'
import { loadOptions } from '@/lib/options'
import { RecordDialog, type FieldSpec } from '@/ui/record-dialog'
import { createAccountingExport } from '../export-actions'

/** Last month, as two ISO dates. Computed on the server, in UTC. */
function lastMonth(): { from: string; to: string } {
  const now = new Date()
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1))
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0))
  return { from: start.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10) }
}

export async function AccountingExportDialog({
  post = false,
  variant = 'secondary',
}: {
  /** True posts the period. False previews it and marks nothing. */
  readonly post?: boolean
  readonly variant?: 'primary' | 'secondary' | 'ghost'
}) {
  const session = await requireSession()
  if (!can(session, 'finance.export')) return null

  const [options, t, tc] = await Promise.all([
    loadOptions(session.actor),
    getTranslations('accountingExport'),
    getTranslations('common'),
  ])

  const period = lastMonth()

  const fields: FieldSpec[] = [
    { kind: 'hidden', name: 'post', value: post ? 'true' : 'false' },
    {
      kind: 'select',
      name: 'branchId',
      label: t('branch'),
      span: 12,
      required: true,
      hint: t('branchHint'),
      options: options.branches,
      defaultValue: [...session.branchRoles.keys()][0],
    },
    { kind: 'date', name: 'from', label: t('from'), span: 6, required: true, defaultValue: period.from },
    { kind: 'date', name: 'to', label: t('to'), span: 6, required: true, defaultValue: period.to },
    post
      ? { kind: 'note', text: t('postWarning'), tone: 'caution' }
      : { kind: 'note', text: t('previewNote'), tone: 'info' },
  ]

  return (
    <RecordDialog
      action={createAccountingExport}
      fields={fields}
      icon="finance"
      variant={variant}
      submitIcon={post ? 'sealed' : 'download'}
      labels={{
        open: post ? t('post') : t('preview'),
        title: post ? t('postTitle') : t('previewTitle'),
        description: post ? t('postDescription') : t('previewDescription'),
        submit: post ? t('post') : t('preview'),
        submitting: tc('saving'),
        cancel: tc('cancel'),
      }}
    />
  )
}
