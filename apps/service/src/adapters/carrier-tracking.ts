/**
 * Container and vessel tracking — `CarrierTracking` in `ports/index.ts`.
 *
 * The port every hour of operations time is hiding behind. Milestones are
 * typed by hand today: a coordinator reads a carrier portal and retypes
 * "vessel departed", "discharged", "gate out" onto the job. It is the single
 * most repetitive act in a forwarding business and the one a provider removes
 * outright.
 *
 * ## Why this is a mapping problem, not an integration problem
 *
 * Every provider answers with its own event vocabulary, and `job_milestones`
 * is keyed on *our* codes — the ones `milestone_templates` seeds and the SLA
 * clocks are counted against. So the adapter's real work is the translation
 * table below, not the HTTP.
 *
 * Getting it wrong is quiet: an unmapped event is a milestone that never
 * completes, an SLA that never stops, and an exception board that grows for
 * reasons nobody can trace back to a vendor's spelling. So unknown codes are
 * **dropped and counted**, never guessed at.
 *
 * ## What this costs
 *
 * Per-container, recurring, and it scales with the customer's volume rather
 * than ours — which is a pricing decision before it is an engineering one.
 * Nothing here is enabled by default for that reason.
 */

import type { CarrierMilestone, CarrierTracking } from '../ports/index'
import { config } from '../config'
import { mapProviderEvents, type ProviderEvent } from './carrier-events'

/**
 * Release One, kept as an implementation rather than an absence.
 *
 * Operations enters the milestone. Returning an empty list means "this feed
 * has nothing to add", which is the truth, and lets the caller treat every
 * source the same way.
 */
export const manualCarrierTracking: CarrierTracking = {
  key: 'manual',
  poll: () => Promise.resolve([]),
}

interface Terminal49Response {
  readonly data?: readonly {
    readonly attributes?: {
      readonly event?: string
      readonly timestamp?: string
      readonly location_locode?: string
    }
  }[]
}

/**
 * Terminal49's container-events API.
 *
 * Named rather than generic because "a tracking provider" is not a thing you
 * can write an adapter for — the auth, the pagination and the event vocabulary
 * differ, and a shape that pretends otherwise ends up mapping the wrong field.
 * A second provider is a second file next to this one, which is the point of
 * the port.
 *
 * **Untested against the live API.** The request and response shape follow the
 * published documentation; nothing here has been run against a real account,
 * because the credential is a commercial decision that has not been made. The
 * mapping it delegates to *is* tested, which is the half that would be wrong
 * in a way nobody notices.
 */
export function terminal49Tracking(apiKey: string, baseUrl: string): CarrierTracking {
  return {
    key: 'terminal49',

    async poll(reference: string): Promise<CarrierMilestone[]> {
      const url = `${baseUrl.replace(/\/$/, '')}/v2/containers/${encodeURIComponent(reference)}/transport_events`

      const response = await fetch(url, {
        signal: AbortSignal.timeout(20_000),
        headers: {
          Authorization: `Token ${apiKey}`,
          Accept: 'application/json',
        },
      })

      /*
        A container the provider has never heard of is not an error.

        References are typed by people and a mistyped one is ordinary. Throwing
        would put a retry in the queue for a container that will never resolve,
        and the operator would see a failing job instead of a job with no
        automatic milestones.
      */
      if (response.status === 404) return []

      if (!response.ok) {
        throw new Error(`Terminal49 answered ${response.status} for ${reference}`)
      }

      const body = (await response.json()) as Terminal49Response

      const events: ProviderEvent[] = (body.data ?? [])
        .map((row) => ({
          event: row.attributes?.event ?? '',
          timestamp: row.attributes?.timestamp ?? '',
          location: row.attributes?.location_locode,
        }))
        .filter((event) => event.event !== '' && event.timestamp !== '')

      const { milestones, unmapped } = mapProviderEvents(events)

      if (unmapped.length > 0) {
        // Logged rather than thrown: an unrecognised event means our table has
        // fallen behind the provider's, which is a thing to fix in a release
        // and not a reason to discard the milestones that did map.
        console.warn(
          JSON.stringify({
            level: 'warn',
            message: 'carrier events not in the milestone map',
            reference,
            codes: [...new Set(unmapped)],
          }),
        )
      }

      return milestones
    },
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
