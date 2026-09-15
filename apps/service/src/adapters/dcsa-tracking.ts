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
 * The port's original shape was right and the aggregator tried before it was
 * the outlier: carrier APIs answer "what has happened to this reference" when
 * asked, which is exactly `CarrierTracking.poll`. So this needs no webhook, no
 * inbound route and no public endpoint — a poll worker on a schedule, like
 * `fx-refresh`.
 *
 * ## What is verified here, and what is not
 *
 * The event *shape* is the published DCSA 2.2 model and the mapping is tested
 * against it in `dcsa-events.test.ts`.
 *
 * **Maersk is verified** — host, path, header and response envelope all read
 * off the *Track & Trace Events (Maersk Exchange)* OpenAPI document, v1.5.0,
 * and the auth confirmed against the live gateway. **Hapag-Lloyd and CMA CGM
 * are not**: those two are documented gateways nobody here has held a key for.
 *
 * Getting Maersk wrong the first time is why both halves of the URL are
 * overridable and not just the host. The first real key was for the open
 * product and the profile pointed at the private one — same gateway, different
 * proxy — and a 401 from the wrong path is indistinguishable from a bad key
 * until you compare it against a deliberately invalid one.
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
  /**
   * How long a reference this gateway will accept, per kind.
   *
   * The first draft of this made it a *minimum*, reasoning that JSON Schema
   * `pattern` is unanchored — `[a-zA-Z0-9]{9}` matches any string
   * *containing* nine alphanumerics — so only the too-short could be certain
   * to fail. The live gateway disproved it: a nine-character bill of lading
   * answers `404` (looked up, not found) and a ten-character one answers `400
   * Validation errors`. Maersk anchors it.
   *
   * So these are real bounds, and they come from evidence where there is any:
   *
   *   booking_number  9..9   404 at nine, 400 at ten — verified
   *   bill_of_lading  9..9   the same, and the same request
   *   container      11..15  `pattern {11}` with a separate `maxLength: 15`,
   *                          which is schema only — no live reference yet
   *
   * Omit for a carrier whose rules are not known. No rule means ask anyway:
   * refusing to look up a reference that would have worked is a worse failure
   * than spending one call to find out.
   */
  readonly referenceLengths?: Partial<
    Record<TrackingQuery['type'], { readonly min: number; readonly max: number }>
  >
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
    /*
      *Track & Trace Events (Maersk Exchange)*, v1.5.0 — verified against the
      published OpenAPI document, which is the only one of the three profiles
      that can say so.

      `public-events`, and the word does not mean what it looks like. This is
      the *open* product — "classified as an open API, meaning it does not use
      OAuth 2.0" — not a public dataset. It answers for shipments booked with
      Maersk and is gated by a signed agreement and a per-key quota, so the
      distinction from the private product is the authentication ceremony
      rather than whose cargo you may ask about.

      The sibling `/track-and-trace-private/events` is the OAuth-bearing
      product. Reaching it means overriding **both** halves — the `/track-and-
      trace` prefix belongs to this product and lives in the base URL, so a
      path override alone would send the request to
      `/track-and-trace/track-and-trace-private/events`:

        DCSA_MAERSK_BASE_URL=https://api.maersk.com
        DCSA_MAERSK_EVENTS_PATH=/track-and-trace-private/events
        DCSA_MAERSK_CLIENT_SECRET=...

      `tokenUrl` below is dormant until a secret exists, which is what lets one
      profile serve both.
    */
    baseUrl: 'https://api.maersk.com/track-and-trace',
    eventsPath: '/public-events',
    /* v1.5.0 schema, corrected by the gateway — see `referenceLengths`. */
    referenceLengths: {
      booking_number: { min: 9, max: 9 },
      bill_of_lading: { min: 9, max: 9 },
      container: { min: 11, max: 15 },
    },
    needsSecret: false,
    tokenUrl: 'https://api.maersk.com/customer-identity/oauth/v2/access_token',
    /*
      `Consumer-Key` exactly, from the document's `securitySchemes`. Confirmed
      live as well: the gateway answers `ERR_GW_001` — "Invalid or expired
      Key" — when it is wrong, and an Akamai block when the header is missing
      entirely, so it is provably being read rather than ignored.
    */
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
 * A reference as the carrier spells it, not as an operator typed it.
 *
 * `MRKU 123456-7` and `mrku1234567` are the same container, and a gateway
 * whose pattern is `[a-zA-Z0-9]{11}` accepts neither. Separators and case are
 * presentation — a bill of lading is printed with spaces because that is how
 * people read twelve digits — so normalising them away costs nothing and
 * rescues the most common way a reference fails.
 *
 * Applied to the *request only*. `jobs.master_bill_number` keeps whatever was
 * entered, because a document records what was said: a bill issued in March
 * must still print in November exactly as it was issued, and silently
 * rewriting it to suit an API would be the integration editing history.
 */
