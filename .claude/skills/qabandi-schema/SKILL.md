---
name: qabandi-schema
description: Change the Qabandi database schema — add or alter a table, column, index, constraint, RLS policy or trigger; write a migration. Use BEFORE touching packages/db. Triggers on "add a table", "add a column", "new migration", "change the schema", "add an index", "write a policy", or any request whose implementation needs a new place to store something.
---

# Changing the schema

Migrations are forward-only, versioned in the repository, and applied as
`app_migrator` — never as the application's own role. **Picking the wrong generate
command is the one genuinely expensive mistake here.**

```bash
pnpm db:generate          # DDL derived from the TypeScript schema
pnpm db:generate:custom   # an empty file for hand-written SQL
```

Use `db:generate:custom` for anything Drizzle does not model — policies, triggers,
grants, temporal constraints, backfills. It prepares an empty migration **and
carries the schema snapshot forward**, which is what keeps `db:generate` diffing
against reality next time.

Never add an entry to `migrations/meta/_journal.json` by hand. That leaves no
snapshot, and the next `db:generate` silently diffs against a schema several
migrations out of date and emits one re-creating tables that already exist.
`check-migrations.mjs` fails the build on it now, but the cure is the right command.

`drizzle-kit push` is disabled deliberately: it force-syncs the TypeScript schema
onto a live database and knows nothing about the hand-written policies, triggers and
grants that enforce tenancy.

## Adding a table, end to end

1. **Declare it** in `packages/db/src/schema/`, importing `pgTable` from `./table` —
   **never** from `drizzle-orm/pg-core`. The wrapper registers it, and the RLS and
   audit tests walk that registry. A table outside the §5 obligations uses
   `systemTable('reason')` instead, and the reason is required.

2. **Generate the DDL:** `pnpm db:generate`.

3. **Write its policy** with `pnpm db:generate:custom`. Read
   `packages/db/migrations/0004_rls.sql` first — tables fall into four scoping
   shapes (branch-scoped, job-derived, group-shared, config) and yours is almost
   certainly one of them. **RLS enabled with no policy denies every row to everyone,
   silently:** the table is simply empty from the application's point of view and
   nothing says why.

4. **Attach audit** in the same migration: `select app.attach_audit('<table>')`.
   The loop in `0003` ran once, over the tables that existed then, and does not
   revisit. `0008_support_access.sql` says why.

5. **Apply and seed:** `pnpm db:migrate`, then `pnpm db:seed`.

Check your work against an existing table of the same shape:

```bash
pnpm q table <an-existing-similar-table>
```

It prints the declaration, the creating migration, the policy, the audit trigger and
every file that reads or writes it — so a new table can be compared against one that
is already correct. It reads migration text, so where a policy was applied inside a
`do $$ … end $$` loop it says "probably" rather than claiming certainty. The
authority is `pnpm test:db`.

## The rules that outlive any one migration

- **Money is `numeric(19,6)`** → `Decimal` in core → string on the wire. Never a JS
  `number`. KWD carries three decimals, so a global `toFixed(2)` corrupts every
  Kuwaiti amount.
- **Nothing is deleted.** `superseded_by` / `closed_at` / `is_active`. `DELETE` is
  revoked from `app_user`.
- **Every read goes through `withActor`** (`packages/db/src/actor.ts`). `db` is not
  exported for query use; RLS reads transaction-local settings stamped there.
- **Configuration is rows, not code.** Charge types, milestone templates, exception
  codes, document types and calendars are seed rows an administrator edits without a
  release. A new one of those is a seed row, not a new table.

## Verifying

`pnpm q gate` runs `check-migrations`, `check-boundaries` and the typechecks. It
will **not** run `pnpm test:db` on its own — that is the shared remote database, and
it is the only thing that actually proves the policy works. Say that it is needed and
ask before starting it, and never run it alongside the web or service suite.
