'use server'

/**
 * How this deployment reaches the outside world — FR-AD-03, §10.
 *
 * The mailbox screen made this argument for one integration. This is the same
 * argument for the other nine: the SMTP relay, the Maersk registration, the
 * e-invoice provider and the WhatsApp number are all *the client's* to
 * provision (IN-06, Discovery Q5), and every one of them arriving used to mean
 * a redeploy — which in practice meant the capability waited for whoever held
 * the deploy keys rather than for whoever held the credential.
 *
 * ## Nothing here reads a credential back
 *
 * The rows carry sealed ciphertext and this file never opens it. `listeners`
 * see whether a secret is *set*, never what it is, which is the same line
 * `mailboxes` draws by simply never selecting `password_sealed`. A blank
 * secret field on save therefore means "leave it alone" — the field cannot be
 * pre-filled, so the usual form convention would silently clear a working key
 * every time somebody corrected a URL.
 *
 * ## The catalogue validates, not this file
 *
 * `INTEGRATIONS` in `@qabandi/core` says which fields exist, which are
 * required, and which drivers are live. Validation walks it rather than
 * repeating it, so a field added to the catalogue is enforced here without an
 * edit — and one removed stops being enforced, rather than rejecting saves for
 * a setting nothing reads.
 */

import { revalidatePath } from 'next/cache'
import { getTranslations } from 'next-intl/server'
import { eq } from 'drizzle-orm'
import {
  INTEGRATIONS,
  integrationSpec,
  isLiveDriver,
  pollRunsPerHour,
  type IntegrationGroup,
  type IntegrationSpec,
} from '@qabandi/core'
import {
  integrationSettings,
  secretKeyStatus,
  type SecretKeyStatus,
  resolveIntegration,
  sealSecret,
  withActor,
  withoutSealed,
  type IntegrationSettings,
  type SettingSource,
} from '@qabandi/db'
import { requireSession } from '@/lib/session'
import { assertCan } from '@/lib/permissions'
import { echo, fail, failWith, succeed, type ActionState, type Translate } from '@/lib/form-state'
import { usePilotFixtures } from '@/lib/pilot/source'
import { pilotIntegrationSettings } from '@/lib/pilot/fixtures'
import { demoReadOnly } from '@/lib/pilot/read-only'

interface IntegrationFieldView {
  readonly name: string
  readonly value: string | undefined
  readonly source: SettingSource
}

interface IntegrationSecretView {
  readonly name: string
  /** Whether a value exists in either layer. Never the value itself. */
  readonly isSet: boolean
}

export interface IntegrationView {
  readonly key: string
  readonly group: IntegrationGroup
  readonly driver: string | undefined
  readonly driverSource: SettingSource
  readonly live: boolean
  readonly fields: readonly IntegrationFieldView[]
  readonly secrets: readonly IntegrationSecretView[]
  readonly missing: readonly string[]
  readonly isActive: boolean
  readonly hasRow: boolean
  readonly lastCheckedAt: Date | null
  readonly lastOkAt: Date | null
  readonly lastError: string | null
  /** For `carrierPoll` alone: the calls-per-hour the current settings spend. */
  readonly callsPerHour: number | null
}

/**
 * Every integration, in catalogue order, with its row merged over the
 * environment.
 *
 * Integrations with no row at all are still listed — that is the state every
 * deployment starts in, and a screen that showed only what had been configured
 * would be an empty page on exactly the deployment that needs it most.
 */