function normaliseReference(reference: string): string {
  return reference.replace(/[^a-zA-Z0-9]/g, '').toUpperCase()
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
    /**
     * Which carrier refused — the profile key, not the SCAC.
     *
     * A rate limit is charged against the *gateway*, and one gateway answers
     * for several SCACs: Maersk covers Sealand, CMA CGM covers ANL and APL.
     * A caller backing off on the SCAC it happened to ask with would keep
     * hammering the same gateway through its sibling brands.
     */
    readonly carrier = 'dcsa',
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
  /**
   * The reference cannot match this carrier's rules, so nothing was asked.
   *
   * Distinct from `unknownReference` — that one means the carrier looked and
   * said no. This one means we never spent the call, which on a tier capped at
   * twenty an hour is the difference between one wasted request and a leak
   * that repeats every run for as long as the data stays wrong.
   */
  readonly malformedReference?: string
}

export interface DcsaTracking extends CarrierTracking {
  /** Every SCAC this deployment holds credentials for. */
  readonly scacs: readonly string[]
  /**
   * Which gateway answers for a SCAC, for a caller that has to back off.
   *
   * The rate limit belongs to the gateway rather than to the brand, so a
   * caller that has just been told to slow down needs to know which *other*
   * SCACs to stop asking about.
   */
  carrierFor(scac: string): string | undefined
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
  const reference = normaliseReference(query.reference)
  const bounds = profile.referenceLengths?.[query.type]

  /*
    Refused before the request, not after.

    A reference the carrier's validator will reject earns a 400 every time it
    is tried — and the poll runs hourly, so one bill of lading with a digit too
    many spends a call an hour, forever, to be told the same thing. Saying so
    without asking costs nothing and names the job whose data needs fixing.
  */
  if (bounds && (reference.length < bounds.min || reference.length > bounds.max)) {
    const wanted =
      bounds.min === bounds.max
        ? `exactly ${bounds.min}`
        : `between ${bounds.min} and ${bounds.max}`

    return {
      milestones: [],
      estimates: {},
      unmapped: [],
      malformedReference:
        `${query.reference} normalises to ${reference.length} characters; ${profile.key} ` +
        `wants ${wanted} for a ${query.type.replace(/_/g, ' ')}`,
    }
  }

  const url = new URL(`${profile.baseUrl.replace(/\/+$/, '')}${profile.eventsPath}`)
  url.searchParams.set(QUERY_PARAM[query.type], reference)
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
  /*
    404 and 400 are both "this reference is wrong", and neither is worth
    failing a run over. 400 is the carrier rejecting the *format* under a rule
    we did not model — the pre-flight above only catches the certainly
    impossible — so it lands with the malformed ones, where the operator
    action is the same: fix the reference on the job.
  */
  if (response.status === 404) {
    return { milestones: [], estimates: {}, unmapped: [], unknownReference: true }
  }

  if (response.status === 400) {
    const detail = await response.text().catch(() => '')
    return {
      milestones: [],
      estimates: {},
      unmapped: [],
      /*
        A longer slice than the other error paths get. A validation error
        carries `subErrors` naming the offending field and value, and that is
        the whole content — truncating at 200 characters cut it off just before
        the part worth reading.
      */
      malformedReference: `${profile.key} rejected ${query.reference}: ${detail.slice(0, 600)}`,
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
      profile.key,
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
async function fetchDcsaToken(
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
      profile.key,
    )
  }

  const body = (await response.json().catch(() => ({}))) as TokenResponse

  if (!body.access_token) {
    throw new DcsaError(
      `${profile.key} returned no access_token`,
      response.status,
      false,
      profile.key,
    )
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
    carrierFor: (scac) => byScac.get(scac.trim().toUpperCase())?.key,
    read,
    poll: (query): Promise<CarrierMilestone[]> => read(query).then((reading) => reading.milestones),
  }
}
