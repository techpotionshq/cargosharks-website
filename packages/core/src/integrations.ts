/**
 * What this deployment can be wired to, declared once — FR-AD-03.
 *
 * Every integration in the product was an environment variable until this
 * file existed, and the cost of that was not theoretical: the client registers
 * with Maersk themselves, buys their own SMTP relay and appoints their own
 * e-invoice provider (IN-06, Discovery Q5). Each of those credentials arriving
 * meant a redeploy, which in practice meant the capability waited for whoever
 * had the deploy keys rather than for whoever had the credential.
 *
 * ## The catalogue is the authority
 *
 * `INTEGRATIONS` is read by four things that must not disagree:
 *
 *   - the settings screen, which renders a form per integration from it;
 *   - the server action, which validates a save against it;
 *   - the service, which resolves an adapter from the stored row;
 *   - `check-messages.mjs`, which requires a label in both languages for every
 *     key and every field named here.
 *
 * A field added here and forgotten in one of the four fails the build rather
 * than shipping a form that saves a value nothing reads.
 *
 * ## Every field names the variable it replaces
 *
 * `env` is not documentation. Rows override the environment and the
 * environment remains the fallback, so a deployment that has configured
 * nothing on a screen behaves exactly as it did before this file — and a
 * deployment mid-migration can hold half its configuration in each place
 * without a flag day. The settings screen shows which of the two is answering,
 * which is the question that otherwise costs an afternoon.
 *
 * That fallback is also the bootstrap: `SMTP_*` has to work before anybody can
 * sign in to change `SMTP_*`.
 *
 * ## Secrets are named, never valued
 *
 * `secrets` lists the *names* of the credentials an integration takes. The
 * values are sealed with `sealSecret` and live in `integration_settings.secrets`
 * — the same AES-256-GCM under the same environment-held key as a mailbox
 * password, for the same reason: a backup that carries the key it protects is
 * not a backup of encrypted data.
 */

/** A non-secret setting: a host, a path, a batch size, a switch. */
export interface IntegrationField {
  readonly name: string
  readonly kind: 'text' | 'url' | 'number' | 'switch' | 'email'
  /** The variable this falls back to when no row supplies it. */
  readonly env: string
  /** Required before the integration may be switched to a live driver. */
  readonly required?: boolean
  readonly placeholder?: string
  readonly min?: number
  readonly max?: number
  /** Rendered in a monospace field — hosts, paths, templates, identifiers. */
  readonly mono?: boolean
  /**
   * A switch's position when neither layer has an answer — and the one field
   * here that is a security control rather than a convenience.
   *
   * A switch posts nothing when it is off, so a form has to decide what an
   * unchecked box means, and "off" is the obvious answer and the wrong one.
   * `rejectUnauthorized` defaults to `true` in the service config; a
   * deployment that had never set the variable would render the box unchecked,
   * and the first save of any *other* field on that card would write an
   * explicit `false` and quietly disable certificate verification.
   *
   * So the safe position is declared here rather than inferred from absence.
   * Only meaningful for `kind: 'switch'`.
   */
  readonly defaultOn?: boolean
  /**
   * The drivers this field belongs to, where it does not belong to every live
   * one. Absent means all of them.
   *
   * The FX integration has two live drivers and only one of them takes a URL:
   * `api` is a template somebody points at a provider, `resilient` names its
   * two providers in code. Without this a required URL would be demanded of
   * the driver that has no use for it, and the form would refuse to save the
   * one choice that needs nothing configured.
   */
  readonly drivers?: readonly string[]
}

/**
 * A credential. Sealed on the way in and never read back out to the browser.
 *
 * `keepOnBlank` is the mailbox rule generalised: a blank field on an edit
 * means "leave it alone", because an administrator correcting a base URL must
 * not have to re-type a key they may not have in front of them. It is stated
 * per secret rather than assumed globally so that the one place it is wrong —
 * a secret that legitimately clears — can say so.
 */
export interface IntegrationSecret {
  readonly name: string
  readonly env: string
  readonly required?: boolean
  readonly keepOnBlank?: boolean
  /** As `IntegrationField.drivers`. */
  readonly drivers?: readonly string[]
}

