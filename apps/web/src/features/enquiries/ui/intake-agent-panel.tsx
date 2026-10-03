/**
 * The intake agent on this enquiry — what it is doing, and why it did or did
 * not write to the customer.
 *
 * An agent that answers customers on the business's behalf is only trusted if
 * a coordinator can see its reasoning at a glance. So the panel leads with its
 * state in plain words — collecting, waiting for the customer (missing X and
 * Y), complete, handed to a person — and lists its last few turns with the
 * reason each was decided on and the exact text it sent. Silence is shown as a
 * decision with a reason ("the message was a greeting"), never as nothing.
 *
 * The take-over switch sits here because this is where somebody decides they
 * would rather talk to the customer themselves.
 *
 * Renders nothing for an enquiry the agent does not hold.
 */

import { getLocale, getTimeZone, getTranslations } from 'next-intl/server'
import { isWhatsAppWindowClosed } from '@qabandi/core'
import { requireSession } from '@/lib/session'
import { canIn } from '@/lib/permissions'
import { DEFAULT_LOCALE, isLocale } from '@/i18n/request'
import { formatDateTime } from '@/lib/format'
import { Card, CardHeader } from '@/ui/card'
import { Badge } from '@/ui/status'
import { RecordDialog } from '@/ui/record-dialog'
import { enquiryIntake } from '../intake'
import { setIntakeAgent } from '../intake-actions'

/** Requirement keys with a label; an administrator's own key reads as itself. */
const REQUIREMENT_KEYS = [
  'mode',
  'origin',
  'destination',
  'commodity',
  'containerCount',
  'containerType',
  'grossWeightKg',
  'volumeCbm',
  'pieces',
  'readyOn',
  'incoterm',
  'dimensions',
  'weightOrVolume',
  'weight',
] as const

const REASONS = [
  'confirmed',
  'clarified',
  'cap_reached',
  'agent_off',
  'closed',
  'no_new_content',
  'chit_chat',
  'automatic',
  'already_complete',
  'human_active',
  'cooldown',
  'handed_off',
  'loop_guard',
  'model_unavailable',
  'model_retry',
] as const

export async function IntakeAgentPanel({ enquiryId }: { readonly enquiryId: string }) {
  const session = await requireSession()
  const [intake, t, tc, resolved, timeZone] = await Promise.all([
    enquiryIntake(session.actor, enquiryId),
    getTranslations('intakeAgent'),
    getTranslations('common'),
    getLocale(),
    getTimeZone(),
  ])
  if (!intake) return null
  const locale = isLocale(resolved) ? resolved : DEFAULT_LOCALE

  const requirement = (key: string) =>
    (REQUIREMENT_KEYS as readonly string[]).includes(key)
      ? t(`requirements.${key}` as 'requirements.mode')
      : key
  const reason = (key: string) =>
    (REASONS as readonly string[]).includes(key) ? t(`reasons.${key}` as 'reasons.confirmed') : key
  const action = (key: string) =>
    ['confirm', 'clarify', 'handoff', 'none'].includes(key)
      ? t(`actions.${key}` as 'actions.none')
      : key

  const state = !intake.agentEnabled
    ? { tone: 'muted' as const, label: t('off') }
    : intake.state === 'complete'
      ? { tone: 'positive' as const, label: t('states.complete') }
      : intake.state === 'handed_off'
        ? { tone: 'caution' as const, label: t('states.handed_off') }
        : intake.state === 'awaiting_customer'
          ? { tone: 'info' as const, label: t('states.awaiting_customer') }
          : { tone: 'muted' as const, label: t('states.collecting') }

  const missing = intake.missing.map(requirement).join(locale === 'ar' ? '، ' : ', ')
  const canToggle = canIn(session, 'enquiry.assign', intake.branchId)

  return (
    <Card className="mb-4" padding="none">
      <div className="px-4 pt-4 pb-2">
        <CardHeader
          icon="assistant"
          title={t('title')}
          description={t(`channels.${intake.channel}` as 'channels.whatsapp')}
          actions={
            <div className="flex max-w-full flex-wrap items-center gap-2">
              <Badge tone={state.tone}>{state.label}</Badge>
              {canToggle ? (
                <RecordDialog
                  action={setIntakeAgent}
                  icon={intake.agentEnabled ? 'hold' : 'live'}
                  size="sm"
                  variant="secondary"
                  fields={[
                    { kind: 'hidden', name: 'enquiryId', value: enquiryId },
                    {
                      kind: 'hidden',
                      name: 'enabled',
                      value: intake.agentEnabled ? 'false' : 'true',
                    },
                    {
                      kind: 'note',
                      text: intake.agentEnabled ? t('takeOverHint') : t('resumeHint'),
                      tone: intake.agentEnabled ? 'caution' : 'info',
                    },
                  ]}
                  labels={{
                    open: intake.agentEnabled ? t('takeOver') : t('resume'),
                    title: intake.agentEnabled ? t('takeOver') : t('resume'),
                    submit: intake.agentEnabled ? t('takeOver') : t('resume'),
                    submitting: tc('saving'),
                    cancel: tc('cancel'),
                  }}
                />
              ) : null}
            </div>
          }
        />
        <p className="mt-2 text-body-sm text-ink-muted">
          {intake.agentEnabled && intake.state !== 'complete' && intake.missing.length > 0
            ? t('missing', { fields: missing })
            : null}
          {intake.agentEnabled && intake.turnDueAt
            ? ` ${t('nextRead', { time: formatDateTime(intake.turnDueAt, locale, timeZone) })}`
            : null}
        </p>
        <p className="mt-1 text-micro text-ink-subtle">
          {t('summary', {
            turns: intake.turns,
            calls: intake.modelCalls,
            asked: intake.clarifications,
          })}
          {intake.locale ? ` · ${t(`languages.${intake.locale}` as 'languages.en')}` : ''}
        </p>
      </div>

      {intake.recent.length > 0 ? (
        <ul className="divide-y divide-line border-t border-line">
          {intake.recent.map((turn) => (
            <li key={turn.id} className="px-4 py-3">
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <span className="text-body-sm font-medium text-ink">{action(turn.action)}</span>
                <span className="text-body-sm text-ink-muted">{reason(turn.reason)}</span>
                <span className="text-micro text-ink-subtle">
                  {formatDateTime(turn.at, locale, timeZone)} ·{' '}
                  {t('read', { count: turn.messagesRead })}
                  {turn.modelCalled ? ` · ${t('modelCalled')}` : ''}
                </span>
              </div>
              {turn.replyBody ? (
                <p
                  className="mt-1 border-s-2 border-line ps-2 text-body-sm whitespace-pre-line text-ink-muted"
                  dir="auto"
                >
                  {turn.replyBody}
                </p>
              ) : null}
              {turn.sendError ? (
                /*
                  A sentence, never the provider's own words: those are English
                  JSON on an Arabic screen (NEW-2), and they stay in the turn's
                  row and the service log for whoever debugs the channel.
                */
                <p className="mt-1 text-body-sm text-critical">
                  {isWhatsAppWindowClosed(turn.sendError) ? t('sendFailedWindow') : t('sendFailed')}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="border-t border-line px-4 py-3 text-body-sm text-ink-muted">
          {t('noTurnsYet')}
        </p>
      )}
    </Card>
  )
}
