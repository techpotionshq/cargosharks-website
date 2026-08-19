/**
 * Carrier-direct tracking over DCSA Track & Trace — `CarrierTracking`, done
 * without an aggregator.
 *
 * `carrier-tracking.ts` describes the commercial problem this exists to
 * delete: a tracking aggregator charges per container, recurring, scaling with
 * the customer's volume rather than ours, which makes the most repetitive act
 * in the business a line item that grows with success.
 *
 * DCSA removes the reason aggregators existed. The historical argument for
 * paying one was that every carrier spelled "discharged" differently; the
 * Digital Container Shipping Association standardised the data model, and its
 * members — MSC, Maersk, CMA CGM, Hapag-Lloyd, ONE, Evergreen, Yang Ming, HMM,
 * ZIM, PIL — are roughly three-quarters of global container trade. One adapter
 * covers several carriers, and per-carrier auth is the only difference between
 * them. All of them are free; the cost is this file.
 *
 * The port's original shape was right and Terminal49 was the outlier: carrier
 * APIs answer "what has happened to this reference" when asked, which is
 * exactly `CarrierTracking.poll`. So this needs no webhook, no inbound route
 * and no public endpoint — a poll worker on a schedule, like `fx-refresh`.
 *
 * ## What is verified here, and what is not
 *
 * The event *shape* is the published DCSA 2.2 model and the mapping is tested
 * against it in `dcsa-events.test.ts`. The hosts and paths below are each
 * carrier's documented gateway and have **not** been run against a live key —
 * this deployment holds none. That is why every profile's base URL is
 * overridable by environment: a sandbox host, a gateway migration or a carrier
 * that moves a path is a configuration change, not a release.
 *
 * Registration is self-serve for all three, with sandboxes, and per-deployment
 * credentials are exactly what the carriers' licences contemplate (IN-06) —
 * so the operator holds their own keys and we hold none.
 *
 * ## Credentials are per carrier, and half-configured is refused
 *
 * Hapag-Lloyd's gateway takes an id *and* a secret. A deployment that set one
 * would otherwise get 401s from a carrier that looks configured, at 2am, on a
 * shipment that has already sailed — the failure `config.ts` exists to
 * prevent. `resolveDcsaTracking` refuses at boot instead.
 */

import type { CarrierMilestone, CarrierTracking, TrackingQuery } from '../ports/index'
import { readDcsaEvents, type DcsaEvent, type DcsaReading } from './dcsa-events'

/** What a carrier's gateway wants in its headers. Both fields per carrier. */
export interface DcsaCredential {
  readonly key?: string
  readonly secret?: string
}

export interface DcsaCarrierProfile {
  /** How the boot log and the credential map name this carrier. */
  readonly key: string
  /**
   * Every SCAC this gateway answers for.
   *
   * A carrier group is not one SCAC: Maersk answers for Sealand, CMA CGM for
   * ANL and APL. Listing them is what lets a job's carrier partner be matched
   * to a gateway without a second lookup table.
   */
  readonly scacs: readonly string[]
  readonly baseUrl: string
  readonly eventsPath: string
  /** Whether `secret` is required as well as `key`. */
  readonly needsSecret: boolean
  /**
   * An OAuth2 client-credentials endpoint, where the gateway wants a bearer
   * *as well as* its key header.
   *
   * Maersk's `track-and-trace-private` is the case: the Consumer-Key
   * identifies the registered application and the bearer authorises the
   * customer whose shipments are being asked about. Sending only the first
   * reads as an unauthenticated caller, which is a 401 that looks exactly like
   * a wrong key.
   *
   * Absent for the two gateways that authenticate on headers alone.
   */
  readonly tokenUrl?: string
  readonly headers: (credential: DcsaCredential) => Record<string, string>
}

/**
 * The three self-serve carriers, in the order the landscape review ranked them.
 *
 * MSC and ONE are DCSA members with registration-and-approval access rather
 * than self-serve, so they are a fourth and fifth profile and not a rewrite.
 * Evergreen, HMM, Yang Ming and ZIM are still mostly EDI; when they publish,
 * they publish this same model.
 */