/**
 * A driver choice.
 *
 * `live` is what separates "configured" from "switched on", and it is the flag
 * the save validation hangs off: fields marked `required` are demanded only
 * when the chosen driver is live. `manual` and `none` are real implementations
 * (see `apps/service/src/adapters/index.ts`), not absences, so they need no
 * credentials and must not be validated as though they did.
 */
export interface IntegrationDriver {
  readonly value: string
  readonly live: boolean
  /**
   * Choosing this driver needs an administrator to tick an acknowledgement.
   *
   * For a driver whose output a person could mistake for something it is not
   * — a free third-party exchange rate read as a bank's rate. The screen
   * shows the notice and the box, the action refuses a save without the tick,
   * and the row records who ticked it and when (`ACKNOWLEDGEMENT_KEYS`).
   */
  readonly acknowledge?: boolean
}

/**
 * Where a save records the acknowledgement, inside the row's `settings`.
 *
 * In the row rather than a column of its own: `integration_settings` is
 * audited, so the trigger keeps every version of these with the principal
 * who saved it, and the screen can say "acknowledged by … on …" with no
 * migration. Not catalogue fields — nothing resolves them, and the form never
 * renders them as inputs.
 */
export const ACKNOWLEDGEMENT_KEYS = {
  at: 'acknowledgedAt',
  byId: 'acknowledgedById',
  byName: 'acknowledgedByName',
  driver: 'acknowledgedDriver',
} as const

/**
 * Which heading an integration sits under on the settings screen.
 *
 * Twelve flat cards is a list somebody scrolls past. Grouped, it is four short
 * answers to "what is this deployment wired to" — and the grouping is not
 * decoration: the four are owned by different people. Storage and mail are the
 * platform's, the carriers are operations', money is finance's, and the model
 * is a spend somebody signs off.
 */
export type IntegrationGroup = 'platform' | 'carriers' | 'finance' | 'intelligence'

export interface IntegrationSpec {
  readonly key: string
  readonly group: IntegrationGroup
  /** Absent where the integration has no on/off switch, only settings. */
  readonly drivers?: readonly IntegrationDriver[]
  readonly driverEnv?: string
  readonly defaultDriver?: string
  readonly fields: readonly IntegrationField[]
  readonly secrets: readonly IntegrationSecret[]
  /**
   * Whether the screen offers "test connection".
   *
   * Only where a probe is cheap, read-only and unambiguous. A failed SMTP
   * handshake means the relay settings are wrong; a failed carrier call means
   * the key or the path is wrong. Neither writes anything, which is what makes
   * a button on a settings screen the right place for it.
   */
  readonly probe?: boolean
}

/*
  The DCSA carriers share a shape, and writing it three times is how the third
  one drifts. `key` and `secret` are the two credential slots the adapter
  already models (`DcsaCredential`), so what differs per carrier is only what
  they are called in that carrier's portal.
*/
function dcsaCarrier(
  key: string,
  env: { key: string; secret?: string; base: string; path: string },
  secretNames: readonly string[],
): IntegrationSpec {
  return {
    key,
    group: 'carriers',
    fields: [
      {
        name: 'baseUrl',
        kind: 'url',
        env: env.base,
        mono: true,
        placeholder: 'https://api.maersk.com',
      },
      /*
        The path, and not only the host.

        A carrier's product tiers can be different proxies on the same gateway
        and a key issued for one is refused by the other — Maersk's public
        Track & Trace and its private one differ by path alone. Overriding the
        host and not the path is the half-fix this product already shipped
        once, and it read as a bad key rather than as a wrong URL.
      */
      { name: 'eventsPath', kind: 'text', env: env.path, mono: true },
    ],
    secrets: [
      // Every caller passes at least one name; the second is the optional
      // OAuth half that only some carrier tiers issue.
      { name: secretNames[0]!, env: env.key, required: true, keepOnBlank: true },
      ...(env.secret && secretNames[1]
        ? [{ name: secretNames[1]!, env: env.secret, keepOnBlank: true }]
        : []),
    ],
    probe: true,
  }
}

/**
 * Every integration this deployment can hold configuration for.
 *
 * Order is the order of the cards on the settings screen, and it is roughly
 * the order a deployment configures them in: mail first, because without it
 * nobody can be invited to configure anything else.
 */
