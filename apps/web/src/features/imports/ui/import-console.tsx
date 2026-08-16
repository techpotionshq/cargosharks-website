'use client'

/**
 * The import screen — `FR-MD-11`, `FR-RT-09`.
 *
 * Three states, in one form, in this order, because reversing any pair of them
 * is how a bulk import becomes a bulk mistake:
 *
 *   1. **Choose a file and check it.** Nothing is written. The operator's
 *      first action can never be destructive.
 *   2. **Read the report, fix the mapping.** For master data the mapping is
 *      almost always right and this step is a glance. For an agent tariff it
 *      is the actual work, which is why the column selectors are here and not
 *      hidden behind a disclosure.
 *   3. **Import,** enabled only when the check passed.
 *
 * The file is re-sent on commit rather than parked on the server. It keeps the
 * action stateless, and it means the thing being written is the file the
 * operator is looking at rather than one uploaded some minutes ago.
 */

import { useActionState, useMemo, useState } from 'react'
import { issuesCsv } from '@qabandi/core/import'
import { Button } from '@/ui/layout'
import { Card, CardHeader } from '@/ui/card'
import { Submit } from '@/ui/form'
import { Icon } from '@/ui/icon'
import { TBody, TD, TH, THead, TR, TableShell } from '@/ui/table'
import { runImport, type ImportState } from '../actions'

export interface FieldSummary {
  readonly key: string
  readonly label: string
  readonly required: boolean
  readonly hint?: string
}

export interface Choice {
  readonly value: string
  readonly label: string
}

export interface ImportConsoleProps {
  readonly kind: string
  readonly fields: readonly FieldSummary[]
  readonly templateHref: string
  readonly branches?: readonly Choice[]
  readonly partners?: readonly Choice[]
  readonly needsBranch: boolean
  readonly needsPartner: boolean
  readonly labels: Record<string, string>
}

const MAX_ROWS_SHOWN = 50

