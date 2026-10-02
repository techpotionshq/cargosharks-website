/**
 * Why the assistant cannot answer, as a code the panel translates — U1, U3.
 *
 * These used to be English sentences, written by the route and by the
 * service and shown as-is on Arabic pages. And the case that mattered most was
 * lost among them: an unconfigured `SERVICE_URL` arrived as a generic failure,
 * which the panel read as "the service is down" and told the operator their
 * key was set and something between here and the model was broken — when
 * nothing was broken and nothing was running. Each case now has its own code,
 * and `serviceNotConfigured` its own notice.
 *
 * Plain data and one pure function, so the route, the client hook and the
 * labels can all import it.
 */

export const ASSISTANT_FAILURES = [
  'serviceNotConfigured',
  'noBranch',
  'threadsFailed',
  'threadFailed',
  'closeFailed',
  'couldNotAnswer',
  'couldNotFinish',
  'timedOut',
  'unreachable',
  'notAvailable',
  'aiNotConfigured',
  'aiBudgetExhausted',
] as const

export type AssistantFailure = (typeof ASSISTANT_FAILURES)[number]

/**
 * A code from the route or from the service's stream, in this vocabulary.
 *
 * The service speaks `ai.not_configured`, `ai.budget_exhausted` and `error`
 * (`AiUnavailableError` in `apps/service/src/ai/ledger.ts`). Anything not
 * recognised reads as "could not be reached", the least specific true thing.
 */
export function assistantFailure(code: string | undefined | null): AssistantFailure {
  if (code === 'ai.not_configured') return 'aiNotConfigured'
  if (code === 'ai.budget_exhausted') return 'aiBudgetExhausted'
  if (code === 'error') return 'couldNotFinish'
  return (ASSISTANT_FAILURES as readonly string[]).includes(code ?? '')
    ? (code as AssistantFailure)
    : 'unreachable'
}

/** The failures that mean "the service did not answer", as opposed to a refusal. */
export function isUnreachable(failure: AssistantFailure): boolean {
  return (
    failure === 'unreachable' ||
    failure === 'couldNotAnswer' ||
    failure === 'timedOut' ||
    failure === 'threadsFailed'
  )
}
