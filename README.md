# Qabandi Digital Freight Platform

Release One for **AL-QABANDI & PARTNERS Co. (Shipping & Forwarding), Kuwait**.

Built to [`docs/Qabandi_Architecture.md`](docs/Qabandi_Architecture.md). The one-line version:
**the database enforces tenancy, audit and immutability; reference data drives the
engines; application code stays thin enough to be boring.**

---

## Getting started

```bash
pnpm install
cp .env.example .env

pnpm db:up          # PostgreSQL 18, MinIO and a mail sink
pnpm db:migrate     # forward-only, applied as app_migrator
pnpm db:seed        # currencies, charge types, milestones, calendars, roles

# The operating entity comes before the people in it. A role is granted *per
# branch* (FR-ID-02), so an account created before any branch exists would hold
# no permissions at all — `db:create-user` refuses rather than making one.
pnpm db:create-branch --code KWI --name "Your Company Co." \
                      --country KW --currency KWD

# Nobody can sign in until an account exists: the product is invitation-only
# (FR-ID-07), so there is no registration form to bootstrap from.
pnpm db:create-user --email you@example.com --name "Your Name" \
                    --role administrator

pnpm dev            # web on :3000, service on :3001
```

### Accounts

`pnpm db:create-user` writes the four rows an account needs — the Better Auth
user, its hashed credential, the domain principal, and a role **per branch**
(FR-ID-02) — in one transaction. Re-running it for an existing email resets the
password, which is the password-reset path until a mail transport is
configured.

```bash
# every active branch, generated password printed once
pnpm db:create-user --email ops@qabandi.com --name "Operations" --role operations_manager

# one branch, explicit password
pnpm db:create-user --email kwi@qabandi.com --name "Kuwait Desk" \
                    --role coordinator --branch KWI --password '…'
```

Roles: `administrator`, `finance`, `operations_manager`, `coordinator`,
`sales`, `customs_broker`, `read_only`. The first two require TOTP enrolment
(FR-ID-06). The permission matrix behind them is seeded by `pnpm db:seed` and
is editable without a release.

**Or with no database at all.** The interface runs on the seeded pilot dataset
— twenty jobs at varied stages, a live customs hold, a demurrage clock that has
already written its own charge line:

```bash
QABANDI_PILOT_FIXTURES=1 pnpm --filter @qabandi/web dev
```

That is the default whenever `DATABASE_URL` is unset, so a laptop with nothing
provisioned runs the pilot screens — including the day-15 rehearsal in a room
with no network. It refuses to engage in production against a configured
database. Everything behind it is the real query path, chosen one branch
earlier in `apps/web/src/lib/pilot/source.ts`.

**It is a subset, and the subset is enforced.** The fixtures were written for
the screens the pilot needed. The register queries behind finance, network,
operations and reference still go straight to `withActor`, so those routes want
a database and error without one rather than degrading. The list lives in
`apps/web/e2e/support/harness.ts` as `NEEDS_DATABASE`, one entry per route
naming the query responsible, and the end-to-end run reports each of them as
skipped-with-a-reason — so the gap is visible in the pipeline rather than
implied by an absence. Each entry is retired by giving its query the
`usePilotFixtures()` branch every other feature already has.

**For a full instance — a demo a prospect can be given a URL to — load the
demo dataset**, which populates every table an evaluation touches:

```bash
pnpm db:up && pnpm db:migrate && pnpm db:seed
pnpm db:seed-demo   # enquiries at every stage, invoices partly paid,
                    # containers past free time. Idempotent; --reset removes it
```

`db:seed-demo` creates the two branches it references, so it stands a demo
instance up from a migrated database and nothing else. A real deployment names
its own entities with `db:create-branch` instead.

`pnpm db:up` needs Docker, and the container provisions its own roles from
`infra/postgres/init/01-roles.sql`.

**Against an existing server** — a shared development box, a managed instance,
the client's own cloud — put a superuser connection in `ADMIN_DATABASE_URL` and
the two application connection strings in `.env.local`, then:

