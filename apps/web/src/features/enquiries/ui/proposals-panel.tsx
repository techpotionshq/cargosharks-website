/**
 * What a model read off the mail, waiting for a person — `AI-05`.
 *
 * The enquiry sitting under this panel was opened from an email, and every
 * cargo column on it was null until somebody retyped the body three inches
 * above the form. `enquiry-extract.ts` reads that body and proposes; this is
 * where a coordinator turns a proposal into a fact.
 *
 * ## Evidence is the feature, not the confidence
 *
 * Each row leads with the value and the span of mail it came from, because
 * confirming *"2 × 40HC, from line 3"* is a different and much faster job than
 * confirming *"sea_fcl"* against a screen of email. A proposal without its
 * evidence has to be re-derived by hand to be checked, which costs more than
 * typing it did — which is why `evidence` is required-but-nullable in the
 * schema rather than optional.
 *
 * The score is shown small and last. It is an ordering hint and not a
 * probability, and a panel that led with it would invite people to treat it as
 * one.
 *
 * ## Nothing here renders if nothing is pending
 *
 * A permanent empty card on every enquiry would train people to skim past the
 * place the proposals appear.
 */

import { getTranslations } from 'next-intl/server'
import { requireSession } from '@/lib/session'
import { can } from '@/lib/permissions'
import { Card, CardHeader } from '@/ui/card'
import { Badge } from '@/ui/status'
import { enquiryProposals, type EnquiryProposal } from '../proposals'
import { ProposalDecision } from './proposal-decision'
import { AcceptAllProposals } from './accept-all-proposals'

/**
 * The label for each field, keyed off the extraction name.
 *
 * `origin` rather than `origin_id` — the proposal carries the field a person
 * reads, and the column it lands in is the accept path's business.
 */
const FIELD_KEYS = [
  'mode',
  'tradeDirection',
  'origin',
  'destination',
  'commodity',
  'incoterm',
  'readyOn',
  'grossWeightKg',
  'volumeCbm',
  'pieces',
  'dimensions',
  'isDangerous',
] as const

export async function ProposalsPanel({ enquiryId }: { readonly enquiryId: string }) {
  const session = await requireSession()
  const [rows, t] = await Promise.all([
    enquiryProposals(session.actor, enquiryId),
    getTranslations('proposals'),
  ])

  if (rows.length === 0) return null

  const decidable = can(session, 'enquiry.assign')

  return (
    <Card className="mb-4" padding="none">
      {/* The card is unpadded so its rows run edge to edge; the header is not. */}
      <div className="px-4 pt-4 pb-2">
        <CardHeader
          title={t('title')}
          description={decidable ? t('description', { count: rows.length }) : t('readOnly')}
          actions={
            decidable && rows.length > 1 ? (
              <AcceptAllProposals
                enquiryId={enquiryId}
                label={t('acceptAll', { count: rows.length })}
              />
            ) : null
          }
        />
      </div>
      <ul className="divide-y divide-line">
        {rows.map((row) => (
          <li key={row.id} className="flex flex-wrap items-start gap-3 px-4 py-3">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="text-caption font-semibold tracking-wide text-ink-muted uppercase">
                  {label(t, row.field)}
                </span>
                <span className="text-title font-medium text-ink" dir="auto">
                  {row.value}
                </span>
                {row.targetWasEmpty ? null : (
                  /*
                    The column already held something when the model was asked.
                    Worth flagging rather than hiding: it is the case where
                    accepting would replace somebody's typing, and the accept
                    path refuses it — so a coordinator seeing this row should
                    expect the refusal rather than be surprised by it.
                  */
                  <Badge tone="caution">{t('wasFilled')}</Badge>
                )}
              </div>
              {row.evidence ? (
                <p
                  className="mt-1 border-s-2 border-line ps-2 text-body-sm text-ink-muted"
                  dir="auto"
                >
                  {row.evidence}
                </p>
              ) : (
                <p className="mt-1 text-body-sm text-ink-subtle">{t('noEvidence')}</p>
              )}
              <p className="mt-1 text-micro text-ink-subtle">
                {t('provenance', {
                  model: row.model ?? '—',
                  prompt: row.promptVersion ?? '—',
                  confidence: percent(row.confidence),
                })}
              </p>
            </div>
            {decidable ? (
              <ProposalDecision
                proposalId={row.id}
                enquiryId={enquiryId}
                labels={{ accept: t('accept'), reject: t('reject') }}
              />
            ) : null}
          </li>
        ))}
      </ul>
    </Card>
  )
}

/** `numeric(5,4)` arrives as a string; it is displayed and never computed on. */
function percent(confidence: string | null): string {
  if (!confidence) return '—'
  const value = Number(confidence)
  return Number.isFinite(value) ? `${Math.round(value * 100)}%` : '—'
}

/**
 * An unknown field degrades to its own name rather than crashing the page.
 *
 * A surface shipping before its label is a slightly ugly row; a missing
 * message is a blank enquiry file. `panels.tsx` in costing makes the same
 * choice for the same reason.
 */
function label(t: (key: string) => string, field: string): string {
  return (FIELD_KEYS as readonly string[]).includes(field) ? t(`fields.${field}`) : field
}

export type { EnquiryProposal }