export async function listIntegrations(): Promise<IntegrationView[]> {
  const session = await requireSession()
  assertCan(session, 'admin.integrations.write')

  /*
    Only the rows come from fixtures, and only the rows can.

    The answer below is the catalogue merged over the environment merged over
    these — and two of those three layers are already present without a
    database. Returning finished views here would report a configuration this
    deployment does not have, which is the one thing a settings screen must
    never do; handing the resolver a row set instead restores the missing
    layer and leaves `resolveIntegration` to say where each value came from.
  */
  const rows: readonly IntegrationSettings[] = usePilotFixtures()
    ? pilotIntegrationSettings()
    : await withActor(session.actor, (tx) =>
        tx
          .select({
            id: integrationSettings.id,
            key: integrationSettings.key,
            driver: integrationSettings.driver,
            settings: integrationSettings.settings,
            secrets: integrationSettings.secrets,
            isActive: integrationSettings.isActive,
            lastCheckedAt: integrationSettings.lastCheckedAt,
            lastOkAt: integrationSettings.lastOkAt,
            lastError: integrationSettings.lastError,
            createdAt: integrationSettings.createdAt,
            updatedAt: integrationSettings.updatedAt,
          })
          .from(integrationSettings),
      )

  const byKey = new Map(rows.map((row) => [row.key, row]))

  return INTEGRATIONS.map((spec) => {
    const row = byKey.get(spec.key)
    /*
      Stripped on the way in, not merely left unread.

      Everything below could simply avoid touching `sealed` — and the first
      version did. Dropping it here is stronger for the same one line: this
      object is shaped for a screen, and a later `...resolved` spread by
      somebody adding a field cannot serialise a credential into the page if
      the credential is not in the object.
    */
    const resolved = withoutSealed(resolveIntegration(spec, row))

    return {
      key: spec.key,
      group: spec.group,
      driver: resolved.driver,
      driverSource: resolved.driverSource,
      live: resolved.live,
      fields: spec.fields.map((field) => ({
        name: field.name,
        value: resolved.settings[field.name],
        source: resolved.sources[field.name] ?? ('unset' as SettingSource),
      })),
      // Presence, never value — `sealed` was dropped above.
      secrets: spec.secrets.map((secret) => ({
        name: secret.name,
        isSet: resolved.hasSecret[secret.name] ?? false,
      })),
      missing: resolved.missing,
      isActive: row?.isActive ?? true,
      hasRow: row !== undefined,
      lastCheckedAt: row?.lastCheckedAt ?? null,
      lastOkAt: row?.lastOkAt ?? null,
      lastError: row?.lastError ?? null,
      callsPerHour: spec.key === 'carrierPoll' ? callsPerHour(resolved.settings) : null,
    }
  })
}

/**
 * The left-hand side of `batch × runs-per-hour ≤ the carrier's cap`.
 *
 * Null where the cron is a shape the parser does not recognise, and the screen
 * says so rather than showing a number it invented — a wrong reassurance about
 * a rate limit is worse than no reassurance, because the failure it hides is a
 * 429 that looks exactly like a carrier with nothing to say.
 */
function callsPerHour(settings: Readonly<Record<string, string | undefined>>): number | null {
  const runs = pollRunsPerHour(settings.cron ?? '30 * * * *')
  const batch = Number(settings.batch ?? 15)
  if (runs === null || !Number.isFinite(batch)) return null
  return runs * batch
}

/**
 * Why a credential cannot be sealed, or null when one can.
 *
 * The reason rather than a boolean, because the two ways this fails look
 * identical from a `false` and are fixed differently: a key that is missing
 * needs one generating, and a key that is *set but the wrong shape* — a
 * passphrase where 32 base64 bytes belong, which is the common way in, since
 * every other secret in the environment is a phrase — needs replacing. The
 * screen used to report both as "not set on this deployment", which sends
 * somebody to check whether a variable exists when it plainly does.
 */
export async function integrationKeyProblem(): Promise<KeyProblem | null> {
  const session = await requireSession()
  assertCan(session, 'admin.integrations.write')
  /*
    The demo seals nothing — every save answers `demoReadOnly` — so a missing
    key is not a problem there, and a red banner naming an environment
    variable told a prospective customer the product was broken. The page
    says "credentials are not stored in the demo" instead.
  */
  if (usePilotFixtures()) return null
  const status = secretKeyStatus()
  return status.ok ? null : status
}

/**
 * Why credentials cannot be sealed, as data — U1.
 *
 * This returned `secretKeyProblem()`'s English sentence and the page printed
 * it as-is, so the Arabic settings screen carried a paragraph of English and a
 * shell command run together in one line wider than a phone. The page now
 * words the reason from the catalogue and shows the command on its own.
 */
export type KeyProblem = Exclude<SecretKeyStatus, { ok: true }>

/** The reason, in the reader's language. */
function keyProblemText(problem: KeyProblem, tv: Translate): string {
  return problem.reason === 'missing'
    ? tv('keyMissing')
    : tv('keyWrongLength', { bytes: problem.bytes, expected: problem.expected })
}

