# Provisioning, whitelabel and integration settings

The operator's runbook: standing up a customer deployment, giving it its brand,
and configuring its integrations. Moved out of the README so the README stays a
day-one guide; the content is unchanged.

## Provisioning a customer

The product is sold deployment-per-customer — one database, one schema, no
`tenant_id` above `branch_id`. That is the right shape for this market and it
is a data-sovereignty answer as well as an architecture, but it moves a cost
onto whoever operates it. At three customers, standing one up by hand is an
afternoon. At fifteen it is a full-time job, and the difference between a
supportable business and an unsupportable one is entirely whether the
operations are scripted.

They are scripted. Step 0 is the one that has to be read before the second
customer, not after.

### 0. Decide the deployment shape — once, and before customer number two

`app_user` and `app_migrator` are PostgreSQL **roles**, and roles are
cluster-wide rather than per-database. So "a database per customer" and "an
instance per customer" are not the same decision, and only one of them works:

| Shape | Safe |
|---|---|
| One PostgreSQL instance per tenant | Yes |
| Shared cluster, one database per tenant | **No** — `db:provision` for tenant B rewrites tenant A's passwords, and tenant A stops working |

This was hit twice in one afternoon locally and is recorded as `OP-11` in
[`docs/Operations_Findings.md`](Operations_Findings.md) §7. A shared
cluster needs per-tenant role names — `app_user_<key>` — which is a change to
`infra/postgres/init/01-roles.sql`, `provision.ts` and every connection string.
One instance per tenant avoids the problem and costs more. There is no third
option, and deciding by default means deciding on the broken one.

### 1. Register the tenant, and put its credentials in the environment

`fleet.example.json` is the manifest. Copy it to `fleet.json` — gitignored,
because it names customers — and add a record per deployment. **Connection
strings are not in it.** They are read from the environment by convention from
each tenant's key, so no customer credential is ever committed:

```
QABANDI_<KEY>_DATABASE_URL             app_user — the running application
QABANDI_<KEY>_MIGRATION_DATABASE_URL   app_migrator — migrations only
QABANDI_<KEY>_ADMIN_DATABASE_URL       superuser — provisioning and dumps only
```

`<KEY>` is the tenant key upper-cased with hyphens as underscores, so
`acme-logistics` reads `QABANDI_ACME_LOGISTICS_DATABASE_URL`. `tenant:new`
refuses to start until all three are set, and names the ones that are missing.

The three-way split is not ceremony. A manifest holding fifteen production
passwords is a file that ends up in a chat message the first time somebody
onboards, and the whole point of the per-tenant model is that one customer's
credentials never reach another customer's data.

**Dumps are taken through the admin connection.** `app_user` holds
`nobypassrls` and cannot read outside its own branches, so a dump taken as the
application role is silently partial — the most dangerous artefact in this
area, because it restores without complaint.

### 2. One command

```bash
pnpm tenant:new --key acme --name "Acme Logistics LLC" \
                --admin-email ops@acme.com --region ae \
                --scaffold-brand --primary "#0b5fff" --accent "#12203a"
```

In order, that scaffolds and registers the brand, creates the database and both
roles, applies every migration as `app_migrator`, seeds the reference rows and
the permission matrix, creates the first operating entity, creates the first
administrator, and adds the tenant to `fleet.json`.

Each step is one of the existing scripts spawned with that tenant's
environment, rather than a reimplementation. So there is exactly one
provisioning path in this repository, and the fleet cannot drift from the
single-deployment instructions further up this file.

| Flag | |
|---|---|
| `--dry-run` | prints the whole sequence and touches nothing |
| `--seed-demo` | loads the evaluation dataset — for a demo instance, never a customer's own |
| `--scaffold-brand` | write the client's brand file; needs `--primary`, takes `--accent` |
| `--brand <key>` | use a brand that already exists instead of scaffolding one |
| `--branch-code` | defaults to the key upper-cased, which is what a single-office operator meant anyway |
| `--currency` | the first branch's currency |
| `--region` | the branch country, and the answer to a residency question |

