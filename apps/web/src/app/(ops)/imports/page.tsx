/**
 * Bulk import — `FR-MD-11`, `FR-RT-09`.
 *
 * The screen that decides whether a client who runs on paper ever actually
 * starts. Thirty-four years of customers, agents and ports exist as columns in
 * Excel; without this page the only route in is one dialog at a time, and the
 * person doing the typing gives up somewhere around row two hundred.
 *
 * Five sheets rather than one, because they are five different shapes with
 * five different collision rules — but one engine and one screen behind them,
 * so learning to import a customer list is learning to import a tariff.
 *
 * Each sheet is gated on the permission that would let the operator create one
 * of those records by hand. Bulk creation is still creation, and an account
 * that cannot add a partner must not be able to add nine hundred.
 */

import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import { requireSession } from '@/lib/session'
import { can } from '@/lib/permissions'
import {
  IMPORT_KINDS,
  importKind,
  importNeedsBranch,
  isImportKind,
} from '@/features/imports/descriptors'
import { importableBranches, ratePartners } from '@/features/imports/queries'
import { ImportConsole, type Choice } from '@/features/imports/ui/import-console'
import { usePilotFixtures } from '@/lib/pilot/source'
import { Icon } from '@/ui/icon'
import { EmptyState, PageHeader } from '@/ui/layout'
import Link from 'next/link'
import type { Route } from 'next'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('imports')
  return { title: t('title') }
}

export default async function ImportsPage({
  searchParams,
}: {
  searchParams: Promise<{ kind?: string }>
}) {
  const session = await requireSession()
  const { kind: requested } = await searchParams
  const t = await getTranslations('imports')

  const permitted = IMPORT_KINDS.filter((entry) => can(session, entry.permission))

  if (permitted.length === 0) {
    return (
      <>
        <PageHeader eyebrow={t('eyebrow')} title={t('title')} description={t('subtitle')} />
        <EmptyState icon="admin" title={t('noPermission')} description={t('noPermissionHint')} />
      </>
    )
  }

  const active =
    requested && isImportKind(requested) && permitted.some((entry) => entry.key === requested)
      ? requested
      : permitted[0]!.key

  const entry = importKind(active)!
  const needsBranch = importNeedsBranch(active)
  const needsPartner = active === 'rate-cards'

  /**
   * The pilot runs on fixtures with no database behind them, so there is
   * nothing to import *into*. Saying so is better than offering a form whose
   * submit button fails on a connection error.
   */
  const fixtures = usePilotFixtures()

  let branches: Choice[] = []
  let partners: Choice[] = []
  if (!fixtures) {
    if (needsBranch) {
      branches = (await importableBranches(session.actor)).map((branch) => ({
        value: branch.id,
        label: `${branch.code} — ${branch.nameEn}`,
      }))
    }
    if (needsPartner) {
      partners = (await ratePartners(session.actor)).map((partner) => ({
        value: partner.id,
        label: `${partner.code} — ${partner.nameEn}`,
      }))
    }
  }

  const kindLabel = (key: string): string => {
    switch (key) {
      case 'customers':
        return t('kindCustomers')
      case 'customer-contacts':
        return t('kindContacts')
      case 'partners':
        return t('kindPartners')
      case 'locations':
        return t('kindLocations')
      case 'open-jobs':
        return t('kindOpenJobs')
      case 'open-receivables':
        return t('kindOpenReceivables')
      default:
        return t('kindRates')
    }
  }

  const labels: Record<string, string> = {
    fileTitle: t('fileTitle'),
    fileHint: t('fileHint'),
    chooseFile: t('chooseFile'),
    noFile: t('noFile'),
    downloadTemplate: t('downloadTemplate'),
    branch: t('branch'),
    chooseBranch: t('chooseBranch'),
    branchHint: t('branchHint'),
    direction: t('direction'),
    buy: t('buy'),
    sell: t('sell'),
    partner: t('partner'),
    choosePartner: t('choosePartner'),
    partnerHint: t('partnerHint'),
    check: t('check'),
    mappingTitle: t('mappingTitle'),
    mappingHint: t('mappingHint'),
    field: t('field'),
    column: t('column'),
    required: t('required'),
    notMapped: t('notMapped'),
    ignored: t('ignored'),
    readyTitle: t('readyTitle'),
    readyHint: t('readyHint'),
    blockedTitle: t('blockedTitle'),
    blockedHint: t('blockedHint'),
    rowsRead: t('rowsRead'),
    rowsAccepted: t('rowsAccepted'),
    problems: t('problems'),
    line: t('line'),
    problem: t('problem'),
    showingFirst: t('showingFirst'),
    downloadIssues: t('downloadIssues'),
    commit: t('commit'),
    committing: t('committing'),
    doneTitle: t('doneTitle'),
    doneRecords: t('doneRecords'),
    doneCards: t('doneCards'),
    doneLines: t('doneLines'),
    error_no_file: t('errorNoFile'),
    error_too_large: t('errorTooLarge'),
    error_no_branch: t('errorNoBranch'),
    error_no_partner: t('errorNoPartner'),
    error_unknown_reference: t('errorUnknownReference'),
    error_conflict: t('errorConflict'),
    error_unknown_kind: t('errorUnknownKind'),
    error_unknown: t('errorUnknown'),
  }

  return (
    <>
      <PageHeader eyebrow={t('eyebrow')} title={t('title')} description={t('subtitle')} />

      <nav className="mb-5 flex flex-wrap gap-1.5" aria-label={t('choose')}>
        {permitted.map((option) => {
          const isActive = option.key === active
          return (
            <Link
              key={option.key}
              href={`/imports?kind=${option.key}` as Route}
              aria-current={isActive ? 'page' : undefined}
              className={[
                'inline-flex h-8 items-center rounded-full px-3.5 text-[0.8125rem] font-medium transition-colors',
                isActive
                  ? 'bg-brand text-on-brand'
                  : 'border border-line bg-surface text-ink-muted hover:text-ink',
              ].join(' ')}
            >
              {kindLabel(option.key)}
            </Link>
          )
        })}
      </nav>

      {fixtures ? (
        <div className="mb-5 flex items-start gap-2.5 rounded-sm border border-line bg-surface-sunken p-4">
          <Icon name="alert" size={16} className="mt-0.5 shrink-0 text-ink-muted" />
          <p className="text-[0.8125rem] text-ink-muted">{t('fixturesHint')}</p>
        </div>
      ) : null}

      <ImportConsole
        key={active}
        kind={active}
        fields={entry.descriptor.fields.map((field) => ({
          key: field.key,
          label: field.label,
          required: field.required,
          ...(field.hint === undefined ? {} : { hint: field.hint }),
        }))}
        templateHref={`/api/templates/${active}`}
        branches={branches}
        partners={partners}
        needsBranch={needsBranch}
        needsPartner={needsPartner}
        labels={labels}
      />
    </>
  )
}