export const INTEGRATIONS: readonly IntegrationSpec[] = [
  {
    key: 'smtp',
    group: 'platform',
    driverEnv: 'MAIL_DRIVER',
    defaultDriver: 'smtp',
    /*
      `log` is live in the sense that matters here: it is a deliberate choice
      with a working implementation, and it needs no host or credential. The
      flag asks "must the fields below be filled in", not "is mail leaving".
    */
    drivers: [
      { value: 'smtp', live: true },
      { value: 'log', live: false },
    ],
    fields: [
      {
        name: 'host',
        kind: 'text',
        env: 'SMTP_HOST',
        required: true,
        mono: true,
        placeholder: 'smtp.office365.com',
      },
      { name: 'port', kind: 'number', env: 'SMTP_PORT', required: true, min: 1, max: 65535 },
      { name: 'secure', kind: 'switch', env: 'SMTP_SECURE', defaultOn: false },
      { name: 'user', kind: 'text', env: 'SMTP_USER', mono: true },
      {
        name: 'from',
        kind: 'text',
        env: 'MAIL_FROM',
        required: true,
        /*
          Generic on purpose. This catalogue is a plain data table in `core`,
          which imports nothing — `@qabandi/brand` included — so unlike the
          per-entity `From` field in the branch dialog it cannot show the
          operator their own name back. The alternative to a nameless example
          is a hard-coded one, and that is how a client's identity ends up on
          another client's settings screen. `example.com` is reserved by
          RFC 2606 and can never be somebody's live mail domain.
        */
        placeholder: 'Freight Co <no-reply@example.com>',
      },
      /*
        Verifying the server is who it claims to be. On unless a deployment
        deliberately turns it off for a relay behind a private CA — see
        `defaultOn` above for why this must not be inferred from an empty form.
      */
      {
        name: 'rejectUnauthorized',
        kind: 'switch',
        env: 'SMTP_TLS_REJECT_UNAUTHORIZED',
        defaultOn: true,
      },
    ],
    secrets: [{ name: 'password', env: 'SMTP_PASSWORD', keepOnBlank: true }],
    probe: true,
  },

  /*
    Object storage — every document this system stores.

    On the screen for the same reason as the rest: the bucket and its keys are
    the client's, provisioned at Cloudflare R2 or AWS on their account, and a
    key rotation there should not be a deploy here.

    Unlike every other integration, this one has no safe degraded mode. A
    tracking feed that fails means milestones are typed by hand; a file store
    that fails and falls back to `memory` means a document was accepted, stored
    in a process, and lost at the next restart — with nothing anywhere saying
    so. So `memory` is a driver somebody chooses, never one this deployment
    falls back to.
  */
  {
    key: 'fileStore',
    group: 'platform',
    driverEnv: 'FILE_STORE_DRIVER',
    defaultDriver: 's3',
    drivers: [
      { value: 's3', live: true },
      { value: 'memory', live: false },
    ],
    fields: [
      {
        name: 'endpoint',
        kind: 'url',
        env: 'S3_ENDPOINT',
        required: true,
        mono: true,
        placeholder: 'https://<account>.r2.cloudflarestorage.com',
      },
      { name: 'bucket', kind: 'text', env: 'S3_BUCKET', required: true, mono: true },
      /*
        R2 ignores the value and still signs with it, so it is required rather
        than optional — an empty region produces a signature the gateway
        rejects with a message about credentials, which sends the reader
        looking at the wrong field.
      */
      { name: 'region', kind: 'text', env: 'S3_REGION', required: true, mono: true },
      /*
        The access key id is an identifier, not a credential — every cloud
        console shows it in clear beside the secret it pairs with. Keeping it
        visible is what lets an administrator confirm *which* key is in use
        without being able to read the half that matters.
      */
      { name: 'accessKeyId', kind: 'text', env: 'S3_ACCESS_KEY_ID', required: true, mono: true },
      /* R2 wants path-style; AWS deprecated it. */
      { name: 'forcePathStyle', kind: 'switch', env: 'S3_FORCE_PATH_STYLE', defaultOn: true },
    ],
    secrets: [
      { name: 'secretAccessKey', env: 'S3_SECRET_ACCESS_KEY', required: true, keepOnBlank: true },
    ],
    probe: true,
  },

  {
    key: 'fx',
    group: 'finance',
    driverEnv: 'FX_SOURCE',
    defaultDriver: 'manual',
    /*
      Manual stays the default, deliberately, and `resilient` is one click away.

      A deployment that configured nothing must keep behaving as it did: every
      rate typed by hand. Switching a live feed on by default would put a third
      party's number into quotations on a deployment whose administrator never
      saw the acknowledgement the settings screen asks for. `resilient` is the
      recommended choice once somebody has: two free, keyless providers checked
      against each other and the Gulf pegs (`adapters/fx.ts` in the service).
    */
    drivers: [
      { value: 'manual', live: false },
      { value: 'resilient', live: true, acknowledge: true },
      { value: 'api', live: true },
    ],
    fields: [
      /*
        A template rather than a host, so a different provider is a
        configuration change: `{base}` and `{key}` are substituted per request.
        Only the `api` driver reads it.
      */
      {
        name: 'url',
        kind: 'text',
        env: 'FX_API_URL',
        required: true,
        mono: true,
        placeholder: 'https://open.er-api.com/v6/latest/{base}',
        drivers: ['api'],
      },
      /*
        Neither half of "what to fetch" is here, and neither should be.

        The quote currencies are `currencies.is_tracked`; the base currencies
        are the distinct `branches.base_currency` of the active entities. Both
        were settings once and both were a second answer to a question a column
        already answered — `FX_QUOTE_CURRENCIES` could disagree with the
        currency table, and `FX_BASE_CURRENCY` was a single deployment-wide
        value that left a Dubai entity invoicing in AED with no rates fetched
        at all, silently, on a deployment that looked correctly configured.

        So this integration is only ever "which feed, and with what key".
      */
    ],
    secrets: [{ name: 'apiKey', env: 'FX_API_KEY', keepOnBlank: true, drivers: ['api'] }],
    probe: true,
  },

  /*
    The poll's budget, which is arithmetic rather than a credential.

    `.env.example` carried a worked example of `batch × runs-per-hour ≤ the
    carrier's cap` and left an operator to do it by hand at the moment their
    carrier tier changed. It belongs beside the carrier keys because it is set
    *with* them — a Starter tier and a trial tier want different numbers — and
    on a screen because the screen can check the multiplication.
  */
  {
    key: 'carrierPoll',
    group: 'carriers',
    fields: [
      {
        name: 'batch',
        kind: 'number',
        env: 'CARRIER_POLL_BATCH',
        required: true,
        min: 1,
        max: 500,
      },
      { name: 'cron', kind: 'text', env: 'CARRIER_POLL_CRON', required: true, mono: true },
      {
        name: 'activeWithinMinutes',
        kind: 'number',
        env: 'CARRIER_POLL_ACTIVE_WITHIN_MINUTES',
        min: 0,
        max: 10_080,
      },
    ],
    secrets: [],
  },

  {
    key: 'carrierTracking',
    group: 'carriers',
    driverEnv: 'CARRIER_TRACKING_DRIVER',
    defaultDriver: 'manual',
    drivers: [
      { value: 'manual', live: false },
      { value: 'dcsa', live: true },
    ],
    /*
      A driver and nothing else: this row chooses the feed, and the credentials
      belong to the three carrier rows below.

      There was an aggregator driver here with a key and a webhook secret. It
      charged per container and pushed rather than answered, so switching
      tracking on used to mean signing a per-container contract. Carrier-direct
      is free and self-serve, which is why this row has nothing left to fill in.
    */
    fields: [],
    secrets: [],
  },

  dcsaCarrier(
    'carrierMaersk',
    {
      key: 'DCSA_MAERSK_CONSUMER_KEY',
      secret: 'DCSA_MAERSK_CLIENT_SECRET',
      base: 'DCSA_MAERSK_BASE_URL',
      path: 'DCSA_MAERSK_EVENTS_PATH',
    },
    ['consumerKey', 'clientSecret'],
  ),
  dcsaCarrier(
    'carrierHapag',
    {
      key: 'DCSA_HAPAG_CLIENT_ID',
      secret: 'DCSA_HAPAG_CLIENT_SECRET',
      base: 'DCSA_HAPAG_BASE_URL',
      path: 'DCSA_HAPAG_EVENTS_PATH',
    },
    ['clientId', 'clientSecret'],
  ),
  dcsaCarrier(
    'carrierCmacgm',
    {
      key: 'DCSA_CMACGM_API_KEY',
      base: 'DCSA_CMACGM_BASE_URL',
      path: 'DCSA_CMACGM_EVENTS_PATH',
    },
    ['apiKey'],
  ),

  /*
    Vessel positions from AIS — where the ship carrying a job was last heard.

    Ships dark: `off` is the default and opens no connection. `aisstream` holds
    one websocket from the service to aisstream.io, subscribed only to the
    MMSIs of vessels on open sea jobs. It is free and terrestrial only, so it
    hears origin legs (China, Singapore, Europe) and nothing in the Gulf; the
    screens say so rather than drawing an old fix as current.

    A satellite provider (Spire, Datalastic, VesselFinder) is a further driver
    here and a further adapter behind `VesselPositionSource`; the readers and
    the table do not change.
  */
  {
    key: 'vesselPositions',
    group: 'carriers',
    driverEnv: 'VESSEL_POSITIONS_DRIVER',
    defaultDriver: 'off',
    drivers: [
      { value: 'off', live: false },
      { value: 'aisstream', live: true },
    ],
    fields: [],
    secrets: [{ name: 'apiKey', env: 'AISSTREAM_API_KEY', required: true, keepOnBlank: true }],
  },

  /*
    WhatsApp, through Kapso.

    Kapso is a proxy in front of the WhatsApp Cloud API: it provisions the
    number, receives the messages and signs a webhook this service reads at
    `/webhooks/whatsapp`, and it takes outbound sends on a Meta-shaped endpoint.
    So this integration holds one credential — the account's Kapso API key — and
    a base URL to override for staging. The *numbers* the account answers on are
    `whatsapp_numbers` rows, per branch, because a legal entity may hold its own
    (FR-ID-01); the sending number is read from that row at send time, not here.

    Ships dark, like the carriers and the auto-pipeline: `none` is the default
    and needs no key, so a deployment that has bought no WhatsApp number sends
    nothing and falls back to email. An administrator sets the driver to `kapso`
    and pastes the key to switch it on. The inbound half is gated separately and
    the same way — by whether a `whatsapp_numbers` row exists and the webhook
    secret (`KAPSO_WEBHOOK_SECRET`) is set — so a number can receive before the
    account is configured to reply.
  */
  {
    key: 'whatsapp',
    group: 'platform',
    driverEnv: 'WHATSAPP_DRIVER',
    defaultDriver: 'none',
    drivers: [
      { value: 'none', live: false },
      { value: 'kapso', live: true },
    ],
    fields: [
      {
        name: 'baseUrl',
        kind: 'url',
        env: 'KAPSO_WHATSAPP_BASE_URL',
        mono: true,
        placeholder: 'https://api.kapso.ai/meta/whatsapp',
      },
    ],
    secrets: [{ name: 'kapsoApiKey', env: 'KAPSO_API_KEY', required: true, keepOnBlank: true }],
  },

  {
    key: 'einvoice',
    group: 'finance',
    driverEnv: 'EINVOICE_DRIVER',
    defaultDriver: 'none',
    drivers: [
      { value: 'none', live: false },
      { value: 'asp', live: true },
    ],
    fields: [{ name: 'url', kind: 'url', env: 'EINVOICE_ASP_URL', required: true, mono: true }],
    secrets: [{ name: 'apiKey', env: 'EINVOICE_ASP_API_KEY', required: true, keepOnBlank: true }],
  },

  {
    key: 'inboundEmail',
    group: 'platform',
    fields: [
      /*
        How often the mailboxes are read. Cron, UTC.

        Every minute by default because FR-EQ-02 asks for "within one minute"
        and a cron expression has no finer resolution — so this meets the
        requirement at its boundary rather than comfortably inside it.

        Here rather than in the environment because it is the same *kind* of
        knob as the carrier poll's schedule: the right frequency is a function
        of what the mail host tolerates, which differs per deployment and is
        discovered after it is running. Like that one, it is registered with
        pg-boss and so needs a reconciler rather than only a cache expiry.
      */
      {
        name: 'cron',
        kind: 'text',
        env: 'INBOUND_MAIL_CRON',
        mono: true,
        placeholder: '* * * * *',
      },
    ],
    secrets: [{ name: 'webhookSecret', env: 'INBOUND_EMAIL_WEBHOOK_SECRET', keepOnBlank: true }],
  },

  /*
    The model provider — the ninth port, and the shortest card on the screen.

    Two settings and a key, because that is genuinely all a deployment decides.
    An earlier revision offered a driver, a base URL and three model slugs, and
    every one of them was a knob nobody would ever turn: there is one provider,
    its URL does not change, and the three-way model split assumed some
    surfaces do not read scans — when in this product all of them do.

    What is left is what the client actually owns: whose account is billed, and
    how much of it may be spent.

    **The key is the switch.** No key, no reading — the same shape `whatsapp`
    takes, and better than a driver enum, which is a second way to express the
    same fact and therefore a way for the two to disagree.

    **The model must accept images.** A supplier invoice is a photographed PDF
    and a customs declaration is an Arabic scan; a text-only model answers the
    prompt confidently having seen neither. `DEFAULT_MODEL` in `core/ai.ts` is
    vision-capable and is what runs unless a deployment names something else.
  */
  {
    key: 'ai',
    group: 'intelligence',
    fields: [
      {
        name: 'model',
        kind: 'text',
        env: 'AI_MODEL',
        mono: true,
        placeholder: 'minimax/minimax-m3',
      },
      /*
        A ceiling in USD across every surface, checked against the ledger
        before each call. Zero disables it, and zero is the default: a cap
        nobody chose is a cap that stops extraction mid-month for a reason
        nobody can find.
      */
      { name: 'monthlyBudgetUsd', kind: 'number', env: 'AI_MONTHLY_BUDGET_USD', min: 0 },
    ],
    secrets: [{ name: 'apiKey', env: 'OPENROUTER_API_KEY', keepOnBlank: true }],
    probe: true,
  },

  /*
    Automatic rate procurement — the near end of the enquiry→quote pipeline,
    turned on by an administrator rather than a coordinator's click.

    Ships dark, and deliberately: it mails covering agents, and the dev mailbox
    is a real inbox. `manual` is the inert default (a coordinator asks with the
    "Request rates" picker); `auto` lets the minute sweep fan an RFQ out to every
    covering agent the moment an enquiry carries a resolvable lane, once, with
    the same loop-breaker the manual path uses. `maxAgents` caps the fan-out so a
    lane forty agents cover does not become forty emails.
  */
  {
    key: 'rateAutoFanout',
    group: 'intelligence',
    driverEnv: 'RATE_AUTOFANOUT_DRIVER',
    defaultDriver: 'manual',
    drivers: [
      { value: 'manual', live: false },
      { value: 'auto', live: true },
    ],
    fields: [
      {
        name: 'maxAgents',
        kind: 'number',
        env: 'RATE_AUTOFANOUT_MAX_AGENTS',
        placeholder: '6',
        min: 1,
        max: 20,
      },
      /*
        How old an enquiry may be and still be asked about automatically (F61).
        Switching `auto` on used to RFQ every open enquiry with a complete lane,
        however stale — four long-idle enquiries went to agents within a minute
        of the switch. An enquiry older than this is left for a person, who
        knows whether the customer is still waiting; the sweep only takes the
        fresh ones it was switched on for. 48 hours spans a weekend's intake.
      */
      {
        name: 'maxAgeHours',
        kind: 'number',
        env: 'RATE_AUTOFANOUT_MAX_AGE_HOURS',
        placeholder: '48',
        min: 1,
        max: 720,
      },
    ],
    secrets: [],
  },

  /*
    Automatic acceptance of what a model read — the front of the same pipeline.

    Off by default, and for a subtler reason than mailing agents: it writes to
    the enquiry under the system's hand, so a coordinator who never opts in
    still sees a queue they judge rather than fields that filled themselves.
    Switched to `auto`, extraction applies a proposal only where it clears the
    `confidence` ceiling AND the column is still empty AND it resolves without
    ambiguity — the ambiguous ports and commodities the system refuses to guess
    stay in the queue for a person, exactly as they do on the manual path.
  */
  {
    key: 'enquiryAutoAccept',
    group: 'intelligence',
    driverEnv: 'ENQUIRY_AUTOACCEPT_DRIVER',
    defaultDriver: 'manual',
    drivers: [
      { value: 'manual', live: false },
      { value: 'auto', live: true },
    ],
    fields: [
      {
        name: 'confidence',
        kind: 'number',
        env: 'ENQUIRY_AUTOACCEPT_CONFIDENCE',
        placeholder: '0.9',
        min: 0,
        max: 1,
      },
    ],
    secrets: [],
  },

  /*
    Automatic promotion of the cheapest agent reply into a buy rate card — the
    first automated step that commits money, so the driver is not just on/off but
    the *strategy* by which it commits:

      manual  a coordinator clicks Accept (off).
      first   promote the moment one comparable reply parses — fastest to a quote,
              least likely to be the cheapest.
      all     wait until no agent is still outstanding, then take the cheapest —
              best coverage, but one silent agent holds it up.
      wait    wait `waitHours` from the first RFQ, then take the cheapest of what
              came back — a deadline that a silent agent cannot stall.

    Whichever strategy, it takes the cheapest reply normalised to the branch's
    base currency, and writes the identical card `acceptRateReply` writes.
  */
  {
    key: 'rateAutoPromote',
    group: 'intelligence',
    driverEnv: 'RATE_AUTOPROMOTE_DRIVER',
    defaultDriver: 'manual',
    drivers: [
      { value: 'manual', live: false },
      { value: 'first', live: true },
      { value: 'all', live: true },
      { value: 'wait', live: true },
    ],
    fields: [
      {
        name: 'waitHours',
        kind: 'number',
        env: 'RATE_AUTOPROMOTE_WAIT_HOURS',
        placeholder: '24',
        min: 0,
        max: 720,
      },
    ],
    secrets: [],
  },

  /*
    Automatic drafting of the quotation — the end of the pipeline, and the point
    it hands back to a person. When an enquiry's buy rate has been awarded and the
    lane is covered, the same engine "Price it" runs prices it against the house
    margin on `customer_branch_terms` and lands a *draft* quotation, cover note
    included. It never sends: a draft is a thing a coordinator reviews and decides
    to put in front of a customer, which is the one step the pipeline leaves human
    by design. Off by default like the rest.
  */
  {
    key: 'quoteAutoDraft',
    group: 'intelligence',
    driverEnv: 'QUOTE_AUTODRAFT_DRIVER',
    defaultDriver: 'manual',
    drivers: [
      { value: 'manual', live: false },
      { value: 'auto', live: true },
    ],
    fields: [],
    secrets: [],
  },
] as const

