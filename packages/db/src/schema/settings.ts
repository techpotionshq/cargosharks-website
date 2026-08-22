/**
 * How this deployment reaches the outside world — FR-AD-03, §10.
 *
 * Every port in `apps/service/src/ports` had exactly one way to be configured
 * until this table existed: an environment variable, and therefore a redeploy.
 * That is the wrong shape for what these actually are. The SMTP relay, the
 * Maersk registration, the e-invoice provider and the WhatsApp number are all
 * *the client's* (IN-06, Discovery Q5) — they arrive on the client's schedule,
 * and each one arriving used to block on whoever held the deploy keys.
 *
 * `mailboxes` made this argument first and made it narrowly. This is the same
 * argument for the other nine integrations.
 *
 * ## One row per integration, not one row per setting
 *
 * The alternative — a key/value table — reads well and validates badly. These
 * settings are only ever correct or incorrect *together*: a driver set to
 * `api` with no URL is not a half-configured feed, it is a broken one, and the
 * adapters have refused to resolve that state since Release One. A row per
 * integration is what lets a save be rejected as a unit and a screen show one
 * status per card.
 *
 * ## The environment still wins the bootstrap, and the row wins after that
 *
 * `apps/service` reads a row *over* its environment default, never instead of
 * it. Three things fall out of that and all three were requirements:
 *
 *   - a deployment that configures nothing here behaves exactly as it did
 *     before this table, so this migration is additive for every existing
 *     install;
 *   - `SMTP_*` in the environment still works, which it has to, because mail
 *     must be able to deliver the invitation to the administrator who is going
 *     to sign in and change `SMTP_*`;
 *   - a fleet can be moved integration by integration rather than at once.
 *
 * ## Secrets are sealed here exactly as they are on `mailboxes`
 *
 * `secrets` is a JSON object of *name* to AES-256-GCM ciphertext, sealed with
 * `sealSecret` under `MAILBOX_ENCRYPTION_KEY` — the same key, the same scheme,
 * the same `v1:` prefix, and the same check constraint enforcing the shape in
 * the database (see `0028`). Reusing the key rather than minting a second one
 * is deliberate: two keys is two rotations, and the second one is the one
 * nobody remembers.
 *
 * The name of that variable is now narrower than what it protects. Renaming it
 * would break every deployment that has one, so it keeps its name and this
 * paragraph exists instead.
 *
 * ## Never deleted, and not branch-scoped
 *
 * `is_active` like everything else (§5.5). No `branch_id`, because there is no
 * such thing as a Kuwait-only SMTP relay in this design — which is precisely
 * why the policy conditions on `admin.integrations.write` instead of on the
 * branch list every other configuration table narrows by.
 */

import { boolean, jsonb, text } from 'drizzle-orm/pg-core'
import { pk, timestamps, tsz } from './columns'
import { pgTable } from './table'

export const integrationSettings = pgTable('integration_settings', {
  id: pk(),
  /** A key from `INTEGRATIONS` in `@qabandi/core` — `smtp`, `carrierMaersk`. */
  key: text('key').notNull().unique(),
  /**
   * The chosen driver, where the integration has a choice of one.
   *
   * Null means "whatever the environment says", which is not the same as the
   * default: a row that has never had its driver set must not quietly switch a
   * deployment off `MAIL_DRIVER=log` by being created.
   */
  driver: text('driver'),
  /** Non-secret settings — hosts, paths, batch sizes, switches. */
  settings: jsonb('settings')
    .$type<Record<string, string | number | boolean>>()
    .notNull()
    .default({}),
  /** Credential name to `v1:<iv>:<tag>:<ciphertext>`. Never selected by the web app. */
  secrets: jsonb('secrets').$type<Record<string, string>>().notNull().default({}),
  isActive: boolean('is_active').notNull().default(true),
  /*
    What the last probe said, so the screen can say so.

    The same three columns as `mailboxes`, for the same reason and against a
    worse failure: a carrier key that is wrong produces no error anywhere an
    operator looks. The poll asks, the gateway answers 401, the worker records
    a failure in its own log, and the board simply shows shipments that have
    not moved. `last_error` on the row is what turns that into something a
    person can see without a service log.
  */
  lastCheckedAt: tsz('last_checked_at'),
  lastOkAt: tsz('last_ok_at'),
  lastError: text('last_error'),
  ...timestamps,
})

export type IntegrationSettings = typeof integrationSettings.$inferSelect
