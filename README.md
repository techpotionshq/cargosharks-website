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
pnpm dev            # web on :3000, service on :3001
```

`pnpm db:up` needs Docker. Without it, point `DATABASE_URL` and
`MIGRATION_DATABASE_URL` at any PostgreSQL 18 instance and apply
`infra/postgres/init/01-roles.sql` first — it creates the two roles the design
depends on.

**PostgreSQL 18 is required, not preferred.** `uuidv7()` is the default for
every primary key and temporal `WITHOUT OVERLAPS` carries rate-card validity.
Both would have to be hand-rolled on 16 or 17. See Architecture §6.4.

## Layout

```
packages/
  core/      pure domain. imports nothing. no I/O, no DB, no framework.
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
| `pnpm db:migrate` | apply migrations as `app_migrator` |
| `pnpm db:seed` | reference rows the engines need |
| `pnpm db:reset` | drop the volume and start clean |

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

Scaffolded to the architecture. Standing up and verified:

- the full schema (53 tables), migrations, RLS policies and audit triggers
- `core`: money, chargeable, rating, clocks, states — 43 passing tests
- `db`: actor transaction, client, generated Zod validation, seed
- `web`: four route groups, bilingual shell, session resolution, the enquiries
  slice end to end
- `service`: queue, three workers, webhooks, public read API, the seven ports

Not yet built, and marked as such in the code: the PDF renderer (the Chromium
layer is in `infra/Dockerfile.service`), inbound email and WhatsApp workers,
bulk import, scheduled reports, and the notification channel adapters. Each
appears in `apps/service/src/workers/index.ts` with its trigger and requirement
recorded, so nothing goes quietly missing.