```bash
pnpm db:provision   # creates the database and both roles, sets their passwords
pnpm db:migrate
pnpm db:seed
```

`db:provision` applies the same `01-roles.sql` the container uses, so the two
paths cannot drift, and it takes the role passwords from the environment so no
real credential is ever committed. `.env.local` overrides `.env` and is
gitignored.

**PostgreSQL 18 is required, not preferred.** `uuidv7()` is the default for
every primary key and temporal `WITHOUT OVERLAPS` carries rate-card validity.
Both would have to be hand-rolled on 16 or 17. See Architecture §6.4.

## Layout

```
packages/
  core/      pure domain. imports nothing. no I/O, no DB, no framework.
  brand/     the whitelabel contract — palette, logo, typography, letterhead
  db/        the only place a field is defined — schema, RLS, triggers, actor
apps/
  web/       Next.js: ops · portal · agent · public, as route groups
  service/   Fastify: workers · PDF · webhooks · public read API
infra/       container definitions and the Postgres role bootstrap
scripts/     the dependency-direction check
```

Dependency direction is `core ← db ← {web, service}` and is enforced by
`scripts/check-boundaries.mjs` in the pipeline, not by convention.

## Commands

| | |
|---|---|
| `pnpm dev` | web and service together |
| `pnpm typecheck` | every package |
| `pnpm lint` | oxlint plus the dependency-direction check |
| `pnpm test` | every package |
| `pnpm test:core` | domain engines only — no database, ~130ms |
| `pnpm db:generate` | regenerate the table migration from the schema |
| `pnpm db:provision` | create the database and roles on an existing server |
| `pnpm db:migrate` | apply migrations as `app_migrator` |
| `pnpm db:seed` | reference rows the engines need, and the role/permission matrix |
| `pnpm db:create-branch` | create an operating entity — the first thing a deployment needs |
| `pnpm db:create-user` | provision an account that can actually sign in |
| `pnpm db:reset` | drop the volume and start clean |
| `pnpm test:db` | migrations, policies and the RLS negative matrix |
| `pnpm test:e2e` | every screen, both languages, desktop and mobile |
| `pnpm tenant:new` | provision a deployment end to end — database, roles, schema, seed, first administrator |
| `pnpm fleet:status` | what schema version is every deployment on, and is each reachable |
| `pnpm fleet:migrate` | apply migrations across the fleet, sequentially, with a report |
| `pnpm fleet:backup` | dump every deployment |
| `pnpm fleet:restore-drill` | dump, restore into a scratch database, verify, drop |

## Running more than one deployment

The product is sold deployment-per-customer — one database, one schema, no
`tenant_id` above `branch_id`. That is the right shape for this market and it
is a data-sovereignty answer as well as an architecture, but it moves a cost
onto whoever operates it, and the cost is linear in customers unless the
operations are scripted.

`fleet.example.json` is the manifest. Copy it to `fleet.json` — gitignored,
because it names customers — and add a record per deployment. **Connection
strings are not in it.** They are read from the environment by convention from
each tenant's key, so no customer credential is ever committed:

```
QABANDI_<KEY>_DATABASE_URL             app_user
QABANDI_<KEY>_MIGRATION_DATABASE_URL   app_migrator
QABANDI_<KEY>_ADMIN_DATABASE_URL       superuser, provisioning and dumps only
```

```bash
pnpm tenant:new --key acme --name "Acme Logistics" \
                --admin-email ops@acme.com --brand acme --region ae
```

`--dry-run` prints the sequence without touching anything. `--seed-demo` loads
the evaluation dataset, for a demo instance rather than a customer's own.

**`fleet:migrate` runs sequentially and does not stop on a failure.** Parallel
migration is a way to take every customer down at once instead of one at a
time; stopping halfway leaves the fleet split with no report of which half is
which. It continues, names every tenant and its outcome, reports version drift
across the fleet, and exits non-zero.

**`fleet:restore-drill` is the one to schedule.** A backup nobody has restored
is a hypothesis. The drill restores into a scratch database and checks the
content rather than the exit status — including that the RLS policies survived,
because a restore that drops them produces a database that looks perfect and
enforces nothing.