/** A form value, trimmed, with blank meaning absent rather than empty. */
function read(form: FormData, key: string): string | undefined {
  const value = form.get(key)
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

/**
 * Validate a save against the catalogue.
 *
 * Required fields are demanded only when the chosen driver is live, because
 * `manual` and `none` are real implementations rather than absences — asking
 * for a provider URL before somebody has appointed a provider is asking them
 * to invent one.
 */
function validate(
  spec: IntegrationSpec,
  driver: string | undefined,
  settings: Record<string, string>,
  secretsProvided: Set<string>,
  alreadySet: Set<string>,
  tv: Translate,
): Record<string, string> {
  const errors: Record<string, string> = {}

  if (spec.drivers && driver && !spec.drivers.some((d) => d.value === driver)) {
    errors.driver = tv('unknownDriver', { driver })
  }

  if (!isLiveDriver(spec, driver)) return errors

  for (const field of spec.fields) {
    const value = settings[field.name]

    if (field.required && !value) {
      errors[field.name] = tv('neededToSwitchOn')
      continue
    }

    if (value === undefined) continue

    if (field.kind === 'number') {
      const parsed = Number(value)
      if (!Number.isFinite(parsed)) {
        errors[field.name] = tv('mustBeNumber')
      } else if (field.min !== undefined && parsed < field.min) {
        errors[field.name] = tv('minValue', { min: field.min })
      } else if (field.max !== undefined && parsed > field.max) {
        errors[field.name] = tv('maxValue', { max: field.max })
      }
    }

    if (field.kind === 'url' && !/^https?:\/\//i.test(value)) {
      errors[field.name] = tv('fullUrl')
    }
  }

  for (const secret of spec.secrets) {
    // Provided now, or already stored — the second is what makes a blank field
    // on an edit mean "unchanged" rather than "clear it".
    if (secret.required && !secretsProvided.has(secret.name) && !alreadySet.has(secret.name)) {
      errors[secret.name] = tv('neededToSwitchOn')
    }
  }

  /*
    The one cross-field rule, and the reason this integration has a screen.

    `batch × runs-per-hour ≤ the carrier's cap` was a worked example in a
    comment in `.env.example`, left for an operator to do by hand at the moment
    their carrier tier changed. A trial tier allows twenty calls an hour, so
    the default settings already spend most of it — and exceeding it produces
    429s, which look exactly like a carrier with nothing to report.

    Refused rather than warned only where the arithmetic is *unreadable*: the
    cap itself differs per deployment and per contract, so this cannot know
    what the ceiling is. What it can insist on is that the multiplication be
    checkable at all.
  */
  if (spec.key === 'carrierPoll' && settings.cron) {
    if (pollRunsPerHour(settings.cron) === null) {
      errors.cron = tv('cronUnreadable')
    }
  }

  return errors
}

/**
 * Save one integration.
 *
 * Create-or-update on the catalogue key, because there is exactly one row per
 * integration and the key is unique — an upsert rather than a lookup keeps two
 * administrators saving at once from producing a duplicate the constraint
 * would then reject with a message nobody can act on.
 */
export async function saveIntegration(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const session = await requireSession()
  assertCan(session, 'admin.integrations.write')
  const demo = await demoReadOnly(form)
  if (demo) return demo

  const key = read(form, 'key')
  const spec = key ? integrationSpec(key) : undefined
  const tv = await getTranslations('adminValidation')

  if (!spec) return failWith(tv('unknownIntegration'))

  /*
    The echo never carries a credential back.

    `echo(form)` re-renders what was typed so a rejected form does not lose the
    administrator's work — right for a host name, wrong for a key, because the
    echo lands in the HTML of the response. The fields are stripped by name
    from the catalogue rather than by a convention someone has to remember.
  */
  const safeEcho = (): Record<string, string> => {
    const values = echo(form)
    for (const secret of spec.secrets) delete values[secret.name]
    return values
  }

  const driver = spec.drivers ? read(form, 'driver') : undefined

  /*
    Settings are replaced wholesale; credentials are merged. The asymmetry is
    deliberate and it is the difference between the two things a blank field
    can mean.

    A blank *setting* means "clear it" — the field was rendered with its
    current value in it, so an empty box is somebody having emptied it, and
    clearing is how a deployment falls back to the environment for one field.
    A blank *credential* means "unchanged", because a sealed value cannot be
    rendered back into the form and there was nothing there to empty.
  */
  const settings: Record<string, string> = {}
  for (const field of spec.fields) {
    if (field.kind === 'switch') {
      // A switch posts nothing when it is off, so absence is the value.
      settings[field.name] = form.get(field.name) !== null ? 'true' : 'false'
      continue
    }
    const value = read(form, field.name)
    if (value !== undefined) settings[field.name] = value
  }

  const provided = new Map<string, string>()
  for (const secret of spec.secrets) {
    const value = form.get(secret.name)
    if (typeof value === 'string' && value.trim() !== '') provided.set(secret.name, value.trim())
  }

  return withActor(session.actor, async (tx) => {
    const [existing] = await tx
      .select({
        id: integrationSettings.id,
        secrets: integrationSettings.secrets,
      })
      .from(integrationSettings)
      .where(eq(integrationSettings.key, spec.key))
      .limit(1)

    /*
      Resolved against the environment alone — the `undefined` row is the point,
      not an oversight.

      The question being asked is "is this credential already satisfied by a
      variable", so that a required secret is not demanded from somebody whose
      deployment has had it in the environment all along. What the *row* holds
      is read separately from `existing` on the line above.
    */
    const resolved = resolveIntegration(spec, undefined)
    const alreadySet = new Set(
      spec.secrets
        .filter(
          (secret) =>
            existing?.secrets?.[secret.name] !== undefined ||
            resolved.hasSecret[secret.name] === true,
        )
        .map((secret) => secret.name),
    )

    const errors = validate(spec, driver, settings, new Set(provided.keys()), alreadySet, tv)
    if (Object.keys(errors).length > 0) return fail(errors, safeEcho())

    const keyStatus = secretKeyStatus()
    if (provided.size > 0 && !keyStatus.ok) {
      return failWith(
        tv('credentialCannotBeSealed', { problem: keyProblemText(keyStatus, tv) }),
        safeEcho(),
      )
    }

    /*
      Merged over what is stored, not replacing it.

      A blank secret field means "unchanged", so the sealed values that were
      already there have to survive a save that did not mention them. Replacing
      the object wholesale is how correcting a base URL silently clears the key
      beside it.
    */
    const secrets: Record<string, string> = { ...(existing?.secrets ?? {}) }
    for (const [name, value] of provided) secrets[name] = sealSecret(value)

    const values = {
      key: spec.key,
      driver: driver ?? null,
      settings,
      secrets,
      /*
        Saving reactivates a row somebody had switched off.

        Deactivating is the rollback — "ignore this and use the environment" —
        so submitting the form again is the unambiguous way to say the
        settings should be in force. The alternative, saving into a row that
        stays ignored, is a form that reports success and changes nothing.
      */
      isActive: true,
      /*
        A saved integration has its last error cleared.

        The stored error describes a *previous* configuration; leaving it on a
        row somebody has just corrected means the screen reports a fault that
        has been fixed, and the next resolve would have cleared it anyway.
      */
      lastError: null,
    }

    if (existing) {
      await tx
        .update(integrationSettings)
        .set(values)
        .where(eq(integrationSettings.id, existing.id))
    } else {
      await tx.insert(integrationSettings).values(values)
    }

    return succeed(spec.key)
  }).then((state) => {
    revalidatePath('/settings/integrations')
    return state
  })
}

/**
 * Stop using a row, or start again.
 *
 * Deactivating is how a change is rolled back: the resolver skips an inactive
 * row entirely and the environment answers instead, so this is "go back to how
 * the deployment was configured" rather than "lose what was typed". That is a
 * different and much more useful operation than deleting, which §5.5 forbids
 * anyway.
 */
export async function setIntegrationActive(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const session = await requireSession()
  assertCan(session, 'admin.integrations.write')
  const demo = await demoReadOnly(form)
  if (demo) return demo

  const key = read(form, 'key')
  const isActive = form.get('isActive') === 'true'
  const tv = await getTranslations('adminValidation')
  if (!key || !integrationSpec(key)) return failWith(tv('unknownIntegration'))

  await withActor(session.actor, async (tx) => {
    await tx
      .update(integrationSettings)
      .set({ isActive, ...(isActive ? { lastError: null } : {}) })
      .where(eq(integrationSettings.key, key))
  })

  revalidatePath('/settings/integrations')
  return succeed(key)
}