The administrator password is printed once. It is not stored.

**The brand is scaffolded first, and that ordering is load-bearing.** Every
later step runs with `BRAND` set, and `resolveBrand` refuses an unregistered
key rather than falling back — so a run that left the brand until last would
fail on the first step that touched it.

### 3. The brand

A brand can also be written on its own, for a client whose identity arrives
before their deployment does:

```bash
pnpm brand:new --key acme --name-en "Acme Logistics LLC" \
               --primary "#0b5fff" --accent "#12203a" --logo-svg mark.svg
```

It writes `packages/brand/src/brands/acme.ts`, registers it in `resolve.ts`,
formats both, and then **prints every value it had to leave as a placeholder**
— the Arabic legal name, the commercial registration number, the artwork. That
same list is written into the generated file's header, so the file never reads
as finished when it is not. `--name-ar`, `--legal-en`, `--address-ar`,
`--support-email`, `--monogram`, `--favicon`, `--established` and the rest fill
them in; `pnpm brand:new` with no arguments lists all of them.

**The colour arithmetic is the part worth trusting.** A brand manual states a
hex, not an OKLCH angle. `hexRamp` converts it and lowers the peak chroma to
the most an eleven-stop ramp can carry before a stop clips — the judgement the
header of `brands/qabandi.ts` records in prose. Done by hand there, it produced
0.19 against a measured 0.213; the tolerance in `palette.ts` reproduces that at
0.1895, and a test pins it so the constant cannot later be tidied to a rounder
number. The generated file keeps the client's hex rather than the OKLCH it
resolves to, because a hex can be checked against the brand manual and three
decimals cannot.

**An unregistered `BRAND` refuses to start.** It used to resolve to
CargoSharks, so a deployment provisioned with `--brand acme` and no `acme.ts`
started, worked, and put the supplier's identity on every screen the client
showed a customer and every PDF they sent one. Nobody reports a product that
looks fine. `resolveBrand` now throws, both applications resolve the brand at
module scope, and the failure is a refusal to boot naming the keys that would
have worked.

An **unset** `BRAND` is still legitimate and still means CargoSharks — a demo,
a preview deployment, a fixture run, a laptop. Nothing enforces it at boot,
which is why it is step 4 below and why `pnpm doctor` reports it.

### 4. What is deliberately not automated

`tenant:new` prints these when it finishes. None of them can be inferred, and
each has been a real failure:

1. **`BETTER_AUTH_SECRET`, per tenant** — `openssl rand -base64 32`. The
   application refuses to start in production without one, because the fallback
   is a shared signing key and a session minted on any deployment would then be
   accepted on every other.
2. **`BRAND=<key>`** on the running process. Scaffolding writes the file;
   setting the variable is what makes the deployment wear it.
3. **`QABANDI_TENANT=<key>`**, so telemetry can tell this deployment from the
   others.
4. **A backup, and a rehearsed restore** — `pnpm fleet:backup <key>`. A backup
   nobody has restored is a hypothesis.
5. **Confirm `/api/health`** answers, and reports no migration drift.

Then run `pnpm doctor` against the deployment's environment. It opens no
database — a doctor that needs the patient healthy is not much use — and
reports what is configured, what each missing thing costs, and whether `BRAND`
is unset, registered, or a key that will refuse to boot.

### 5. Deploy the two containers

[`docs/Deployment_Coolify.md`](Deployment_Coolify.md) is the full
procedure. The two rules that matter: deploy `compose.prod.yaml` as one stack
so `SERVICE_URL=http://service:3001` is true by construction, and give a domain
to `web` and to `web` only — `/internal` authenticates the caller and then lets
that caller name the principal to act as, so it must never be reachable from
outside.

There is no marketing site in this repository: it is a separate CargoSharks
surface and never part of a customer deployment. The `Dockerfile` builds only
`@qabandi/web` and `@qabandi/service`, and `compose.prod.yaml` declares no
container for anything else. There is nothing to disable per client.

