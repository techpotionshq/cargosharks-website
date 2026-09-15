---
name: qabandi-navigate
description: Find anything in the Qabandi repository — a screen, a string an operator quoted, a route, a feature slice, a table, an exported symbol, or what a change to one file can break. Use BEFORE grepping or globbing for code in this repo. Triggers on "where is", "find the", "which file", "what renders", "what uses", "change the X screen", or any request naming a screen, register, message, table or route.
---

# Finding things in this repository

760 files, 136k lines, three layers of indirection that grep does not see through.
`pnpm q` reads the whole tree in ~250ms and answers directly. **Reach for it before
Grep.** Everything it prints is `file:line`.

```bash
pnpm q map                 # the whole repo on one screen — start here when lost
pnpm q find <anything>     # one query against every index at once
pnpm q msg "<text>"        # text an operator quoted -> key -> both catalogues -> call sites
pnpm q where /invoices     # url -> page file, its layouts, the slices it reads, fixture status
pnpm q slice payables      # a slice's files, routes, permissions, namespaces, tests, exports
pnpm q table shipments     # schema decl, creating migration, RLS policy, audit trigger, callers
pnpm q sym withActor       # declaration + every file that imports and names it
pnpm q impact <file>       # importers, tests that reach it, screens that render it
```

## The three indirections, and which verb cuts through each

**Text is a key.** A screen says "Awaiting approval". That string lives in
`apps/web/messages/en.json` under a dotted path, and is called as `t('leaf')`
against a namespace bound elsewhere in the file — often inside a `Promise.all`
destructure, which a naive scan misses entirely. `pnpm q msg "Awaiting approval"`
does all three hops and prints the Arabic beside it.

**A URL is not a path.** Route groups mean `/invoices` lives at
`app/(ops)/invoices/page.tsx` and nothing in the URL says `(ops)`. `pnpm q where`
maps it, and also tells you whether `QABANDI_PILOT_FIXTURES=1` can render it —
24 of the 49 pages still need a database.

**A table is four files.** Declaration, creating migration, policy migration,
audit-trigger migration — and the last two are often `do $$ … end $$` loops over a
name array rather than a greppable statement. `pnpm q table` finds all four and
labels which answers are certain and which are inferred from a loop.

## The shape of the code

- `apps/web/src/features/<name>/` — 25 slices, all the same anatomy: `queries.ts`
  reads, `form-actions.ts` writes, `ui/*.tsx` renders, `*.test.ts` proves.
  **Slices never import each other.** Shared logic goes *down* into `packages/core`
  or `packages/db`.
- `apps/web/src/app/(agent|auth|ops|portal|public|settings)/` — 49 pages, 13 handlers.
- `apps/service/src/{workers,pdf,adapters,ai,api,webhooks,accounting,ports}/`.
- `packages/core/src/*.ts` — 22 pure engines. **Imports nothing** — no I/O, no
  database, no framework.
- `packages/db/src/schema/*.ts` — 83 tables; `migrations/*.sql` — 36 migrations.
- `packages/brand` — the only place a colour literal is legal.

Screen names and slice names diverge on purpose: the invoice register is
`app/(ops)/invoices` and reads `features/ledger`. Do not guess the mapping —
`pnpm q where` or `pnpm q slice` has it.

## When to use Grep instead

`q` indexes messages, routes, slices, tables, exports and paths. For prose inside
comments, SQL bodies, seed data or anything in `docs/`, Grep is the right tool and
`q find` will say so rather than pretend.

## Before you change anything

`pnpm q impact <file>` says what imports it, which tests reach it and which screens
render it — without running anything. Then `pnpm q gate` runs only the checks that
change can break. See the `qabandi-verify` skill for what is cheap and what is not.