/** The order the groups appear in, and the order a deployment configures them. */
export const INTEGRATION_GROUPS: readonly IntegrationGroup[] = [
  'platform',
  'carriers',
  'finance',
  'intelligence',
]

/** Every integration key, for the settings screen and the coverage checks. */
export const INTEGRATION_KEYS: readonly string[] = INTEGRATIONS.map((spec) => spec.key)

export function integrationSpec(key: string): IntegrationSpec | undefined {
  return INTEGRATIONS.find((spec) => spec.key === key)
}

/**
 * Whether a field or secret applies under the chosen driver.
 *
 * Only meaningful for a live driver; the caller has already asked
 * `isLiveDriver`. Unrestricted fields apply to every driver.
 */
export function appliesTo(
  spec: IntegrationSpec,
  item: { readonly drivers?: readonly string[] },
  driver: string | null | undefined,
): boolean {
  if (!item.drivers) return true
  return item.drivers.includes(driver ?? spec.defaultDriver ?? '')
}

/** Whether the chosen driver is one that needs its fields filled in. */
export function isLiveDriver(spec: IntegrationSpec, driver: string | null | undefined): boolean {
  if (!spec.drivers) return true
  const chosen = driver ?? spec.defaultDriver
  return spec.drivers.some((d) => d.value === chosen && d.live)
}