export function ImportConsole({
  kind,
  fields,
  templateHref,
  branches = [],
  partners = [],
  needsBranch,
  needsPartner,
  labels,
}: ImportConsoleProps) {
  const [state, action] = useActionState<ImportState, FormData>(runImport, {})
  const [overrides, setOverrides] = useState<Record<string, number | null>>({})
  const [fileName, setFileName] = useState('')

  // The mapping the engine guessed, with anything the operator changed layered
  // on top. Reset whenever a different file is chosen.
  const mapping = useMemo(() => {
    const base: Record<string, number | null> = {}
    for (const field of fields) base[field.key] = state.mapping?.[field.key] ?? null
    return { ...base, ...overrides }
  }, [fields, state.mapping, overrides])

  const headers = state.headers ?? []
  const checked = state.headers !== undefined
  const ready = state.ok === true && !state.committed
  const issues = state.issues ?? []

  const downloadIssues = (): void => {
    const blob = new Blob([issuesCsv(issues)], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `${kind}-problems.csv`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  return (
    <form action={action} className="flex flex-col gap-5">
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="mapping" value={JSON.stringify(mapping)} />

      {/* ---------------------------------------------------- 1. the file */}
      <Card>
        <CardHeader title={labels.fileTitle!} description={labels.fileHint} />

        <div className="flex flex-col gap-4 pt-1">
          <div className="flex flex-wrap items-center gap-3">
            <label className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-sm border border-line bg-surface px-4 text-[0.875rem] font-medium text-ink transition-colors hover:bg-surface-sunken">
              <Icon name="document" size={15} />
              {labels.chooseFile}
              <input
                type="file"
                name="file"
                accept=".csv,.tsv,.txt,text/csv,text/plain"
                required
                className="sr-only"
                onChange={(event) => {
                  setFileName(event.target.files?.[0]?.name ?? '')
                  setOverrides({})
                }}
              />
            </label>

            <span className="text-[0.8125rem] text-ink-muted">
              {fileName || state.fileName || labels.noFile}
            </span>

            <Button href={templateHref} icon="download" variant="ghost" size="sm">
              {labels.downloadTemplate}
            </Button>
          </div>

          {needsBranch ? (
            <div className="flex flex-col gap-1.5">
              <label htmlFor="branchId" className="text-[0.8125rem] font-medium text-ink">
                {labels.branch}
              </label>
              <select
                id="branchId"
                name="branchId"
                required
                className="h-10 w-full max-w-sm rounded-sm border border-line bg-surface px-3 text-[0.875rem] text-ink"
              >
                <option value="">{labels.chooseBranch}</option>
                {branches.map((branch) => (
                  <option key={branch.value} value={branch.value}>
                    {branch.label}
                  </option>
                ))}
              </select>
              <p className="text-[0.75rem] text-ink-subtle">{labels.branchHint}</p>
            </div>
          ) : null}

          {needsPartner ? (
            <div className="flex flex-wrap gap-4">
              <div className="flex flex-col gap-1.5">
                <label htmlFor="direction" className="text-[0.8125rem] font-medium text-ink">
                  {labels.direction}
                </label>
                <select
                  id="direction"
                  name="direction"
                  defaultValue="buy"
                  className="h-10 rounded-sm border border-line bg-surface px-3 text-[0.875rem] text-ink"
                >
                  <option value="buy">{labels.buy}</option>
                  <option value="sell">{labels.sell}</option>
                </select>
              </div>
              <div className="flex min-w-64 flex-1 flex-col gap-1.5">
                <label htmlFor="partnerId" className="text-[0.8125rem] font-medium text-ink">
                  {labels.partner}
                </label>
                <select
                  id="partnerId"
                  name="partnerId"
                  className="h-10 w-full rounded-sm border border-line bg-surface px-3 text-[0.875rem] text-ink"
                >
                  <option value="">{labels.choosePartner}</option>
                  {partners.map((partner) => (
                    <option key={partner.value} value={partner.value}>
                      {partner.label}
                    </option>
                  ))}
                </select>
                <p className="text-[0.75rem] text-ink-subtle">{labels.partnerHint}</p>
              </div>
            </div>
          ) : null}

          <div className="flex items-center gap-3 pt-1">
            <button
              type="submit"
              name="intent"
              value="check"
              className="inline-flex h-9 items-center gap-1.5 rounded-sm border border-line bg-surface px-4 text-[0.875rem] font-semibold text-ink transition-colors hover:bg-surface-sunken"
            >
              <Icon name="search" size={15} weight="bold" />
              {labels.check}
            </button>
            {state.error ? (
              <span className="text-[0.8125rem] font-medium text-critical">
                {labels[`error_${state.error}`] ?? labels.error_unknown}
              </span>
            ) : null}
          </div>
        </div>
      </Card>

      {/* ------------------------------------------------- 2. the mapping */}
      {checked && headers.length > 0 ? (
        <Card>
          <CardHeader title={labels.mappingTitle!} description={labels.mappingHint} />
          <TableShell>
            <THead>
              <TR>
                <TH>{labels.field}</TH>
                <TH>{labels.column}</TH>
              </TR>
            </THead>
            <TBody>
              {fields.map((field) => (
                <TR key={field.key}>
                  <TD className="text-ink">
                    <span className="font-medium">{field.label}</span>
                    {field.required ? (
                      <span className="ms-1 text-critical" aria-label={labels.required}>
                        *
                      </span>
                    ) : null}
                    {field.hint ? (
                      <span className="block text-[0.75rem] text-ink-subtle">{field.hint}</span>
                    ) : null}
                  </TD>
                  <TD>
                    <select
                      value={mapping[field.key] ?? ''}
                      onChange={(event) =>
                        setOverrides((current) => ({
                          ...current,
                          [field.key]:
                            event.target.value === '' ? null : Number(event.target.value),
                        }))
                      }
                      className={[
                        'h-8 w-full max-w-xs rounded-sm border bg-surface px-2 text-[0.8125rem]',
                        field.required && mapping[field.key] === null
                          ? 'border-critical text-critical'
                          : 'border-line text-ink',
                      ].join(' ')}
                    >
                      <option value="">{labels.notMapped}</option>
                      {headers.map((header, index) => (
                        <option key={`${header}-${index}`} value={index}>
                          {header || `(${labels.column} ${index + 1})`}
                        </option>
                      ))}
                    </select>
                  </TD>
                </TR>
              ))}
            </TBody>
          </TableShell>

          {state.ignoredColumns && state.ignoredColumns.length > 0 ? (
            <p className="pt-3 text-[0.75rem] text-ink-subtle">
              {labels.ignored}: {state.ignoredColumns.join(', ')}
            </p>
          ) : null}
        </Card>
      ) : null}

      {/* -------------------------------------------------- 3. the report */}
      {checked && !state.committed ? (
        <Card tone={state.ok ? 'default' : 'critical'}>
          <CardHeader
            title={state.ok ? labels.readyTitle! : labels.blockedTitle!}
            description={state.ok ? labels.readyHint : labels.blockedHint}
          />

          <div className="flex flex-wrap gap-6 pb-4">
            <Figure label={labels.rowsRead!} value={state.totalRows ?? 0} />
            <Figure label={labels.rowsAccepted!} value={state.acceptedRows ?? 0} />
            <Figure
              label={labels.problems!}
              value={state.issueCount ?? 0}
              tone={state.issueCount ? 'critical' : 'muted'}
            />
          </div>

          {issues.length > 0 ? (
            <>
              <TableShell>
                <THead>
                  <TR>
                    <TH>{labels.line}</TH>
                    <TH>{labels.column}</TH>
                    <TH>{labels.problem}</TH>
                  </TR>
                </THead>
                <TBody>
                  {issues.slice(0, MAX_ROWS_SHOWN).map((issue, index) => (
                    <TR key={`${issue.line}-${issue.field ?? index}`}>
                      <TD numeric className="ref text-ink">
                        {issue.line}
                      </TD>
                      <TD className="text-ink-muted">{issue.column ?? '—'}</TD>
                      <TD className="text-ink">{issue.message}</TD>
                    </TR>
                  ))}
                </TBody>
              </TableShell>

              <div className="flex flex-wrap items-center gap-3 pt-3">
                {issues.length > MAX_ROWS_SHOWN ? (
                  <span className="text-[0.75rem] text-ink-subtle">
                    {labels.showingFirst} {MAX_ROWS_SHOWN} / {state.issueCount}
                  </span>
                ) : null}
                <button
                  type="button"
                  onClick={downloadIssues}
                  className="inline-flex h-8 items-center gap-1.5 rounded-sm px-3 text-[0.8125rem] font-medium text-ink-muted transition-colors hover:bg-surface-sunken hover:text-ink"
                >
                  <Icon name="download" size={15} />
                  {labels.downloadIssues}
                </button>
              </div>
            </>
          ) : null}

          {ready ? (
            <div className="pt-4">
              <input type="hidden" name="intent" value="commit" />
              <Submit icon="check" pendingLabel={labels.committing}>
                {labels.commit} {state.acceptedRows}
              </Submit>
            </div>
          ) : null}
        </Card>
      ) : null}

      {/* ------------------------------------------------------ 4. the end */}
      {state.committed ? (
        <Card tone="brand">
          <div className="flex items-center gap-3">
            <Icon name="check" size={20} className="text-brand" />
            <div>
              <p className="font-semibold text-ink">{labels.doneTitle}</p>
              <p className="text-[0.8125rem] text-ink-muted">
                {state.committed.cards !== undefined
                  ? `${state.committed.cards} ${labels.doneCards} · ${state.committed.records} ${labels.doneLines}`
                  : `${state.committed.records} ${labels.doneRecords}`}
              </p>
            </div>
          </div>
        </Card>
      ) : null}
    </form>
  )
}

function Figure({
  label,
  value,
  tone = 'muted',
}: {
  readonly label: string
  readonly value: number
  readonly tone?: 'muted' | 'critical'
}) {
  return (
    <div>
      <p className="text-[0.75rem] uppercase tracking-wide text-ink-subtle">{label}</p>
      <p
        className={[
          'text-[1.375rem] font-semibold tabular-nums',
          tone === 'critical' && value > 0 ? 'text-critical' : 'text-ink',
        ].join(' ')}
      >
        {value}
      </p>
    </div>
  )
}
