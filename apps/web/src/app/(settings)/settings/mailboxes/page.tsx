/**
 * Mailboxes — `FR-EQ-02`, `FR-AD-03`.
 *
 * SRS §3 calls Al-Qabandi's five office mailboxes *"the single most telling
 * finding"*: the inbox is the system of record, and there are five of them.
 * This is where those five are connected, and where a sixth is added without a
 * release.
 *
 * The column that earns its place is the last one. A mailbox that has stopped
 * working is otherwise invisible — the enquiry queue simply goes quiet, and a
 * quiet week looks exactly like a broken credential. `lastPolledAt` and
 * `lastError` are what turn that into a row an administrator can see is red.
 */

import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getLocale, getTranslations } from 'next-intl/server'
import { requireSession } from '@/lib/session'
import { can } from '@/lib/permissions'
import { listMailboxes, mailboxKeyConfigured } from '@/features/admin/mailboxes'
import { MailboxDialog, ToggleMailboxButton } from '@/features/admin/ui/mailbox-dialogs'
import { loadOptions } from '@/lib/options'
import { DEFAULT_LOCALE, isLocale } from '@/i18n/request'
import { formatDateTime } from '@/lib/format'
import { Register } from '@/ui/register'
import { Badge } from '@/ui/status'
import { TableShell, TBody, TD, TH, THead, TR } from '@/ui/table'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('mailboxes')
  return { title: t('title') }
}

export default async function MailboxesPage() {
  const session = await requireSession()
  /*
    Its own key, not the layout's admission. A row here carries the credential
    to a mailbox that is usually somebody's whole account, so this screen is a
    different kind of screen from the one that edits charge types.
  */
  if (!can(session, 'admin.mailboxes.write')) notFound()

  const [rows, keyConfigured, options, t, tc] = await Promise.all([
    listMailboxes(),
    mailboxKeyConfigured(),
    loadOptions(session.actor),
    getTranslations('mailboxes'),
    getTranslations('common'),
  ])

  const resolved = await getLocale()
  const locale = isLocale(resolved) ? resolved : DEFAULT_LOCALE

  const active = rows.filter((row) => row.isActive).length
  const failing = rows.filter((row) => row.isActive && row.lastError).length

  return (
    <Register
      actions={<MailboxDialog branches={options.branches} keyConfigured={keyConfigured} />}
      eyebrow={t('eyebrow')}
      title={t('title')}
      description={t('subtitle')}
      summary={[
        { label: t('total'), value: rows.length },
        { label: tc('active'), value: active },
        { label: t('failing'), value: failing },
      ]}
      isEmpty={rows.length === 0}
      empty={{ icon: 'enquiries', title: t('noneYet'), description: t('noneYetHint') }}
    >
      <TableShell>
        <THead>
          <TR>
            <TH>{t('branch')}</TH>
            <TH>{t('username')}</TH>
            <TH>{t('host')}</TH>
            <TH>{t('folder')}</TH>
            <TH>{t('lastPolled')}</TH>
            <TH>{t('lastMessage')}</TH>
            <TH>{tc('status')}</TH>
            <TH align="end">{tc('actions')}</TH>
          </TR>
        </THead>
        <TBody>
          {rows.map((row) => (
            <TR key={row.id}>
              <TD>{row.branchCode}</TD>
              <TD>{row.username}</TD>
              <TD>
                {row.host}
                <span className="text-muted">:{row.port}</span>
              </TD>
              <TD>
                {row.folder}
                {row.archiveFolder ? (
                  // The arrow is direction-neutral on purpose: `→` would point
                  // the wrong way in Arabic, and this reads in both.
                  <span className="text-muted"> · {row.archiveFolder}</span>
                ) : null}
              </TD>
              <TD>{row.lastPolledAt ? formatDateTime(row.lastPolledAt, locale) : '—'}</TD>
              <TD>{row.lastMessageAt ? formatDateTime(row.lastMessageAt, locale) : '—'}</TD>
              <TD>
                {!row.isActive ? (
                  <Badge tone="muted">{tc('inactive')}</Badge>
                ) : row.lastError ? (
                  /*
                    The reason, not a generic "failed".

                    "Authentication failed" and "certificate expired" have
                    different fixes and different owners, and an administrator
                    who must open a service log to tell them apart will open a
                    support ticket instead. The text is the mail server's, so
                    it is rendered as data — never as markup.
                  */
                  <div className="flex flex-col items-start gap-1">
                    <Badge tone="critical">{t('erroring')}</Badge>
                    <span className="text-xs text-muted">{row.lastError}</span>
                  </div>
                ) : (
                  <Badge tone="positive">{tc('active')}</Badge>
                )}
              </TD>
              <TD align="end">
                <div className="flex justify-end gap-1">
                  <MailboxDialog
                    branches={options.branches}
                    keyConfigured={keyConfigured}
                    variant="ghost"
                    iconOnly
                    defaults={{
                      id: row.id,
                      branchId: row.branchId,
                      host: row.host,
                      port: row.port,
                      secure: row.secure,
                      username: row.username,
                      folder: row.folder,
                      archiveFolder: row.archiveFolder,
                    }}
                  />
                  <ToggleMailboxButton mailboxId={row.id} isActive={row.isActive} />
                </div>
              </TD>
            </TR>
          ))}
        </TBody>
      </TableShell>

      {rows.some((row) => row.isActive && row.lastError) ? (
        <p className="mt-3 text-sm text-muted">{t('errorHint')}</p>
      ) : null}
    </Register>
  )
}