**Before customer number two, read `Operations_Findings.md` §7.** `app_user` and
`app_migrator` are PostgreSQL roles, which are cluster-wide rather than
per-database — so `db:provision` for a second tenant on the same cluster
rewrites the first tenant's passwords. One instance per tenant avoids it; a
shared cluster needs per-tenant role names first.

Dumps are taken through the **admin** connection. `app_user` holds
`nobypassrls` and cannot read outside its own branches, so a dump taken as the
application role is silently partial — which is the most dangerous artefact in
this area.

## The documents

| | |
|---|---|
| [`Qabandi_Release_One_SRS.md`](docs/Qabandi_Release_One_SRS.md) | What Release One is, requirement by requirement, and what it is not (§11) |
| [`Qabandi_Architecture.md`](docs/Qabandi_Architecture.md) | How it is built and why each choice was made |
| [`Freight_Domain_Primer.md`](docs/Freight_Domain_Primer.md) | The business, for an engineer who has not worked in it |
| [`Qabandi_Pilot_15_Day.md`](docs/Qabandi_Pilot_15_Day.md) | The pilot plan |
| [`Gulf_Market_Analysis.md`](docs/Gulf_Market_Analysis.md) | Can this be sold to a second customer — competitors, mandates, wedges |
| [`Integration_Landscape.md`](docs/Integration_Landscape.md) | What the external services actually offer: tracking, e-invoicing, customs, FX. Every claim tagged verified, documented or reported |
| [`Operations_Findings.md`](docs/Operations_Findings.md) | What broke in the first real deployment and what it taught us. Read before standing up customer number two |

## The parts worth reading first

**`packages/db/src/actor.ts`** — every request opens one transaction and stamps
the acting principal into transaction-local settings. The third argument to
`set_config` being `true` is the single most important detail in the repository:
it makes the setting transaction-local, which is what keeps this safe behind
PgBouncer in transaction-pooling mode.

**`packages/db/migrations/0004_rls.sql`** — around fifteen policies covering the
whole system. Tables fall into four scoping shapes: branch-scoped, job-derived,
group-shared and config. An unauthorised request for another branch's job
returns *not found*, because the row is not visible to the query at all.

**`packages/db/migrations/0003_audit.sql`** — one trigger function attached to
every business table by a loop, so adding a table adds its audit automatically.
`UPDATE` and `DELETE` on `audit_log` are revoked from every role. FR-AD-01 says
no administrator may edit an audit entry, and only the database can enforce
that.

**`packages/core/`** — the engines. Six charge calculations behind eighteen
accessorial rows; one clock behind demurrage, detention and storage; one
working-calendar duration function behind every SLA and ageing rule. 43 tests,
no database, 130ms.

## Conventions that are load-bearing

**Money is decimal, always.** `numeric(19,6)` in the database, `Decimal` in
`core`, a string on the wire. Never a JS `number`. Rounding happens per currency
at the line — KWD carries three decimals, so a global `toFixed(2)` corrupts every
Kuwaiti amount in the system.

**Every charge line stores its own FX rate and the moment it was taken.** That is
the only way a USD-priced quote invoiced in KWD reconciles months later.

**Nothing is deleted.** Records carry `superseded_by`, `closed_at` or
`is_active`. `DELETE` is revoked from `app_user` on every table, so this is
structural rather than a convention.

**Bilingual from the first commit.** `dir` on `<html>`, CSS logical properties
throughout (`ms-`/`me-`, never `ml-`/`mr-`), Arabic and English name columns on
every entity a document renders. Retrofitting RTL produces a worse result, so
R1.3 is a translation and review gate, not a rebuild.

**Configuration is rows, not classes.** Charge types, milestone templates,
exception codes, document types, notification templates, working calendars and
volumetric divisors are all seed rows. FR-AD-03 requires an administrator to
change them without a release, and honouring that properly deletes most of the
code we would otherwise write.

## Whitelabel

