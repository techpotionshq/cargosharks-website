/**
 * A direct send to a customer, retried while the failure is the provider's.
 *
 * The two paths that answer a customer on WhatsApp without the dispatcher — the
 * legacy acknowledgement and the intake agent's reply — used to try once and,
 * on a refusal, return having recorded nothing anywhere: a Kapso 503 at nine in
 * the morning was a customer never answered and no row saying so. The
 * dispatcher has its own backoff for queued notifications (FR-NT-06); these
 * sends happen inside a job that has already committed its intake, so they get
 * a short one here instead.
 *
 * Short on purpose. A clarification is worth sending in the next few seconds
 * and worth very little an hour later, after the customer has written again —
 * at which point the next turn answers what they actually said. So: a few
 * quick attempts for what looks transient, none for what looks like our
 * request being wrong, and the last error handed back for the caller to record.
 */

import type { NotificationChannel, OutboundMessage, SendResult } from '../ports/index'

/** The pauses between attempts, in milliseconds — three tries inside seven seconds. */
export const SEND_RETRY_DELAYS_MS: readonly number[] = [1_000, 5_000]

/**
 * Whether a refusal is worth asking again: a network error, a timeout, a rate
 * limit or a server error. A 4xx other than 429 is our request (a number that
 * is not on WhatsApp, a token that is wrong) and is as wrong a second time.
 */
export function isTransientSendError(error: string | undefined): boolean {
  if (!error) return true
  const status = /\b([1-5]\d\d)\b/.exec(error)?.[1]
  if (!status) return true
  return status === '429' || status.startsWith('5')
}

export interface RetriedSend extends SendResult {
  /** How many times the provider was asked. */
  readonly attempts: number
}

export async function sendWithRetry(
  channel: NotificationChannel,
  message: OutboundMessage,
  delays: readonly number[] = SEND_RETRY_DELAYS_MS,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
): Promise<RetriedSend> {
  let last: SendResult = { accepted: false, error: 'not attempted' }
  for (let attempt = 0; attempt <= delays.length; attempt += 1) {
    if (attempt > 0) await sleep(delays[attempt - 1]!)
    try {
      last = await channel.send(message)
    } catch (error) {
      last = { accepted: false, error: error instanceof Error ? error.message : String(error) }
    }
    if (last.accepted) return { ...last, attempts: attempt + 1 }
    if (!isTransientSendError(last.error)) return { ...last, attempts: attempt + 1 }
  }
  return { ...last, attempts: delays.length + 1 }
}
