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
 * ## What it costs, and what replaced it
 *
 * Per-container, recurring, and it scales with the customer's volume rather
 * than ours. A pricing decision before an engineering one, which is why
 * nothing here is enabled by default.
 *
 * `dcsa-tracking.ts` is the answer to that cost and is the driver to reach for
 * first: the carriers publish the same events themselves, free, and DCSA
 * members are about three-quarters of container trade. This adapter stays
 * because an aggregator still covers the quarter that does not publish, and
 * because `resolveCarrierTracking` below is what a deployment picks between.
 */

import type { CarrierMilestone, CarrierTracking } from '../ports/index'
import type { LiveIntegration } from '../settings'
import {
  DCSA_CARRIERS,
  dcsaTracking,
  type DcsaCarrierProfile,
  type DcsaCredential,
} from './dcsa-tracking'

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

/**
 * Which settings key holds each carrier's credentials, and what that carrier
 * calls the two slots.
 *
 * The adapter models one credential shape — a key and an optional secret —
 * because that is what the three gateways actually take. What differs is only
 * the name on the portal page the administrator is copying from, and getting
 * that name right on the screen is the difference between a key pasted into
 * the correct box and an afternoon of 401s.
 */
const DCSA_SETTINGS: Record<string, { key: string; keyName: string; secretName?: string }> = {
  maersk: { key: 'carrierMaersk', keyName: 'consumerKey', secretName: 'clientSecret' },
  hapag: { key: 'carrierHapag', keyName: 'clientId', secretName: 'clientSecret' },
  cmacgm: { key: 'carrierCmacgm', keyName: 'apiKey' },
}

/** Every settings key the carrier tracking resolver needs, for the caller to load. */
export const CARRIER_SETTINGS_KEYS: readonly string[] = [
  'carrierTracking',
  ...Object.values(DCSA_SETTINGS).map((entry) => entry.key),
]

/** What `resolveCarrierTracking` is handed: the driver row, and one per carrier. */
export interface CarrierSettings {
  readonly tracking: LiveIntegration
  readonly carriers: Readonly<Record<string, LiveIntegration>>
}

/**
 * The DCSA credentials this deployment can authenticate with.
 *
 * Lives here rather than in `dcsa-tracking.ts` for the same reason
 * `smtpOptions()` lives outside `smtp.ts`: the adapter takes credentials and
 * knows nothing about where they came from, which is what lets it be tested
 * against a stubbed `fetch` with no environment at all.
 */
export function dcsaCredentials(settings: CarrierSettings): Record<string, DcsaCredential> {
  const credentials: Record<string, DcsaCredential> = {}

  for (const [carrier, entry] of Object.entries(DCSA_SETTINGS)) {
    const source = settings.carriers[entry.key]
    if (!source) continue
    credentials[carrier] = {
      key: source.secret(entry.keyName),
      secret: entry.secretName ? source.secret(entry.secretName) : undefined,
    }
  }

  return credentials
}

/**
 * The stock profiles, with whatever this deployment has overridden.
 *
 * Both halves of the URL, because a carrier's product tiers can differ by path
 * on the same host — Maersk's public Track & Trace and its private one are the
 * same gateway and a different proxy, and a key issued for one is refused by
 * the other. Overriding the host alone would have made that a code change.
 */
function dcsaProfiles(settings: CarrierSettings): DcsaCarrierProfile[] {
  return DCSA_CARRIERS.map((profile) => {
    const entry = DCSA_SETTINGS[profile.key]
    const source = entry ? settings.carriers[entry.key] : undefined
    return {
      ...profile,
      baseUrl: source?.text('baseUrl') ?? profile.baseUrl,
      eventsPath: source?.text('eventsPath') ?? profile.eventsPath,
    }
  })
}

/** Which tracking source this deployment runs on. Manual unless configured. */
export function resolveCarrierTracking(settings: CarrierSettings): CarrierTracking {
  const tracking = settings.tracking

  if (tracking.driver === 'dcsa') {
    const credentials = dcsaCredentials(settings)
    const profiles = dcsaProfiles(settings)

    /*
      A half-configured carrier is refused here, not at 2am.

      Hapag's gateway takes an id and a secret. Setting one of the two would
      produce 401s from a carrier that reads as configured in the boot log,
      against shipments that have already sailed — which is the failure this
      whole file's `config.ts` sibling exists to prevent.

      Thrown rather than returned, and caught by `adapters/index.ts`: an
      environment that says this at boot should still refuse to start, and a
      *row* that says it must degrade to manual and go red on the screen
      instead. Those are different policies about the same mistake, and the
      caller is the only place that knows which layer the value came from.
    */
    for (const profile of profiles) {
      const credential = credentials[profile.key]
      if (profile.needsSecret && credential?.key && !credential.secret) {
        throw new Error(
          `DCSA carrier ${profile.key} needs both an id and a secret. Set both, or neither.`,
        )
      }
    }

    if (!profiles.some((profile) => credentials[profile.key]?.key)) {
      throw new Error(
        'Carrier tracking is set to `dcsa` but no carrier credentials are set. Register ' +
          'with at least one of Maersk, Hapag-Lloyd or CMA CGM — all self-serve, all free — ' +
          'and set its key, or leave tracking on manual.',
      )
    }

    return dcsaTracking(credentials, profiles)
  }

  if (tracking.driver !== 'terminal49') return manualCarrierTracking

  const apiKey = tracking.secret('apiKey')

  if (!apiKey) {
    throw new Error('Carrier tracking is set to `terminal49` but no API key is set.')
  }

  return terminal49Tracking(apiKey, tracking.text('baseUrl') ?? 'https://api.terminal49.com')
}
