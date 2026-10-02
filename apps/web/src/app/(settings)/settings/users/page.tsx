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
import { Breakable } from '@/ui/breakable'

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
                        <span aria-hidden className="mx-1 opacity-50">
                          ·
                        </span>
                        {tNav(`roles.${assignment.roleKey}`)}
                      </Badge>
                    ))}
                  </span>
                )
              const signIn =
                person.type === 'system' ? (
                  <span className="text-caption text-ink-subtle">{t('systemOnly')}</span>
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
                    <span className="text-caption text-ink-subtle">
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
                    <span className="@3xl:hidden">
                      <span className="ref mt-0.5 block text-caption font-normal text-ink-muted">
                        <Breakable text={person.email} />
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
                  <TD align="end" className="whitespace-nowrap">
                    {/*
                      Edit: name, language, whether they can sign in, and the
                      role in each branch this administrator administers (QA
                      P1-3). Not for the system principal, which nobody signs
                      in as and whose grants the workers depend on.
                    */}
                    {person.type === 'system' ? null : (
                      <UserDialog
                        iconOnly
                        variant="ghost"
                        defaults={{
                          id: person.id,
                          nameEn: person.nameEn,
                          nameAr: person.nameAr,
                          email: person.email,
                          phone: person.phone,
                          locale: person.locale,
                          isActive: person.isActive,
                          grants: person.assignments.flatMap((a) =>
                            a.branchId && a.roleId
                              ? [{ branchId: a.branchId, roleId: a.roleId }]
                              : [],
                          ),
                        }}
                      />
                    )}
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
        <Card className="@4xl:col-span-7" padding="none">
          <div className="p-5 pb-3">
            <CardHeader
              icon="users"
              eyebrow={t('eyebrow')}
              title={t('rolesTitle')}
              description={t('rolesHint')}
            />
          </div>
          <TableShell className="border-t border-line">
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
                    {/* The name only. The key beside it (`operations_manager`)
                        is the seed's identifier, not something an
                        administrator reads or types anywhere in the product. */}
                    <span className="font-medium text-ink">
                      {locale === 'ar' ? role.nameAr : role.nameEn}
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

        <Card className="@4xl:col-span-5">
          <CardHeader icon="admin" eyebrow={t('eyebrow')} title={t('addTitle')} />
          {/*
            The invitation, in words. This card printed a `pnpm db:create-user`
            command — the way the *first* administrator is made, from a shell
            on the server, which nobody reading this screen has or needs: the
            Invite button above is how everyone after them arrives.
          */}
          <p className="mt-4 text-body-sm text-ink-muted">{t('addBody')}</p>
          <p className="mt-3 text-caption text-ink-subtle">{t('addNote')}</p>
        </Card>
      </Grid>
    </Register>
  )
}
