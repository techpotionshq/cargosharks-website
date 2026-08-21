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
}

export interface IntegrationSpec {
  readonly key: string
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
        placeholder: 'Al-Qabandi & Partners <no-reply@qabandi.com>',
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

  {
    key: 'fx',
    driverEnv: 'FX_SOURCE',
    defaultDriver: 'manual',
    drivers: [
      { value: 'manual', live: false },
      { value: 'api', live: true },
    ],
    fields: [
      /*
        A template rather than a host, so a different provider is a
        configuration change: `{base}` and `{key}` are substituted per request.
      */
      {
        name: 'url',
        kind: 'text',
        env: 'FX_API_URL',
        required: true,
        mono: true,
        placeholder: 'https://open.er-api.com/v6/latest/{base}',
      },
      /*
        Which currencies are fetched is *not* here. It is `currencies.is_tracked`
        — a column on the table that already lists this operator's currencies,
        rather than a second comma-separated answer to the same question that
        could disagree with it.
      */
      { name: 'base', kind: 'text', env: 'FX_BASE_CURRENCY', mono: true, placeholder: 'KWD' },
    ],
    secrets: [{ name: 'apiKey', env: 'FX_API_KEY', keepOnBlank: true }],
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
    driverEnv: 'CARRIER_TRACKING_DRIVER',
    defaultDriver: 'manual',
    drivers: [
      { value: 'manual', live: false },
      { value: 'dcsa', live: true },
      { value: 'terminal49', live: true },
    ],
    fields: [{ name: 'baseUrl', kind: 'url', env: 'CARRIER_TRACKING_BASE_URL', mono: true }],
    secrets: [
      /*
        Not `required`, because `dcsa` is a live driver that takes neither of
        these — its credentials are the three carrier rows below. Demanding an
        aggregator key to switch on carrier-direct tracking would be demanding
        the licence fee the DCSA driver exists to avoid.
      */
      { name: 'apiKey', env: 'CARRIER_TRACKING_API_KEY', keepOnBlank: true },
      { name: 'webhookSecret', env: 'CARRIER_WEBHOOK_SECRET', keepOnBlank: true },
    ],
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

  {
    key: 'whatsapp',
    fields: [{ name: 'phoneNumberId', kind: 'text', env: 'WHATSAPP_PHONE_NUMBER_ID', mono: true }],
    secrets: [
      { name: 'accessToken', env: 'WHATSAPP_ACCESS_TOKEN', keepOnBlank: true },
      { name: 'webhookVerifyToken', env: 'WHATSAPP_WEBHOOK_VERIFY_TOKEN', keepOnBlank: true },
      { name: 'appSecret', env: 'WHATSAPP_APP_SECRET', keepOnBlank: true },
    ],
  },

  {
    key: 'einvoice',
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
    fields: [],
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
    fields: [
      {
        name: 'model',
        kind: 'text',
        env: 'AI_MODEL',
        mono: true,
        placeholder: 'anthropic/claude-opus-5',
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
] as const

/** Every integration key, for the settings screen and the coverage checks. */
export const INTEGRATION_KEYS: readonly string[] = INTEGRATIONS.map((spec) => spec.key)

export function integrationSpec(key: string): IntegrationSpec | undefined {
  return INTEGRATIONS.find((spec) => spec.key === key)
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
