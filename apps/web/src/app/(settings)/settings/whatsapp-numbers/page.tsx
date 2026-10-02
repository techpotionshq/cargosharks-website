/**
 * WhatsApp numbers — FR-EQ-02, FR-AD-03.
 *
 * The mailboxes screen, one channel over. Where that one connects the email
 * addresses the intake reads, this maps the WhatsApp business numbers the intake
 * answers on to the branch each belongs to — so a message to a number becomes an
 * enquiry for the right office, added without a release.
 *
 * The credential is deliberately absent: a WhatsApp number is answered through
 * Kapso, and the account key lives at Settings › Integrations, not on the row.
 * This screen only records the mapping.
 */

import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getLocale, getTimeZone, getTranslations } from 'next-intl/server'
import { requireSession } from '@/lib/session'
import { branchesWhere, can } from '@/lib/permissions'
import { listWhatsappNumbers } from '@/features/admin/whatsapp-numbers'
import {
  WhatsappNumberDialog,
  ToggleWhatsappNumberButton,
} from '@/features/admin/ui/whatsapp-number-dialogs'
import { loadOptions } from '@/lib/options'
import { DEFAULT_LOCALE, isLocale } from '@/i18n/request'
import { formatDateTime } from '@/lib/format'
import { Register } from '@/ui/register'
import { Badge } from '@/ui/status'
import { TableShell, TBody, TD, TH, THead, TR } from '@/ui/table'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('whatsappNumbers')
  return { title: t('title') }
}

export default async function WhatsappNumbersPage() {
  const timeZone = await getTimeZone()

  const session = await requireSession()
  // Same authority as the mailboxes screen: pointing the enquiry intake at an
  // inbound endpoint of one's choosing, per branch.
  if (!can(session, 'admin.mailboxes.write')) notFound()

  const [rows, options, t, tc] = await Promise.all([
    listWhatsappNumbers(),
    getLocale().then((locale) => loadOptions(session.actor, locale === 'ar' ? 'ar' : 'en')),
    getTranslations('whatsappNumbers'),
    getTranslations('common'),
  ])

  const resolved = await getLocale()
  const locale = isLocale(resolved) ? resolved : DEFAULT_LOCALE

  const active = rows.filter((row) => row.isActive).length

  // Only branches this administrator holds a role in — `whatsapp_numbers_scope`
  // scopes the insert to `app.branch_ids()`, so offering an unheld branch would
  // be a choice the database refuses after the form is filled in.
  // Administered, not merely held (A2) — the action refuses the rest.
  const administered = new Set(branchesWhere(session, 'admin.mailboxes.write'))
  const assignable = options.branches.filter((branch) => administered.has(branch.value))

  return (
    <Register
      actions={<WhatsappNumberDialog branches={assignable} />}
      eyebrow={t('eyebrow')}
      title={t('title')}
      description={t('subtitle')}
      summary={[
        { label: t('total'), value: rows.length },
        { label: tc('active'), value: active },
      ]}
      isEmpty={rows.length === 0}
      empty={{ icon: 'enquiries', title: t('noneYet'), description: t('noneYetHint') }}
    >
      <TableShell>
        <THead>
          <TR>
            <TH>{t('branch')}</TH>
            <TH>{t('label')}</TH>
            {/* The number follows its label on a phone (below). */}
            <TH priority="low">{t('displayNumber')}</TH>
            {/* The provider's ID and the last message wait for a wider
                screen; which number and whether it is on is what a phone keeps. */}
            <TH priority="low">{t('phoneNumberId')}</TH>
            <TH priority="low">{t('lastMessage')}</TH>
            <TH>{tc('status')}</TH>
            <TH align="end">{tc('actions')}</TH>
          </TR>
        </THead>
        <TBody>
          {rows.map((row) => (
            <TR key={row.id}>
              <TD>{row.branchCode}</TD>
              <TD>
                {row.label ?? '—'}
                {row.displayNumber ? (
                  <span className="numeric block text-[0.75rem] whitespace-nowrap text-ink-muted md:hidden">
                    {row.displayNumber}
                  </span>
                ) : null}
              </TD>
              <TD priority="low">{row.displayNumber ?? '—'}</TD>
              <TD priority="low">
                <span className="text-muted">{row.phoneNumberId}</span>
              </TD>
              <TD priority="low">
                {row.lastMessageAt ? formatDateTime(row.lastMessageAt, locale, timeZone) : '—'}
              </TD>
              <TD>
                {row.isActive ? (
                  <Badge tone="positive">{tc('active')}</Badge>
                ) : (
                  <Badge tone="muted">{tc('inactive')}</Badge>
                )}
              </TD>
              <TD align="end">
                <div className="flex justify-end gap-1">
                  <WhatsappNumberDialog
                    branches={assignable}
                    variant="ghost"
                    iconOnly
                    defaults={{
                      id: row.id,
                      branchId: row.branchId,
                      phoneNumberId: row.phoneNumberId,
                      displayNumber: row.displayNumber,
                      label: row.label,
                    }}
                  />
                  <ToggleWhatsappNumberButton numberId={row.id} isActive={row.isActive} />
                </div>
              </TD>
            </TR>
          ))}
        </TBody>
      </TableShell>

      {/*
        An administrator with the permission and no branch role can open this
        screen and do nothing on it. Saying so beats a select with no options,
        which reads as a bug in the page rather than as a gap in their roles.
      */}
      {assignable.length === 0 ? (
        <p className="mt-3 text-sm text-muted">{t('noBranchRole')}</p>
      ) : null}
    </Register>
  )
}
