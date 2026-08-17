/**
 * Container and vessel tracking — `CarrierTracking` in `ports/index.ts`.
 *
 * The port every hour of operations time is hiding behind. Milestones are
 * typed by hand today: a coordinator reads a carrier portal and retypes
 * "vessel departed", "discharged", "gate out" onto the job.
 *
 * ## The port's shape is wrong for this provider, and that is worth saying
 *
 * `CarrierTracking.poll(reference)` assumes a provider will answer "what has
 * happened to this container" whenever asked. Terminal49 does not work that
 * way, and running the first request against a real key is what established
 * it:
 *
 *   1. you **submit** a bill of lading or booking number and a carrier SCAC
 *   2. Terminal49 resolves it against the carrier asynchronously —
 *      `status: "pending"` at creation, minutes to hours to settle
 *   3. it **pushes** container events at you by webhook from then on
 *
 * The path this file originally called — `/v2/containers/{ref}/transport_events`
 * — does not exist. It was inferred from the shape of the port rather than
 * from the provider, and the provider is the one that decides.
 *
 * So the integration is two halves that meet in the database:
 *
 *   `submitTracking`  once per job, when the bill of lading is known
 *   the webhook       `webhooks/index.ts` → `mapProviderEvents` → milestones
 *
 * `poll` stays on the port because polling providers do exist — Vizion answers
 * that shape — and a second adapter beside this one is exactly what a port is
 * for. This one refuses it rather than pretending.
 *
 * ## What is verified, and what is not
 *
 * Submission is verified against the live API with a real key: `201 Created`,
 * JSON:API envelope, `status: "pending"`. Reading anything back returns `401`
 * on a free plan — *"You do not have permissions for using the API, except for
 * creating tracking requests"* — so the webhook ingestion is tested against
 * recorded payload shapes rather than a live push.
 *
 * ## What it costs
 *
 * Per-container, recurring, and it scales with the customer's volume rather
 * than ours. A pricing decision before an engineering one, which is why
 * nothing here is enabled by default.
 */

import type { CarrierMilestone, CarrierTracking } from '../ports/index'
import { config } from '../config'

/**
 * Release One, kept as an implementation rather than an absence.
 *
 * Operations enters the milestone. An empty list means "this feed has nothing
 * to add", which is the truth, and lets a caller treat every source alike.
 */
export const manualCarrierTracking: CarrierTracking = {
  key: 'manual',
  poll: () => Promise.resolve([]),
}

/** What Terminal49 will accept as the thing to track. */
export type TrackingRequestType = 'bill_of_lading' | 'booking_number' | 'container'

export interface TrackingSubmission {
  readonly reference: string
  readonly type: TrackingRequestType
  /** The carrier's SCAC — `MSCU`, `MAEU`. Omit to let Terminal49 detect it. */
  readonly scac?: string
  /** Our job reference, echoed back on every webhook for this shipment. */
  readonly jobReference?: string
}

export interface TrackingSubmissionResult {
  readonly id: string
  readonly status: string
  readonly failedReason?: string
}

interface TrackingRequestResponse {
  readonly data?: {
    readonly id?: string
    readonly attributes?: {
      readonly status?: string
      readonly failed_reason?: string | null
    }
  }
  readonly errors?: readonly { readonly detail?: string; readonly title?: string }[]
}

/**
 * Ask Terminal49 to start tracking a shipment.
 *
 * Verified against the live API. The response is JSON:API, and the useful part
 * is `status` — `pending` at creation, because the carrier lookup happens
 * afterwards. A `201` means "accepted for resolution", not "found", and a
 * caller that treats it as confirmation will tell an operator a shipment is
 * tracked when it may yet fail.
 *
 * `ref_numbers` carries our job reference so every webhook that follows can be
 * attributed without a mapping table of our own — the difference between an
 * integration that survives a redeploy and one that depends on a cache.
 */
export async function submitTracking(
  submission: TrackingSubmission,
  apiKey: string,
  baseUrl: string,
): Promise<TrackingSubmissionResult> {
  const response = await fetch(`${baseUrl.replace(/\/$/, '')}/v2/tracking_requests`, {
    method: 'POST',
    signal: AbortSignal.timeout(20_000),
    headers: {
      Authorization: `Token ${apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      data: {
        type: 'tracking_request',
        attributes: {
          request_type: submission.type,
          request_number: submission.reference,
          ...(submission.scac
            ? { scac: submission.scac }
            : /*
                Without a SCAC, let Terminal49 work the carrier out.

                A house bill frequently arrives without one, and refusing the
                submission would push the guess onto a coordinator who has
                strictly less information than the provider does.
              */
              { auto_detect_vocc_scac: true }),
          ...(submission.jobReference ? { ref_numbers: [submission.jobReference] } : {}),
        },
      },
    }),
  })

  const body = (await response.json().catch(() => ({}))) as TrackingRequestResponse

  if (!response.ok) {
    const detail = body.errors
      ?.map((e) => e.detail ?? e.title)
      .filter(Boolean)
      .join('; ')
    throw new Error(
      `Terminal49 refused the tracking request (${response.status}): ${detail ?? 'no detail'}`,
    )
  }

  return {
    id: body.data?.id ?? '',
    status: body.data?.attributes?.status ?? 'unknown',
    failedReason: body.data?.attributes?.failed_reason ?? undefined,
  }
}

export interface Terminal49Tracking extends CarrierTracking {
  submit(submission: TrackingSubmission): Promise<TrackingSubmissionResult>
}

/**
 * The provider as the port sees it.
 *
 * `poll` refuses rather than returning an empty list. Empty would mean
 * "nothing has happened to this container" — a claim this adapter cannot make,
 * because Terminal49 has no endpoint that answers the question. On a quiet
 * shipment that lie is indistinguishable from a working feed, which is the
 * worst failure available here.
 */
export function terminal49Tracking(apiKey: string, baseUrl: string): Terminal49Tracking {
  return {
    key: 'terminal49',

    poll(): Promise<CarrierMilestone[]> {
      return Promise.reject(
        new Error(
          'Terminal49 does not answer polls: a shipment is submitted once and its ' +
            'events arrive by webhook. Use submit(), and see webhooks/index.ts ' +
            'for the ingestion side.',
        ),
      )
    },

    submit: (submission) => submitTracking(submission, apiKey, baseUrl),
  }
}

/** Which tracking source this deployment runs on. Manual unless configured. */
export function resolveCarrierTracking(): CarrierTracking {
  if (config.CARRIER_TRACKING_DRIVER !== 'terminal49') return manualCarrierTracking

  if (!config.CARRIER_TRACKING_API_KEY) {
    throw new Error('CARRIER_TRACKING_DRIVER=terminal49 but CARRIER_TRACKING_API_KEY is not set.')
  }

  return terminal49Tracking(config.CARRIER_TRACKING_API_KEY, config.CARRIER_TRACKING_BASE_URL)
}