export const DCSA_CARRIERS: readonly DcsaCarrierProfile[] = [
  {
    key: 'maersk',
    scacs: ['MAEU', 'MAEI', 'MCPU', 'SEAU', 'SEJJ'],
    baseUrl: 'https://api.maersk.com',
    eventsPath: '/track-and-trace-private/events',
    /*
      The secret is optional here, unlike Hapag's.

      Maersk issues a Consumer-Key to the application and, separately, an
      OAuth client secret to the customer. Which of the two the endpoint
      insists on depends on the product tier the deployment was granted, and
      that is not knowable from here — so the secret is taken when it is given
      and the bearer step is skipped when it is not. A tier that wants both
      then works; a tier that wants only the key is unaffected.
    */
    needsSecret: false,
    tokenUrl: 'https://api.maersk.com/customer-identity/oauth/v2/access_token',
    headers: (credential) => ({ 'Consumer-Key': credential.key ?? '' }),
  },
  {
    key: 'hapag',
    scacs: ['HLCU', 'HLXU'],
    baseUrl: 'https://api.hlag.com/hlag/external',
    eventsPath: '/v2/events',
    /*
      An IBM API Connect gateway, which is why this one takes a pair. Their
      own documentation calls the API beta and advises trusting the website
      over it — which is an argument for the tolerant reader in
      `dcsa-events.ts`, not against wiring them up: a milestone that arrives
      an hour late still arrives without anybody typing it.
    */
    needsSecret: true,
    headers: (credential) => ({
      'X-IBM-Client-Id': credential.key ?? '',
      'X-IBM-Client-Secret': credential.secret ?? '',
    }),
  },
  {
    key: 'cmacgm',
    scacs: ['CMDU', 'ANNU', 'APLU', 'CHNL'],
    baseUrl: 'https://apis.cma-cgm.net/shipment/tnt',
    eventsPath: '/v2/events',
    needsSecret: false,
    headers: (credential) => ({ KeyId: credential.key ?? '' }),
  },
]

/**
 * Our reference vocabulary to DCSA's query parameters.
 *
 * Three parameters and not one, which is the whole reason `TrackingQuery`
 * carries a type. `bill_of_lading` is the *master* bill: a house bill is our
 * own document and means nothing to a carrier, so asking with one returns 404
 * every time and looks like a shipment nothing has happened to.
 */
const QUERY_PARAM: Readonly<Record<TrackingQuery['type'], string>> = {
  booking_number: 'carrierBookingReference',
  bill_of_lading: 'transportDocumentReference',
  container: 'equipmentReference',
}

/**
 * A carrier said no in a way the caller has to distinguish.
 *
 * `retryable` separates "this deployment's key is wrong" — which no amount of
 * retrying fixes and which should stop the run rather than walk the fleet
 * collecting 401s — from a rate limit or a gateway blip, which is exactly what
 * pg-boss's backoff is for.
 */
export class DcsaError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryable: boolean,
  ) {
    super(message)
    this.name = 'DcsaError'
  }
}

/**
 * A reading, plus the one thing only the transport knows.
 *
 * `unknownReference` separates "this carrier has nothing new for this
 * shipment" from "this carrier has never heard of this reference" — a
 * cancelled booking, or a master bill with a digit wrong. Both produce no
 * milestones, and only one of them is worth an operator's attention, so
 * folding them together would bury the actionable case in the quiet one.
 */
export interface DcsaPollResult extends DcsaReading {
  readonly unknownReference?: boolean
}

export interface DcsaTracking extends CarrierTracking {
  /** Every SCAC this deployment holds credentials for. */
  readonly scacs: readonly string[]
  /** `poll`, plus the estimates and the codes this build did not understand. */
  read(query: TrackingQuery): Promise<DcsaPollResult>
}

