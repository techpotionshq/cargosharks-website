/**
 * The people at a customer, with the phone number WhatsApp matching keys on (D3).
 *
 * Before this card the only way to put a phone number on a contact was a CSV
 * import, so a customer added by hand could message on WhatsApp all day and
 * every message opened an unmatched enquiry. Visible to anyone who can read the
 * customer; the add, edit and deactivate controls render only where the reader
 * holds `customer.write` in the customer's primary branch, as the actions check.
 */

import { getLocale, getTranslations } from 'next-intl/server'
import { requireSession } from '@/lib/session'
import { can, canIn } from '@/lib/permissions'
import { DEFAULT_LOCALE, isLocale } from '@/i18n/request'
import { Card, CardHeader } from '@/ui/card'
import { RecordDialog, type FieldSpec } from '@/ui/record-dialog'
import { Badge } from '@/ui/status'
import { TableShell, TBody, TD, TH, THead, TR } from '@/ui/table'
import { Breakable } from '@/ui/breakable'
import { listCustomerContacts, type CustomerContactRow } from '../queries'
import { saveCustomerContact, setCustomerContactActive } from '../contacts'

export async function CustomerContactsCard({
  customerId,
  primaryBranchId,
  className,
}: {
  readonly customerId: string
  readonly primaryBranchId: string | null
  readonly className?: string
}) {
  const session = await requireSession()
  const mayWrite = primaryBranchId
    ? canIn(session, 'customer.write', primaryBranchId)
    : can(session, 'customer.write')

  const [contacts, t, tc, resolved] = await Promise.all([
    listCustomerContacts(session.actor, customerId),
    getTranslations('customerContacts'),
    getTranslations('common'),
    getLocale(),
  ])
  const locale = isLocale(resolved) ? resolved : DEFAULT_LOCALE

  const fieldsFor = (contact?: CustomerContactRow): FieldSpec[] => [
    { kind: 'hidden', name: 'customerId', value: customerId },
    ...(contact ? [{ kind: 'hidden' as const, name: 'contactId', value: contact.id }] : []),
    {
      kind: 'text',
      name: 'nameEn',
      label: t('nameEn'),
      span: 6,
      required: true,
      defaultValue: contact?.nameEn,
    },
    { kind: 'text', name: 'nameAr', label: t('nameAr'), span: 6, defaultValue: contact?.nameAr },
    {
      kind: 'tel',
      name: 'phone',
      label: t('phone'),
      span: 6,
      mono: true,
      defaultValue: contact?.phone,
      placeholder: '+965 …',
    },
    {
      kind: 'email',
      name: 'email',
      label: t('email'),
      span: 6,
      defaultValue: contact?.email,
      // A portal login's address is its sign-in name; see `saveCustomerContact`.
      hint: contact?.hasLogin ? t('emailOnLoginHint') : undefined,
    },
    { kind: 'text', name: 'role', label: t('role'), span: 6, defaultValue: contact?.role },
  ]

  const nameOf = (contact: CustomerContactRow) =>
    locale === 'ar' && contact.nameAr ? contact.nameAr : contact.nameEn

  return (
    <Card className={className} padding="none">
      <div className="flex flex-wrap items-start justify-between gap-3 p-5 pb-3">
        <CardHeader
          icon="users"
          eyebrow={t('eyebrow')}
          title={t('title')}
          description={t('description')}
        />
        {mayWrite ? (
          <RecordDialog
            action={saveCustomerContact}
            fields={fieldsFor()}
            icon="plus"
            variant="secondary"
            labels={{
              open: t('add'),
              title: t('addTitle'),
              description: t('formDescription'),
              submit: tc('save'),
              submitting: tc('saving'),
              cancel: tc('cancel'),
            }}
          />
        ) : null}
      </div>
      {contacts.length === 0 ? (
        <p className="border-t border-line px-5 py-4 text-body-sm text-ink-muted">{t('none')}</p>
      ) : (
        <TableShell className="border-t border-line">
          <THead>
            <TR>
              <TH>{t('name')}</TH>
              <TH>{t('phone')}</TH>
              <TH priority="low">{t('email')}</TH>
              <TH priority="low">{t('role')}</TH>
              <TH>{tc('status')}</TH>
              {mayWrite ? <TH align="end">{tc('actions')}</TH> : null}
            </TR>
          </THead>
          <TBody>
            {contacts.map((contact) => (
              <TR key={contact.id}>
                <TD className="font-medium text-ink">
                  {nameOf(contact)}
                  {contact.hasLogin ? (
                    <span className="ms-2 align-middle">
                      <Badge tone="info">{t('portalLogin')}</Badge>
                    </span>
                  ) : null}
                </TD>
                <TD className="ref whitespace-nowrap text-ink">
                  {/* A number reads left to right in either script. */}
                  <span dir="ltr">{contact.phone ?? '—'}</span>
                </TD>
                <TD priority="low" className="ref text-ink-muted">
                  {contact.email ? <Breakable text={contact.email} /> : '—'}
                </TD>
                <TD priority="low" className="text-ink-muted">
                  {contact.role ?? '—'}
                </TD>
                <TD>
                  <Badge tone={contact.isActive ? 'positive' : 'muted'}>
                    {contact.isActive ? tc('active') : tc('inactive')}
                  </Badge>
                </TD>
                {mayWrite ? (
                  <TD align="end">
                    <span className="inline-flex flex-wrap justify-end gap-2">
                      <RecordDialog
                        action={saveCustomerContact}
                        fields={fieldsFor(contact)}
                        variant="ghost"
                        labels={{
                          open: tc('edit'),
                          title: t('editTitle', { name: nameOf(contact) }),
                          description: t('formDescription'),
                          submit: tc('save'),
                          submitting: tc('saving'),
                          cancel: tc('cancel'),
                        }}
                      />
                      <RecordDialog
                        action={setCustomerContactActive}
                        fields={[
                          { kind: 'hidden', name: 'customerId', value: customerId },
                          { kind: 'hidden', name: 'contactId', value: contact.id },
                          // Presence is the signal, as for `setCustomerActive`.
                          ...(contact.isActive
                            ? []
                            : [{ kind: 'hidden' as const, name: 'isActive', value: 'true' }]),
                          {
                            kind: 'note',
                            text: contact.isActive ? t('deactivateNote') : t('restoreNote'),
                            tone: contact.isActive ? 'caution' : 'info',
                          },
                        ]}
                        icon={contact.isActive ? 'hold' : 'check'}
                        variant={contact.isActive ? 'danger' : 'secondary'}
                        labels={{
                          open: contact.isActive ? t('deactivate') : t('restore'),
                          title: contact.isActive
                            ? t('deactivateTitle', { name: nameOf(contact) })
                            : t('restoreTitle', { name: nameOf(contact) }),
                          submit: contact.isActive ? t('deactivate') : t('restore'),
                          submitting: tc('saving'),
                          cancel: tc('cancel'),
                        }}
                      />
                    </span>
                  </TD>
                ) : null}
              </TR>
            ))}
          </TBody>
        </TableShell>
      )}
    </Card>
  )
}
