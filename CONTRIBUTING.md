# Contributing

Read [`README.md`](README.md) first for what the product is and how to run it,
and [`docs/Qabandi_Architecture.md`](docs/Qabandi_Architecture.md) for why it is
shaped the way it is. This file is the working guide: what to run, what will
stop you, and how to make the change you are most likely to make first.

---

## Your first hour

```bash
pnpm install
pnpm doctor          # what is configured, what is missing, what each one costs
```

`pnpm doctor` is the honest answer to "am I set up yet". Almost nothing is
required: every external service sits behind a port with a stub (§10), so an
unconfigured adapter disables one named capability rather than breaking the
application.

**See the product before you read it.** The interface runs on the seeded pilot
dataset with no database at all:

```bash
QABANDI_PILOT_FIXTURES=1 pnpm dev     # web on :3000
```

Twenty jobs at varied stages, a live customs hold, a demurrage clock that has
already written its own charge line. It is a subset — the registers that still
want a database are listed as `NEEDS_DATABASE` in
`apps/web/e2e/support/harness.ts`, and `pnpm db:seed-demo` is the full
instance. Read [the parts worth reading
first](README.md#the-parts-worth-reading-first) with the screens open next to
them; the domain makes far more sense that way round.

---

## The loop

```bash
pnpm lint        # oxlint + six repository invariants (below)
pnpm typecheck   # every package
pnpm test:core   # the engines. No database, no network, ~1.4s
pnpm test:db     # migrations, seed, RLS matrix. Needs a database
pnpm test:e2e    # every screen, both languages, on fixtures
```

`pnpm lint` and `pnpm test:core` are fast enough to run constantly. The other
three are what CI runs, in that order, ordered by how quickly they fail.

---

## What will stop you, and why

`pnpm lint` runs six checks that are not style. Each exists because the bug it
catches actually shipped, and each prints the fix rather than the rule:

| Check | Refuses |
| --- | --- |
| [`check-boundaries.mjs`](scripts/check-boundaries.mjs) | `core` importing infrastructure; feature slices importing each other; an unqualified correlated subquery; a table declared outside the registry |
| [`check-migrations.mjs`](scripts/check-migrations.mjs) | a migration folder whose newest snapshot is stale — see below |
| [`check-messages.mjs`](scripts/check-messages.mjs) | an English string with no Arabic, or a key that resolves to nothing |
| [`check-links.mjs`](scripts/check-links.mjs) | an `href` to a route that does not exist |
| [`check-schedules.mjs`](scripts/check-schedules.mjs) | a job on the cron schedule with no handler registered to run it |
| [`check-permissions.mjs`](scripts/check-permissions.mjs) | a permission the application enforces that `core` does not declare — so no role, not even `administrator`, is ever granted it |

If one of these fires, read the message. It names the file, the line, and the
correct form.

---

## Making a schema change

**This is the part to read before you touch `packages/db`.** Migrations are
forward-only, versioned in the repository, and applied as `app_migrator` — never
as the application's own role (§5.1).

There are two kinds, and picking the wrong command is the one mistake here that
is genuinely expensive:

```bash
pnpm db:generate          # DDL derived from the TypeScript schema
pnpm db:generate:custom   # an empty file for hand-written SQL
```

Use **`db:generate:custom`** for anything Drizzle does not model — policies,
triggers, grants, temporal constraints, backfills. It prepares an empty
migration *and carries the schema snapshot forward*, which is what keeps
`db:generate` diffing against reality next time. Never add an entry to
`migrations/meta/_journal.json` by hand: that leaves no snapshot, and the next
`db:generate` silently diffs against a schema several migrations out of date and
emits a migration re-creating tables that already exist. `check-migrations.mjs`
now fails the build if that happens, but the cure is using the right command.

`drizzle-kit push` is disabled deliberately. It force-syncs the TypeScript
schema onto a live database and knows nothing about the hand-written policies,
triggers and grants that enforce tenancy.

### Adding a table, end to end

1. **Declare it** in `packages/db/src/schema/`, importing `pgTable` from
   `./table` — never from `drizzle-orm/pg-core`. The wrapper records the table
   in a registry that the RLS and audit tests walk. A table outside the §5
   obligations uses `systemTable('reason')` instead, and the reason is required.

2. **Generate the DDL** with `pnpm db:generate`.

3. **Write its policy** with `pnpm db:generate:custom`. Read
   [`migrations/0004_rls.sql`](packages/db/migrations/0004_rls.sql) first —
   tables fall into four scoping shapes (branch-scoped, job-derived,
   group-shared, config) and yours is almost certainly one of them. Enabling RLS
   without writing a policy denies every row to everyone: the table is simply
   empty from the application's point of view, and nothing says why. In the
   same file, `select app.attach_audit('<table>')` — the loop in `0003` ran
   once, over the tables that existed then, and does not run again
   ([`0008`](packages/db/migrations/0008_support_access.sql) says why).

4. **Apply and seed:** `pnpm db:migrate`, then `pnpm db:seed`.

5. **Run `pnpm test:db`.** Three tests will now assert things about your table
   without you writing them: RLS enabled *and* forced, an audit trigger
   attached, and at least one policy present. If you skipped step 3, this is
   where you find out.

Configuration that an administrator should change without a release — charge
types, milestone templates, exception codes, document types, notification
templates, working calendars — is **seed rows, not code** (FR-AD-03).

---

## Conventions that are load-bearing

The full list is in [the README](README.md#conventions-that-are-load-bearing).
The four that cause real bugs when forgotten:

- **Money is decimal, always.** `numeric(19,6)` in the database, `Decimal` in
  `core`, a string on the wire — never a JavaScript `number`. Rounding happens
  per currency at the line: KWD carries three decimals, so a global `toFixed(2)`
  corrupts every Kuwaiti amount in the system.
- **Every charge line stores its own FX rate and when it was taken.**
- **Nothing is deleted.** `superseded_by`, `closed_at`, `is_active`. `DELETE` is
  revoked from `app_user`, so this is structural rather than a convention.
- **Bilingual from the first commit.** CSS logical properties throughout
  (`ms-`/`me-`, never `ml-`/`mr-`). Every user-facing string needs both `en` and
  `ar`, and `check-messages.mjs` enforces it.

---

## Where things live

```
packages/core      pure domain — no I/O, no database, no framework
packages/db        schema, migrations, the actor transaction, RLS
packages/brand     the whitelabel contract — palette, logo, typography
apps/web           Next.js: app/ routes, features/ slices, ui/ components
apps/service       workers, adapters, PDF rendering, the AI surfaces,
                   the internal API and the public read API
```

Feature slices in `apps/web/src/features/` do not import each other. Shared
logic goes *down* into `core` or `db`, never sideways — quote lines and invoice
lines look similar and are different concepts.

---

## Commits

Commit messages here say what changed and why, in prose, in the imperative:
`fix: refuse to start at boot, and give errors a face`. Match that. The
repository's history is short and its comments are long, which is deliberate:
the reasoning lives next to the code it justifies, so put it there rather than
in a message nobody will read again.