/**
 * DCSA answers a bare array. Carriers wrap it anyway.
 *
 * Maersk returns the array, Hapag has been seen to nest under `events`, and a
 * gateway that speaks JSON:API puts it under `data`. Reading all three costs
 * six lines and removes a class of "the integration returned nothing" that
 * would otherwise be indistinguishable from a quiet shipment.
 */
function eventsFrom(body: unknown): DcsaEvent[] {
  if (Array.isArray(body)) return body as DcsaEvent[]
  if (body && typeof body === 'object') {
    const record = body as Record<string, unknown>
    for (const field of ['events', 'data', 'transportEvents']) {
      if (Array.isArray(record[field])) return record[field] as DcsaEvent[]
    }
  }
  return []
}

/**
 * Ask one carrier what has happened to one reference.
 *
 * Exported so it can be exercised against a stubbed `fetch` without resolving
 * credentials from the environment — the same separation `smtp.ts` gets from
 * `smtpOptions()`, and what lets the interesting half be tested in CI.
 */
export async function fetchDcsaEvents(
  profile: DcsaCarrierProfile,
  credential: DcsaCredential,
  query: TrackingQuery,
  bearer?: string,
): Promise<DcsaPollResult> {
  const url = new URL(`${profile.baseUrl.replace(/\/+$/, '')}${profile.eventsPath}`)
  url.searchParams.set(QUERY_PARAM[query.type], query.reference)
  /*
    A cap rather than pagination. A shipment's whole life is tens of events,
    not thousands, and a cursor loop against three gateways with three
    pagination dialects is three times the surface for a tenth of a case.
  */
  url.searchParams.set('limit', '100')

  const response = await fetch(url, {
    method: 'GET',
    signal: AbortSignal.timeout(20_000),
    headers: {
      Accept: 'application/json',
      ...profile.headers(credential),
      ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
    },
  })

  /*
    404 is an answer, not a failure.

    The carrier is saying it has never heard of this reference — a booking
    cancelled, a master bill mistyped, or a booking made so recently it has
    not reached their tracking system. None of those is worth failing a run
    over, and none of them should look like "nothing has happened yet", so it
    comes back as a stated reason the worker logs.
  */
  if (response.status === 404) {
    return {
      milestones: [],
      estimates: {},
      unmapped: [],
      unknownReference: true,
    }
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    /*
      Auth and quota are the two failures worth naming.

      401/403 is this deployment's credential and no retry fixes it; 429 and
      5xx are the carrier's day and a retry is exactly right. Anything else is
      treated as retryable, because a gateway inventing a status is more
      likely to be transient than to be our key.
    */
    const fatal = response.status === 401 || response.status === 403
    throw new DcsaError(
      `${profile.key} refused the track request (${response.status})` +
        (detail ? `: ${detail.slice(0, 300)}` : ''),
      response.status,
      !fatal,
    )
  }

  const body = (await response.json().catch(() => [])) as unknown

  return readDcsaEvents(eventsFrom(body))
}

interface TokenResponse {
  readonly access_token?: string
  readonly expires_in?: number
}

/**
 * Exchange a client secret for a bearer, OAuth2 client-credentials.
 *
 * Exported for the same reason `fetchDcsaEvents` is: it takes its credential
 * rather than reading one, so the request it builds can be checked without an
 * account. Form-encoded and not JSON — that is what the grant type specifies
 * and what the gateway parses.
 */
export async function fetchDcsaToken(
  profile: DcsaCarrierProfile,
  credential: DcsaCredential,
): Promise<{ token: string; expiresInSeconds: number }> {
  const response = await fetch(profile.tokenUrl!, {
    method: 'POST',
    signal: AbortSignal.timeout(20_000),
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
      ...profile.headers(credential),
    },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: credential.key ?? '',
      client_secret: credential.secret ?? '',
    }),
  })

  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    /*
      Never retryable. A token exchange that fails is a wrong secret or a
      revoked application, and both are configuration — retrying spends the
      run proving it.
    */
    throw new DcsaError(
      `${profile.key} refused the token exchange (${response.status})` +
        (detail ? `: ${detail.slice(0, 300)}` : ''),
      response.status,
      false,
    )
  }

  const body = (await response.json().catch(() => ({}))) as TokenResponse

  if (!body.access_token) {
    throw new DcsaError(`${profile.key} returned no access_token`, response.status, false)
  }

  return { token: body.access_token, expiresInSeconds: body.expires_in ?? 3600 }
}