/**
 * The environment variables this catalogue can take over from.
 *
 * `pnpm doctor` reads it so its report can say "set in the environment, and
 * overridden by a row" rather than reporting a capability as unconfigured
 * because it went looking in the only place it knew about.
 */
export function integrationEnvKeys(): string[] {
  const keys = new Set<string>()
  for (const spec of INTEGRATIONS) {
    if (spec.driverEnv) keys.add(spec.driverEnv)
    for (const field of spec.fields) keys.add(field.env)
    for (const secret of spec.secrets) keys.add(secret.env)
  }
  return [...keys].sort()
}

/**
 * The carrier poll's one piece of arithmetic, in one place.
 *
 * `batch × runs-per-hour ≤ the carrier's cap`. The screen shows the left-hand
 * side as the operator types, because the failure it prevents is a 429 that
 * looks exactly like a carrier with nothing to say.
 *
 * Only the cron shapes a deployment actually uses are recognised. Anything
 * else returns null, which the screen renders as "cannot be checked" rather
 * than as a number it made up — a wrong reassurance is worse than none.
 */
export function pollRunsPerHour(cron: string): number | null {
  const fields = cron.trim().split(/\s+/)
  if (fields.length !== 5) return null

  // Length is checked above, so the field is present.
  const minute = fields[0]!

  // `*` — every minute of every hour.
  if (minute === '*') return 60

  // `*/N` — every N minutes.
  const step = /^\*\/(\d+)$/.exec(minute)
  if (step) {
    const n = Number(step[1])
    return n > 0 && n <= 60 ? Math.floor(60 / n) : null
  }

  // `30` or `0,30` — a fixed list of minutes, once per hour each.
  if (/^\d+(,\d+)*$/.test(minute)) return minute.split(',').length

  return null
}

