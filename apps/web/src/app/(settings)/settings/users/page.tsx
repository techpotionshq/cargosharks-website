/**
 * Users and roles — `FR-ID-02`, `FR-ID-03`.
 *
 * The product is invitation-only (`FR-ID-07`): there is no self-service
 * sign-up, which is the entry point the 2026 pre-account-hijacking advisory
 * needs. The first administrator is provisioned with `pnpm db:create-user`
 * from a shell; after that, an administrator invites from this screen, which
 * creates the login and emails the person a link to set their own password
 * (A7). Nobody types a colleague's password.
 *
 * What the screen *is* for: seeing who holds what, where. A role is per branch,
 * so the same person can be a coordinator in Kuwait and read-only in Dubai, and
 * that grid is the thing an auditor asks to see.
 */

import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getLocale, getTranslations } from 'next-intl/server'
import { brandMailDomain, getBrand } from '@/lib/brand'
import { requireSession } from '@/lib/session'
import { can } from '@/lib/permissions'
import { listRoles, listUsers } from '@/features/admin/queries'
import { DEFAULT_LOCALE, isLocale } from '@/i18n/request'
import { formatRelative } from '@/lib/format'
import { Card, CardHeader } from '@/ui/card'
import { EmptyState, Grid, PageHeader } from '@/ui/layout'
import { Register } from '@/ui/register'
import { Badge } from '@/ui/status'
import { Icon } from '@/ui/icon'
import { TableShell, TBody, TD, TH, THead, TR } from '@/ui/table'
import { SuspendUserDialog, UserDialog } from '@/features/admin/ui/dialogs'
import { SignInLinkButton } from '@/features/admin/ui/sign-in-link-button'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('users')
  return { title: t('title') }
}

