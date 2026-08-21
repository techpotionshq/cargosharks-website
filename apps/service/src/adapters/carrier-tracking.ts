/**
 * Container and vessel tracking — `CarrierTracking` in `ports/index.ts`.
 *
 * The port every hour of operations time is hiding behind. Milestones are
 * typed by hand today: a coordinator reads a carrier portal and retypes
 * "vessel departed", "discharged", "gate out" onto the job.
 *
 * ## Carrier-direct, not an aggregator
 *
 * The carriers publish these events themselves over DCSA, free, and DCSA
 * members are about three-quarters of container trade. `dcsa-tracking.ts` is
 * the implementation; `resolveCarrierTracking` below is what a deployment
 * picks between, and there are two choices: typed by hand, or asked of the
 * carrier.
 *
 * An aggregator was built here first and removed. The two reasons are kept
 * because they are what a later "let us just buy a feed" has to answer:
 *
 *   1. **It priced per container**, recurring, scaling with the customer's
 *      volume rather than ours — a commercial decision wearing an engineering
 *      one's clothes.
 *   2. **It did not answer questions.** A bill of lading was submitted, the
 *      aggregator resolved it against the carrier asynchronously, and events
 *      arrived by webhook from then on. That bought an ingestion worker, a
 *      signing secret and a public endpoint that could move a discharge date —
 *      and a demurrage figure moves with it — in exchange for events the
 *      carrier hands over for nothing.
 *
 * `poll(reference)` — ask, and get an answer — is the shape carrier-direct
 * actually has, and it is the shape the port keeps.
 */

import type { CarrierTracking } from '../ports/index'
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

  return manualCarrierTracking
}
