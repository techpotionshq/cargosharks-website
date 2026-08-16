/**
 * Users and roles — `FR-ID-02`, `FR-ID-03`.
 *
 * Read-only, and that is a decision rather than an omission. The product is
 * invitation-only (`FR-ID-07`), so accounts are provisioned with
 * `pnpm db:create-user` by someone with shell access to the server — the first
 * administrator necessarily precedes any account that could authorise one, and
 * a self-service "add user" form on an internal freight platform is the entry
 * point the 2026 pre-account-hijacking advisory needs.
 *
 * What the screen *is* for: seeing who holds what, where. A role is per branch,
 * so the same person can be a coordinator in Kuwait and read-only in Dubai, and
 * that grid is the thing an auditor asks to see.
 */

import type { Metadata } from 'next'
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

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('users')
  return { title: t('title') }
}

export default async function UsersPage() {
  const session = await requireSession()
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

  const withLogin = people.filter((person) => person.hasLogin).length

  return (
    <Register
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
    >
      <TableShell className="mb-5">
        <THead>
          <TR>
            <TH>{t('name')}</TH>
            <TH>{t('email')}</TH>
            <TH>{t('assignments')}</TH>
            <TH>{t('signIn')}</TH>
            <TH>{t('lastSeen')}</TH>
            <TH>{tc('status')}</TH>
          </TR>
        </THead>
        <TBody>
          {people.map((person) => (
            <TR key={person.id}>
              <TD className="font-medium text-ink">
                {locale === 'ar' && person.nameAr ? person.nameAr : person.nameEn}
              </TD>
              <TD className="ref text-ink-muted">{person.email}</TD>
              <TD>
                {person.assignments.length === 0 ? (
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
                )}
              </TD>
              <TD>
                {person.hasLogin ? (
                  <Icon name="check" size={16} className="text-positive" />
                ) : (
                  <span className="text-[0.75rem] text-ink-subtle">{t('systemOnly')}</span>
                )}
              </TD>
              <TD className="whitespace-nowrap text-ink-muted">
                {person.lastSeenAt ? formatRelative(person.lastSeenAt, locale, now) : '—'}
              </TD>
              <TD>
                <Badge tone={person.isActive ? 'positive' : 'muted'}>
                  {person.isActive ? tc('active') : tc('inactive')}
                </Badge>
              </TD>
            </TR>
          ))}
        </TBody>
      </TableShell>

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
                    <span className="ref ms-2 text-[0.75rem] text-ink-subtle">{role.key}</span>
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
          <pre className="ref mt-4 overflow-x-auto rounded-md bg-surface-sunken p-3 text-[0.75rem] leading-relaxed text-ink">
            {`pnpm db:create-user \\
  --email person@qabandi.com \\
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