### 6. Running the fleet afterwards

```bash
pnpm fleet:status          # what schema version is everyone on, and is each reachable
pnpm fleet:migrate         # apply migrations across the fleet, with a report
pnpm fleet:backup          # dump every deployment
pnpm fleet:restore-drill   # dump, restore into a scratch database, verify, drop
```

**`fleet:migrate` runs sequentially and does not stop on a failure.** Parallel
migration is a way to take every customer down at once instead of one at a
time; stopping halfway leaves the fleet split with no report of which half is
which. It continues, names every tenant and its outcome, reports version drift
across the fleet, and exits non-zero.

**`fleet:restore-drill` is the one to schedule.** The drill restores into a
scratch database and checks the content rather than the exit status —
including that the RLS policies survived, because a restore that drops them
produces a database that looks perfect and enforces nothing.


## Whitelabel

`FR-CP-01` and `NFR-16` require the operator's logo, colours and domain
everywhere a customer or partner can see, and no supplier branding anywhere.
The cheapest way to keep that true a year from now is to make the operator a
parameter, so **no component in `apps/web` contains a colour literal, a company
name or a logo path.**

`packages/brand` holds one object — identity, two hue specifications, logo
geometry, typography, letterhead. Both themes, all three tonal ramps and every
semantic colour are derived from it, emitted as CSS custom properties in the
root layout, and consumed through ordinary Tailwind utilities (`bg-surface`,
`text-brand`, `border-line`) whose *values* resolve at run time. A re-skin
therefore needs no rebuild:

```bash
BRAND_NAME_EN="Meridian Logistics" BRAND_MONOGRAM=M \
BRAND_PRIMARY_HUE=155 BRAND_ACCENT_HUE=25 BRAND_RADIUS=4 pnpm dev
```

