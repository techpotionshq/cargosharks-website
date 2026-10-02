/**
 * Mail from this supplier that is filed on no record and waiting for a person.
 *
 * A supplier is not a customer, so its mail no longer opens an enquiry — and a
 * bill attached to it is read automatically. What is left is the mail nothing
 * read: a revised cut-off, a rate notice, a complaint. This panel is where it
 * surfaces, on the page of the supplier who sent it, with the three things a
 * person does with such a mail: put it on the job it is about, read an
 * attachment as a bill, or say it needs nothing.
 *
 * Renders nothing when nothing is waiting.
 */

import Link from 'next/link'
import { getLocale, getTimeZone, getTranslations } from 'next-intl/server'
import { requireSession } from '@/lib/session'
import { canIn } from '@/lib/permissions'
import { DEFAULT_LOCALE, isLocale } from '@/i18n/request'
import { formatDateTime } from '@/lib/format'
import { Panel } from '@/ui/panel'
import { RecordDialog } from '@/ui/record-dialog'
import { partnerMail } from '../partner-mail'
import {
  attachPartnerMailToJob,
  markPartnerMailHandled,
  readPartnerMailAsBill,
} from '../partner-mail-actions'

export async function PartnerMailPanel({
  partnerId,
  className,
}: {
  readonly partnerId: string
  readonly className?: string
}) {
  const session = await requireSession()
  const [rows, t, tc, resolved, timeZone] = await Promise.all([
    partnerMail(session.actor, partnerId),
    getTranslations('partnerMail'),
    getTranslations('common'),
    getLocale(),
    getTimeZone(),
  ])
  if (rows.length === 0) return null
  const locale = isLocale(resolved) ? resolved : DEFAULT_LOCALE

  return (
    <Panel
      className={className}
      padding="none"
      icon="enquiries"
      title={t('title')}
      explain={t('explain')}
    >
      <ul className="divide-y divide-line">
        {rows.map((row) => {
          const canJob = canIn(session, 'job.update', row.branchId)
          const canBill = canIn(session, 'payable.record', row.branchId)
          return (
            <li key={row.id} className="px-4 py-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-body font-medium text-ink" dir="auto">
                    {row.subject || t('noSubject')}
                  </p>
                  <p className="text-micro text-ink-subtle">
                    <span dir="ltr">{row.fromAddress ?? '—'}</span> ·{' '}
                    {formatDateTime(row.receivedAt, locale, timeZone)}
                  </p>
                  {row.excerpt ? (
                    <p className="mt-1 text-body-sm text-ink-muted" dir="auto">
                      {row.excerpt}
                    </p>
                  ) : null}
                  {row.attachments.length > 0 ? (
                    <ul className="mt-2 flex flex-wrap gap-2">
                      {row.attachments.map((file) => (
                        <li
                          key={file.assetId}
                          className="flex flex-wrap items-center gap-2 text-body-sm"
                        >
                          <span dir="ltr" className="text-ink">
                            {file.fileName}
                          </span>
                          {file.billId ? (
                            <Link
                              href={`/payables/${file.billId}`}
                              className="text-accent hover:underline"
                            >
                              {t('openBill')}
                            </Link>
                          ) : file.readable && canBill ? (
                            <RecordDialog
                              action={readPartnerMailAsBill}
                              icon="finance"
                              size="sm"
                              variant="ghost"
                              fields={[
                                { kind: 'hidden', name: 'messageId', value: row.id },
                                { kind: 'hidden', name: 'assetId', value: file.assetId },
                                { kind: 'note', text: t('readAsBillHint') },
                              ]}
                              labels={{
                                open: t('readAsBill'),
                                title: t('readAsBill'),
                                submit: t('readAsBill'),
                                submitting: t('reading'),
                                cancel: tc('cancel'),
                              }}
                            />
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
                <div className="flex shrink-0 flex-wrap gap-1">
                  {canJob ? (
                    <RecordDialog
                      action={attachPartnerMailToJob}
                      icon="ship"
                      size="sm"
                      variant="secondary"
                      fields={[
                        { kind: 'hidden', name: 'messageId', value: row.id },
                        {
                          kind: 'text',
                          name: 'jobReference',
                          label: t('jobReference'),
                          hint: t('jobReferenceHint'),
                          required: true,
                          mono: true,
                          span: 12,
                        },
                      ]}
                      labels={{
                        open: t('attachToJob'),
                        title: t('attachToJob'),
                        submit: t('attach'),
                        submitting: tc('saving'),
                        cancel: tc('cancel'),
                      }}
                    />
                  ) : null}
                  {canJob || canBill ? (
                    <RecordDialog
                      action={markPartnerMailHandled}
                      icon="check"
                      size="sm"
                      variant="ghost"
                      fields={[
                        { kind: 'hidden', name: 'messageId', value: row.id },
                        { kind: 'note', text: t('handledHint') },
                      ]}
                      labels={{
                        open: t('markHandled'),
                        title: t('markHandled'),
                        submit: t('markHandled'),
                        submitting: tc('saving'),
                        cancel: tc('cancel'),
                      }}
                    />
                  ) : null}
                </div>
              </div>
            </li>
          )
        })}
      </ul>
    </Panel>
  )
}