`FR-CP-01` and `NFR-16` require the operator's logo, colours and domain
everywhere a customer or partner can see, and no supplier branding anywhere.
The cheapest way to keep that true a year from now is to make the operator a
parameter, so **no component in `apps/web` contains a colour literal, a company
name or a logo path.**

`packages/brand` holds one object — identity, two hue specifications, logo
geometry, typography, letterhead. Both themes, all three tonal ramps, every
semantic colour and the chart series are derived from it, emitted as CSS custom
properties in the root layout, and consumed through ordinary Tailwind utilities
(`bg-surface`, `text-brand`, `border-line`) whose *values* resolve at run time.
A re-skin therefore needs no rebuild:

```bash
BRAND_NAME_EN="Meridian Logistics" BRAND_MONOGRAM=M \
BRAND_PRIMARY_HUE=155 BRAND_ACCENT_HUE=25 BRAND_RADIUS=4 pnpm dev
```

A second operator properly is one file under `packages/brand/src/brands/`,
registered in `resolve.ts`, then `BRAND=<key>`. `/admin` renders the resolved
tokens and the variable that overrides each one, so the claim is inspectable
rather than asserted.

Two things deliberately do *not* follow the brand:

- **Status colours.** Positive, caution, critical, info and muted are reserved
  for state. A board where "held" is calm because it matched a corporate palette
  is worse than useless. A brand hue within ~15° of one of them will read as
  that status — move the brand hue, not the status.
- **Chart series.** Four slots, assigned in order and never cycled. Slots 1 and
  2 follow the brand's own hues; 3 and 4 are fixed support hues. All four are
  validated for lightness band, chroma floor, adjacent-pair separation under
  simulated protanopia and deuteranopia, and contrast against both surfaces —
  in both themes. Changing a support hue means re-running that validation.

## Deliberately absent

No repository layer, no DI container, no DTO or mapper layer, no service
classes, no CQRS, no event bus, no microservices, no Redis, no GraphQL, no
client-side state manager. Each is argued in the section of the architecture
where it would otherwise appear.

Seven interfaces exist in the whole system, listed in
`apps/service/src/ports/index.ts`. Each has a real first implementation today
and a second one the SRS itself names.

## Toolchain notes

- **pnpm workspaces**, Node 22 LTS or newer.
- **Bundler module resolution** across the repo. `packages/*` are consumed as
  TypeScript source rather than built artefacts, so the service is bundled with
  esbuild (`apps/service/build.mjs`) rather than emitted by `tsc`.
- **oxlint rather than ESLint.** typescript-eslint does not yet support the
  TypeScript 7 compiler this repository uses; oxlint parses TypeScript natively
  and carries no dependency on the TS API. Revisit once typescript-eslint ships
  TS 7 support.

## Status

Scaffolded to the architecture and verified against a live PostgreSQL 18.6:

- **64 tables, 57 with RLS enabled *and* forced, 75 policies, 56 audit
  triggers, 53 `uuidv7()` primary keys.** The seven tables without RLS are the
  auth library's own plus the throttle and webhook-receipt tables, each opted
  out in code with a stated reason.
- **The temporal constraint holds.** `UNIQUE NULLS NOT DISTINCT (direction,
  partner_id, customer_id, mode, origin_id, destination_id, validity WITHOUT
  OVERLAPS)` is live, so two overlapping rate cards for one lane are
  unrepresentable rather than merely unlikely.
- **11 RLS policy tests pass against real fixtures** — two branches, two
  customers, an agent partner and two jobs. Confirmed non-vacuous: weakening
  `jobs_scope` to `using (true)` fails four of them.
- **43 core tests, no database, 130ms.**
- `web` builds, `service` bundles, and the schema shows no drift from the
  migrations.

Not yet built, and marked as such in the code: the PDF renderer (the Chromium
layer is in `infra/Dockerfile.service`), inbound email and WhatsApp workers,
bulk import, scheduled reports, and the notification channel adapters. Each
appears in `apps/service/src/workers/index.ts` with its trigger and requirement
recorded, so nothing goes quietly missing.