export default async function UsersPage() {
  const session = await requireSession()
  /*
    The layout already decides who reaches this shell, but a page that trusts
    its layout is a page that breaks the day someone links to it directly.
    `notFound` rather than a forbidden page: an account that cannot administer
    users has no business learning that the screen exists.
  */
  if (!can(session, 'admin.users.write')) notFound()

  const t = await getTranslations('users')
  const tc = await getTranslations('common')
  const tNav = await getTranslations('nav')
  const resolved = await getLocale()
  const locale = isLocale(resolved) ? resolved : DEFAULT_LOCALE
  const now = Date.now()

  if (!can(session, 'admin.users.write')) {
    return (
      <>
        <PageHeader eyebrow={t('eyebrow')} title={t('title')} />
        <div className="rounded-card border border-line bg-surface">
          <EmptyState icon="hold" title={t('forbidden')} description={t('forbiddenHint')} />
        </div>
      </>
    )
  }

  const [people, roleRows] = await Promise.all([listUsers(session.actor), listRoles(session.actor)])

  const withLogin = people.filter((person) => person.hasPassword).length

  return (
    <Register
      actions={<UserDialog />}
      eyebrow={t('eyebrow')}
      title={t('title')}
      description={t('subtitle')}
      summary={[
        { label: t('people'), value: people.length },
        { label: t('withLogin'), value: withLogin },
        { label: t('roles'), value: roleRows.length },
      ]}
      isEmpty={false}
      empty={{ title: '' }}
      // Two bodies — the people, then the roles — so each draws its own card.
      framed={false}
    >
      <Card padding="none" className="mb-5 overflow-hidden">
        <TableShell>
          <THead>
            <TR>
              <TH>{t('name')}</TH>
              <TH priority="low">{t('email')}</TH>
              <TH priority="low">{t('assignments')}</TH>
              <TH priority="low">{t('signIn')}</TH>
              <TH priority="low">{t('lastSeen')}</TH>
              <TH>{tc('status')}</TH>
              <TH align="end" />
            </TR>
          </THead>
          <TBody>
            {people.map((person) => {
              const name = locale === 'ar' && person.nameAr ? person.nameAr : person.nameEn
              const assignments =
                person.assignments.length === 0 ? (
                  <span className="text-ink-subtle">{t('noAssignments')}</span>
                ) : (
                  <span className="flex flex-wrap gap-1">
                    {person.assignments.map((assignment) => (
                      <Badge
                        key={`${assignment.branchCode}-${assignment.roleKey}`}
                        tone="info"
                        icon={assignment.requiresTwoFactor ? 'hold' : undefined}
                      >
                        <span className="ref">{assignment.branchCode}</span>
                        <span className="mx-1 opacity-50">·</span>
                        {tNav(`roles.${assignment.roleKey}`)}
                      </Badge>
                    ))}
                  </span>
                )
              const signIn =
                person.type === 'system' ? (
                  <span className="text-[0.75rem] text-ink-subtle">{t('systemOnly')}</span>
                ) : person.hasPassword ? (
                  <Icon name="check" size={16} className="text-positive" />
                ) : (
                  /*
                    Invited, or recorded before invitations created a login —
                    either way they cannot sign in yet, and the register says
                    so rather than drawing a tick (A7). The button reports
                    what became of the mail.
                  */
                  <span className="flex flex-col items-start gap-1">
                    <span className="text-[0.75rem] text-ink-subtle">
                      {person.hasLogin ? t('awaitingPassword') : t('noLoginYet')}
                    </span>
                    {person.isActive ? (
                      <SignInLinkButton principalId={person.id} label={t('sendSignInLink')} />
                    ) : null}
                  </span>
                )
              return (
                <TR key={person.id}>
                  {/*
                    A stacked row on a phone. Seven columns of a person — five
                    of them free text or a wrap of role pills — were 622px
                    wider than the screen, and hiding them left a name with
                    nothing to say about it. So below md this cell carries the
                    email, the roles and, when there is one, the sign-in
                    problem with its button; status and the suspend action stay
                    as columns. Last seen is the only fact a phone gives up.
                  */}
                  <TD className="font-medium text-ink">
                    {name}
                    <span className="md:hidden">
                      <span className="ref mt-0.5 block text-[0.75rem] font-normal wrap-anywhere text-ink-muted">
                        {person.email}
                      </span>
                      <span className="mt-1.5 block font-normal">{assignments}</span>
                      {person.type !== 'system' && !person.hasPassword ? (
                        <span className="mt-1.5 block font-normal">{signIn}</span>
                      ) : null}
                    </span>
                  </TD>
                  {/* A break opportunity before the @: an address has no
                      space to wrap at, and held whole it was 270px of a 966px
                      card — the 8px by which this register scrolled at 1280.
                      Mailbox over domain still reads as one address. */}
                  <TD priority="low" className="ref text-ink-muted">
                    {person.email.includes('@') ? (
                      <>
                        {person.email.slice(0, person.email.indexOf('@'))}
                        <wbr />
                        {person.email.slice(person.email.indexOf('@'))}
                      </>
                    ) : (
                      person.email
                    )}
                  </TD>
                  <TD priority="low">{assignments}</TD>
                  <TD priority="low">{signIn}</TD>
                  <TD priority="low" className="whitespace-nowrap text-ink-muted">
                    {person.lastSeenAt ? formatRelative(person.lastSeenAt, locale, now) : '—'}
                  </TD>
                  <TD>
                    <Badge tone={person.isActive ? 'positive' : 'muted'}>
                      {person.isActive ? tc('active') : tc('inactive')}
                    </Badge>
                  </TD>
                  <TD align="end">
                    <SuspendUserDialog
                      principalId={person.id}
                      name={name}
                      isActive={person.isActive}
                    />
                  </TD>
                </TR>
              )
            })}
          </TBody>
        </TableShell>
      </Card>

      <Grid>
        <Card className="lg:col-span-7" padding="none">
          <div className="p-5 pb-3">
            <CardHeader
              icon="users"
              eyebrow={t('eyebrow')}
              title={t('rolesTitle')}
              description={t('rolesHint')}
            />
          </div>
          <TableShell minWidth="none" className="border-t border-line">
            <THead>
              <TR>
                <TH>{t('role')}</TH>
                <TH align="end">{t('permissions')}</TH>
                <TH>{t('twoFactor')}</TH>
              </TR>
            </THead>
            <TBody>
              {roleRows.map((role) => (
                <TR key={role.key}>
                  <TD>
                    <span className="font-medium text-ink">
                      {locale === 'ar' ? role.nameAr : role.nameEn}
                    </span>
                    {/* Under the name on a phone; beside it the pair could
                        not break and was the table's whole overflow. */}
                    <span className="ref block text-[0.75rem] text-ink-subtle md:ms-2 md:inline">
                      {role.key}
                    </span>
                  </TD>
                  <TD align="end" numeric>
                    {role.permissions}
                  </TD>
                  <TD>
                    {role.requiresTwoFactor ? (
                      <Badge tone="caution" icon="hold">
                        {t('required')}
                      </Badge>
                    ) : (
                      <span className="text-ink-subtle">—</span>
                    )}
                  </TD>
                </TR>
              ))}
            </TBody>
          </TableShell>
        </Card>

        <Card className="lg:col-span-5">
          <CardHeader icon="admin" eyebrow={t('eyebrow')} title={t('addTitle')} />
          <p className="mt-4 text-[0.8125rem] text-ink-muted">{t('addBody')}</p>
          {/*
            The domain comes from the brand for the same reason the sidebar
            does: this is a sample an administrator copies and edits, and one
            reading another company's domain is both wrong and a small leak of
            who else runs this product.
          */}
          <pre className="ref mt-4 overflow-x-auto rounded-md bg-surface-sunken p-3 text-[0.75rem] leading-relaxed text-ink">
            {`pnpm db:create-user \\
  --email person@${brandMailDomain(getBrand())} \\
  --name "Full Name" \\
  --role coordinator \\
  --branch KWI`}
          </pre>
          <p className="mt-3 text-[0.75rem] text-ink-subtle">{t('addNote')}</p>
        </Card>
      </Grid>
    </Register>
  )
}