/**
 * The carrier-direct adapter, over whichever carriers this deployment can
 * authenticate to.
 *
 * `scacs` is the useful half of the public surface: the poll worker uses it to
 * select jobs *before* it asks, so a shipment on a carrier nobody has
 * registered with is never a failed call and never an error in the log — it is
 * simply a job the feed has nothing to say about, which is the truth.
 */
export function dcsaTracking(
  credentials: Readonly<Record<string, DcsaCredential>>,
  profiles: readonly DcsaCarrierProfile[] = DCSA_CARRIERS,
): DcsaTracking {
  const configured = profiles.filter((profile) => credentials[profile.key]?.key)

  /*
    One bearer per carrier, held for as long as the carrier said it is good for.

    Kept on the adapter rather than in a module-level map because the adapter
    is resolved once at boot and memoised (`adapters()`), so its lifetime is
    the process — and because a module-level cache would leak between the two
    adapters a test constructs side by side.

    Refreshed a minute early. A token that expires between the check and the
    request produces a 401 that reads as a bad key, which is the most
    expensive wrong diagnosis available here.
  */
  const tokens = new Map<string, { token: string; expiresAt: number }>()

  const bearerFor = async (profile: DcsaCarrierProfile): Promise<string | undefined> => {
    const credential = credentials[profile.key] ?? {}

    /*
      No token URL, or no secret to exchange, means this gateway authenticates
      on its headers alone — which is true of two of the three, and true of
      Maersk on the tiers that do not issue an OAuth secret.
    */
    if (!profile.tokenUrl || !credential.secret) return undefined

    const held = tokens.get(profile.key)
    if (held && held.expiresAt > Date.now()) return held.token

    const fresh = await fetchDcsaToken(profile, credential)
    tokens.set(profile.key, {
      token: fresh.token,
      expiresAt: Date.now() + Math.max(0, fresh.expiresInSeconds - 60) * 1000,
    })

    return fresh.token
  }

  const byScac = new Map<string, DcsaCarrierProfile>()
  for (const profile of configured) {
    for (const scac of profile.scacs) byScac.set(scac.toUpperCase(), profile)
  }

  const read = async (query: TrackingQuery): Promise<DcsaPollResult> => {
    const scac = query.scac?.trim().toUpperCase()

    /*
      Refused rather than answered empty, and this is the lesson
      `carrier-tracking.ts` paid for. An empty list means "nothing has
      happened to this container", and on a quiet shipment that claim is
      indistinguishable from a working feed. Being asked about a carrier this
      deployment cannot authenticate to is a caller mistake — the worker has
      `scacs` precisely so it never makes it.
    */
    if (!scac) {
      throw new Error(
        'A DCSA poll needs a SCAC: carriers answer for their own shipments only. ' +
          'It is partners.scac on the job carrier.',
      )
    }

    const profile = byScac.get(scac)

    if (!profile) {
      throw new Error(
        `No DCSA credentials for ${scac}. Configured: ${
          configured.map((c) => c.key).join(', ') || 'none'
        }.`,
      )
    }

    return fetchDcsaEvents(profile, credentials[profile.key] ?? {}, query, await bearerFor(profile))
  }

  return {
    key:
      configured.length > 0 ? `dcsa (${configured.map((c) => c.key).join(', ')})` : 'dcsa (none)',
    scacs: [...byScac.keys()],
    read,
    poll: (query): Promise<CarrierMilestone[]> => read(query).then((reading) => reading.milestones),
  }
}
