/**
 * Who at this customer can sign in to the portal — FR-MD-03, A7.
 *
 * On the customer's page because that is where the question is asked ("does
 * anyone at Gulf Trading have a login?"), and rendered only for somebody who
 * may grant one. Each login without a password yet carries the same "send
 * sign-in link" button as the staff register, with the same honest outcome.
 */

import { getLocale, getTranslations } from 'next-intl/server'
import { requireSession } from '@/lib/session'
import { can } from '@/lib/permissions'
import { DEFAULT_LOCALE, isLocale } from '@/i18n/request'
import { formatRelative } from '@/lib/format'
import { Card, CardHeader } from '@/ui/card'
import { RecordDialog, type FieldSpec } from '@/ui/record-dialog'
import { Badge } from '@/ui/status'
import { Icon } from '@/ui/icon'
import { TableShell, TBody, TD, TH, THead, TR } from '@/ui/table'
import { listPortalContacts } from '../queries'
import { inviteCustomerContact } from '../portal-contacts'
import { SignInLinkButton } from './sign-in-link-button'

export async function PortalContactsCard({
  customerId,
  className,
}: {
  readonly customerId: string
  readonly className?: string
}) {
  const session = await requireSession()
  if (!can(session, 'admin.users.write')) return null

  const [contacts, t, tc, tUsers, resolved] = await Promise.all([
    listPortalContacts(session.actor, customerId),
    getTranslations('portalContacts'),
    getTranslations('common'),
    getTranslations('users'),
    getLocale(),
  ])
  const locale = isLocale(resolved) ? resolved : DEFAULT_LOCALE
  const now = Date.now()

  const fields: FieldSpec[] = [
    { kind: 'hidden', name: 'customerId', value: customerId },
    { kind: 'text', name: 'nameEn', label: t('nameEn'), span: 6, required: true },
    { kind: 'text', name: 'nameAr', label: t('nameAr'), span: 6 },
    { kind: 'email', name: 'email', label: t('email'), span: 6, required: true },
    {
      kind: 'select',
      name: 'locale',
      label: t('locale'),
      span: 6,
      required: true,
      options: [
        { value: 'en', label: t('locales.en') },
        { value: 'ar', label: t('locales.ar') },
      ],
      defaultValue: 'en',
    },
    { kind: 'note', text: t('inviteNote') },
  ]

  return (
    <Card className={className} padding="none">
      <div className="flex flex-wrap items-start justify-between gap-3 p-5 pb-3">
        <CardHeader
          icon="users"
          eyebrow={t('eyebrow')}
          title={t('title')}
          description={t('description')}
        />
        <RecordDialog
          action={inviteCustomerContact}
          fields={fields}
          icon="plus"
          variant="secondary"
          labels={{
            open: t('invite'),
            title: t('inviteTitle'),
            description: t('inviteDescription'),
            submit: t('inviteSubmit'),
            submitting: tc('saving'),
            cancel: tc('cancel'),
          }}
        />
      </div>
      {contacts.length === 0 ? (
        <p className="border-t border-line px-5 py-4 text-[0.8125rem] text-ink-muted">
          {t('none')}
        </p>
      ) : (
        <TableShell minWidth="none" className="border-t border-line">
          <THead>
            <TR>
              <TH>{t('name')}</TH>
              <TH priority="low">{t('email')}</TH>
              <TH priority="low">{tUsers('signIn')}</TH>
              <TH priority="low">{tUsers('lastSeen')}</TH>
              <TH>{tc('status')}</TH>
            </TR>
          </THead>
          <TBody>
            {contacts.map((contact) => {
              const signIn = contact.hasPassword ? (
                <Icon name="check" size={16} className="text-positive" />
              ) : (
                <span className="flex flex-col items-start gap-1">
                  <span className="text-[0.75rem] text-ink-subtle">
                    {tUsers('awaitingPassword')}
                  </span>
                  {contact.isActive ? (
                    <SignInLinkButton principalId={contact.id} label={tUsers('sendSignInLink')} />
                  ) : null}
                </span>
              )
              return (
                <TR key={contact.id}>
                  {/* Stacked on a phone, as on the users register: the email
                      and an unfinished sign-in (with its button) follow the
                      name, and only last seen waits for a wider screen. */}
                  <TD className="font-medium text-ink">
                    {locale === 'ar' && contact.nameAr ? contact.nameAr : contact.nameEn}
                    <span className="md:hidden">
                      <span className="ref mt-0.5 block text-[0.75rem] font-normal wrap-anywhere text-ink-muted">
                        {contact.email}
                      </span>
                      {contact.hasPassword ? null : (
                        <span className="mt-1.5 block font-normal">{signIn}</span>
                      )}
                    </span>
                  </TD>
                  <TD priority="low" className="ref text-ink-muted">
                    {contact.email}
                  </TD>
                  <TD priority="low">{signIn}</TD>
                  <TD priority="low" className="whitespace-nowrap text-ink-muted">
                    {contact.lastSeenAt ? formatRelative(contact.lastSeenAt, locale, now) : '—'}
                  </TD>
                  <TD>
                    <Badge tone={contact.isActive ? 'positive' : 'muted'}>
                      {contact.isActive ? tc('active') : tc('inactive')}
                    </Badge>
                  </TD>
                </TR>
              )
            })}
          </TBody>
        </TableShell>
      )}
    </Card>
  )
}