/**
 * A cron schedule in a shape a screen can put into words.
 *
 * The integrations board printed the raw five-field expression (every thirty
 * minutes, written as a step on the minute field) beside "Schedule", which is
 * a sentence only to whoever wrote it. The shapes below are the ones a
 * deployment actually sets; anything else is `null`, and the screen shows the
 * expression itself rather than guess at a sentence that might be wrong.
 */
export type CronSchedule =
  | { readonly kind: 'every_minute' }
  | { readonly kind: 'every_minutes'; readonly minutes: number }
  | { readonly kind: 'hourly_at'; readonly minutes: readonly number[] }
  | { readonly kind: 'every_hours'; readonly hours: number; readonly minute: number }
  | { readonly kind: 'daily_at'; readonly hour: number; readonly minute: number }

export function describeCron(cron: string | null | undefined): CronSchedule | null {
  const fields = (cron ?? '').trim().split(/\s+/)
  if (fields.length !== 5) return null
  const [minute, hour, dom, month, dow] = fields as [string, string, string, string, string]
  // Day, month and weekday restrictions are not put into words; say nothing.
  if (dom !== '*' || month !== '*' || dow !== '*') return null

  const fixedMinutes = /^\d+(,\d+)*$/.test(minute) ? minute.split(',').map(Number) : null
  if (fixedMinutes && fixedMinutes.some((m) => m > 59)) return null

  if (hour === '*') {
    if (minute === '*') return { kind: 'every_minute' }
    const step = /^\*\/(\d+)$/.exec(minute)
    if (step) {
      const n = Number(step[1])
      if (n === 1) return { kind: 'every_minute' }
      return n > 0 && n <= 59 ? { kind: 'every_minutes', minutes: n } : null
    }
    return fixedMinutes ? { kind: 'hourly_at', minutes: fixedMinutes } : null
  }

  if (!fixedMinutes || fixedMinutes.length !== 1) return null
  const hourStep = /^\*\/(\d+)$/.exec(hour)
  if (hourStep) {
    const n = Number(hourStep[1])
    return n > 0 && n <= 23 ? { kind: 'every_hours', hours: n, minute: fixedMinutes[0]! } : null
  }
  if (/^\d+$/.test(hour) && Number(hour) <= 23) {
    return { kind: 'daily_at', hour: Number(hour), minute: fixedMinutes[0]! }
  }
  return null
}