Onboarding an operator properly is one file under
`packages/brand/src/brands/`, registered in `resolve.ts`, then `BRAND=<key>`.
`pnpm brand:new` writes and registers both from the hex on the brand manual,
and names every value it had to leave as a placeholder — see
[Provisioning a customer](#provisioning-a-customer) §3. Two are registered.
The default is
`cargosharks`, the product's own identity, so a demo, a preview deployment or an
unconfigured checkout does not wear a client's name and colours; `qabandi` is
the worked example of the whitelabel path, a real identity with a red primary
and a navy chrome arrived at without touching `apps/web`. `/settings/brand`
renders the resolved tokens and the variable that overrides each one, so the
claim is inspectable rather than asserted.

**A customer-facing deployment must set `BRAND` explicitly.** The default is
the supplier's own identity, which is exactly what `NFR-16` says must not
appear in front of an operator's customers.

A `BRAND` naming a key nobody wrote is a refusal to boot: `resolveBrand`
throws rather than falling back, because falling back is how a client
deployment once wore the supplier identity on every screen and every PDF it
issued. An **unset** `BRAND` still resolves to CargoSharks, and nothing
enforces that at boot — it is a demo, a preview or a laptop as often as it is
an oversight. So it belongs in the deployment checklist, and `pnpm doctor`
reports it. `.env.example` ships `BRAND` commented out deliberately: an
unconfigured checkout should wear the supplier's brand, not a client's.

Two things deliberately do *not* follow the brand:

- **Status colours.** Positive, caution, critical, info and muted are reserved
  for state. A board where "held" is calm because it matched a corporate palette
  is worse than useless. A brand hue within ~15° of one of the four coloured
  ones will read as that status — move the brand hue, not the status. `muted`
  carries so little chroma that its hue is not visible, so it does not constrain
  anything. `collidesWithStatus` in `palette.ts` tests the two that have to
  *interrupt*, `critical` and `positive`: a brand reading faintly
  informational costs nothing, and a brand reading as a customs hold costs an
  operator the one colour that was meant to stop them.
- **Chart series.** Four slots, assigned in order and never cycled, and **not**
  derived from the brand: a brand hue that collides with `critical` would put
  alarm on an ordinary series. All four are fixed in `DEFAULT_CHART_SLOTS`,
  chosen at least 30° clear of every coloured status hue, and validated for
  lightness band, chroma floor, adjacent-pair separation under simulated
  protanopia and deuteranopia, and contrast against both surfaces — in both
  themes. A brand may supply its own `chart` array; neither registered brand
  does, and changing a hue means re-running that validation.

## Integration settings

Object storage, the mail relay, the FX feed, the carrier registrations, the
poll budgets, WhatsApp, the e-invoice provider and the model are **rows, not
environment variables** — `integration_settings`, edited at Settings →
Integrations, with credentials sealed under `MAILBOX_ENCRYPTION_KEY`
(`FR-AD-03`).

That is not a preference. Every one of these is the *client's* to provision
(`IN-06`, Discovery Q5): they register with Maersk themselves, buy their own
relay, appoint their own e-invoice provider. While these were variables, each
credential arriving meant a redeploy — so the capability waited for whoever
held the deploy keys rather than for whoever held the credential.

### The environment is the fallback, and stays one

A row wins. The variable answers when there is no row. Three things fall out of
that, and each is the reason the fallback is not being removed:

- **It is the bootstrap.** `SMTP_*` has to work before anyone can sign in to
  change `SMTP_*`. A deployment whose relay is only configurable from inside
  the application is one nobody can be invited into.
- **It is the rollback.** Deactivating a row returns the deployment to exactly
  what its variables say, with nothing typed lost.
- **It keeps the change additive.** A deployment that configures nothing on the
  screen behaves exactly as it did before the table existed.

The variables are listed here rather than in `.env.example` deliberately. A
name in that file reads as *the* place to set something, and for these it is
the place of last resort — someone who copies it and fills in an SMTP password
has configured the one layer the screen will then silently override.

### The names

`INTEGRATIONS` in [`packages/core/src/integrations.ts`](../packages/core/src/integrations.ts)
is the authority; this table is a snapshot of it. `pnpm doctor` prints the live
list, and says plainly that it reads no database and so cannot see the rows.

| Integration | Key | Environment fallback |
| --- | --- | --- |
| Outbound mail | `smtp` | `MAIL_DRIVER` `SMTP_HOST` `SMTP_PORT` `SMTP_SECURE` `SMTP_USER` `MAIL_FROM` `SMTP_TLS_REJECT_UNAUTHORIZED` `SMTP_PASSWORD` |
| Object storage | `fileStore` | `FILE_STORE_DRIVER` `S3_ENDPOINT` `S3_BUCKET` `S3_REGION` `S3_ACCESS_KEY_ID` `S3_FORCE_PATH_STYLE` `S3_SECRET_ACCESS_KEY` |
| Exchange rates | `fx` | `FX_SOURCE` `FX_API_URL` `FX_API_KEY` |
| Carrier poll budget | `carrierPoll` | `CARRIER_POLL_BATCH` `CARRIER_POLL_CRON` `CARRIER_POLL_ACTIVE_WITHIN_MINUTES` |
| Container tracking | `carrierTracking` | `CARRIER_TRACKING_DRIVER` |
| Maersk | `carrierMaersk` | `DCSA_MAERSK_BASE_URL` `DCSA_MAERSK_EVENTS_PATH` `DCSA_MAERSK_CONSUMER_KEY` `DCSA_MAERSK_CLIENT_SECRET` |
| Hapag-Lloyd | `carrierHapag` | `DCSA_HAPAG_BASE_URL` `DCSA_HAPAG_EVENTS_PATH` `DCSA_HAPAG_CLIENT_ID` `DCSA_HAPAG_CLIENT_SECRET` |
| CMA CGM | `carrierCmacgm` | `DCSA_CMACGM_BASE_URL` `DCSA_CMACGM_EVENTS_PATH` `DCSA_CMACGM_API_KEY` |
| Vessel positions (AIS) | `vesselPositions` | `VESSEL_POSITIONS_DRIVER` `AISSTREAM_API_KEY` |
| WhatsApp Business | `whatsapp` | `WHATSAPP_PHONE_NUMBER_ID` `WHATSAPP_ACCESS_TOKEN` `WHATSAPP_WEBHOOK_VERIFY_TOKEN` `WHATSAPP_APP_SECRET` |
| E-invoice transmission | `einvoice` | `EINVOICE_DRIVER` `EINVOICE_ASP_URL` `EINVOICE_ASP_API_KEY` |
| Inbound mail webhook | `inboundEmail` | `INBOUND_MAIL_CRON` `INBOUND_EMAIL_WEBHOOK_SECRET` |
| Document extraction | `ai` | `AI_MODEL` `AI_MONTHLY_BUDGET_USD` `OPENROUTER_API_KEY` |

Four settings left the environment without becoming integration rows, because
they belong to something that already had one:

| Was | Now |
| --- | --- |
| `INBOUND_MAIL_BATCH` | `mailboxes.poll_batch` — a fact about one mailbox |
| `INBOUND_MAIL_MAX_ATTACHMENT_MB` | `mailboxes.max_attachment_mb` |
| `FX_QUOTE_CURRENCIES` | `currencies.is_tracked` |
| `FX_BASE_CURRENCY` | the distinct `branches.base_currency` of active entities |
| `MAIL_FROM` per entity | `branches.mail_from` |

`FX_BASE_CURRENCY` is the one that was worse than redundant. It was a single
deployment-wide currency defaulting to KWD, so a Dubai entity invoicing in AED
had **no rates fetched at all** — silently, on a deployment whose configuration
looked complete, and visible only by comparing a variable against a column
nobody thought to compare it to. Both halves of "what to fetch" are derived now
and neither can be set.

These are **not** read as a fallback — there is nothing deployment-wide
left for them to fall back to. The column defaults are the old values, so a
deployment that never tuned them is unaffected; one that did re-enters them on
the row. `FR-NT-07`'s quiet hours moved the same way, from constants in the
dispatcher to `branches.quiet_hours_*`, whose `time_zone` the comparison was
already made in.

### Vessel positions

Off by default (`VESSEL_POSITIONS_DRIVER=off`), and off means no connection is
opened. To switch it on, an administrator opens Settings → Integrations →
Vessel positions, chooses `aisstream`, pastes the aisstream.io API key and
saves. Within three minutes the service opens one websocket per 50 vessels and
follows the MMSI of every vessel on an open sea job (booked, in transit or on
hold). A job only has a vessel to follow once someone has entered its MMSI on
the job file, or confirmed the suggestion the card offers.

aisstream is free and uses **terrestrial receivers only**. A 120-second global
sample on 2026-10-05 held 10,790 positions and none at all in the Arabian Gulf,
the Gulf of Oman, the Red Sea or the Arabian Sea, against 165 vessels at the
China ports, 26 at Singapore and 3,499 in North Europe. So it covers origin
legs and goes quiet before arrival in Kuwait or Dubai. The screens say "No
recent position. The vessel may be outside receiver coverage." once a fix is
six hours old, which is the expected state on the arrival leg and not a fault.

A refused key is written to the card's last error, like every other
integration. `pnpm --filter @qabandi/service verify:vessels`, with
`AISSTREAM_API_KEY` set and a local `DATABASE_URL`, proves the key and the
write path end to end; it refuses any database that is not on the machine.

A satellite provider for the Gulf leg is a further driver value here and a
further adapter behind `VesselPositionSource` (`apps/service/src/ports`).

### When a row is wrong

An invalid *variable* still stops the service at boot. An invalid *row* must
not: refusing to resolve would take out the settings screen along with the
mistake, leaving a deployment recoverable only through `psql`. So a bad row
degrades to the Release One driver, records why on itself, and the card shows
red — the shape `mailboxes.last_error` already uses.

