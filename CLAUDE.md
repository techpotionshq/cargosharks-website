# Qabandi — working notes

Digital freight platform for a Kuwaiti forwarder. pnpm workspace, Next.js 16 +
Fastify + PostgreSQL 18, bilingual (en/ar) throughout.

**The one-line version:** the database enforces tenancy, audit and
immutability; reference data drives the engines; application code stays thin
enough to be boring.

Full guides: [`CONTRIBUTING.md`](CONTRIBUTING.md) for the working loop and
schema changes, [`README.md`](README.md) for setup, and
[`docs/Qabandi_Architecture.md`](docs/Qabandi_Architecture.md) for the reasoning.

## Commands

```bash
pnpm doctor        # what is configured and what each missing thing costs
pnpm dev           # web :3000, service :3001
pnpm lint          # oxlint + seven repository invariants
pnpm typecheck
pnpm test:core     # engines, no infrastructure, ~1.4s
pnpm test:db       # migrations, seed, RLS matrix — needs a database
pnpm test:e2e      # every screen, both languages, on fixtures
```

## Finding your way around — `pnpm q`

Three layers of indirection make this repository slow to grep: a screen's text
is a key in a catalogue, a URL is not a path because of route groups, and a
table is spread over four files. `pnpm q` reads the tree in ~250ms and answers
directly. Everything it prints is `file:line`.

```bash
pnpm q map                 # the whole repository on one screen
pnpm q find <anything>     # messages, routes, slices, tables, symbols, paths at once
pnpm q msg "<text>"        # what an operator quoted -> key -> both languages -> call sites
pnpm q msg set <key> --en "…" --ar "…"    # write both catalogues atomically
pnpm q where /invoices     # url -> page file, layouts, slices, fixture status
pnpm q slice payables      # files, routes, permissions, namespaces, tests, exports
pnpm q table shipments     # schema, migration, policy, audit trigger, callers
pnpm q sym withActor       # declaration + every file that imports and names it
pnpm q impact <file>       # importers, tests, screens — without running anything
pnpm q gate                # only the checks the current diff can break, ~3s
```

`pnpm q gate` will not start `test:db`, the web or service suites, `test:e2e` or
`build` — it names them and stops. They are minutes long, and the first three
share one remote database that fails differently every time two of them overlap.
`--full` runs them, strictly one at a time.

A `PostToolUse` hook (`scripts/q-hook.mjs`) runs the matching invariant checks
after every edit and says nothing unless one fails.

`QABANDI_PILOT_FIXTURES=1 pnpm dev` runs the pilot screens with no database.
It is a subset: the routes that still need one are listed as `NEEDS_DATABASE`
in `apps/web/e2e/support/harness.ts`, each naming the query responsible.

## Non-negotiables

- **Money is decimal.** `numeric(19,6)` → `Decimal` in core → string on the
  wire. Never a JS `number`. KWD carries three decimals, so a global
  `toFixed(2)` corrupts every Kuwaiti amount.
- **Every database read goes through `withActor`** (`packages/db/src/actor.ts`).
  `db` is not exported for query use. RLS reads transaction-local settings
  stamped there; there is no un-actored path.
- **Nothing is deleted.** `superseded_by` / `closed_at` / `is_active`. `DELETE`
  is revoked from `app_user`.
- **Both languages, always.** Every user-facing string needs `en` and `ar`; CSS
  logical properties (`ms-`/`me-`, never `ml-`/`mr-`). `pnpm lint` enforces it.
- **`core` imports nothing** — no I/O, no database, no framework. Feature slices
  never import each other; shared logic goes *down* into `core` or `db`.
- **Configuration is rows, not code.** Charge types, milestone templates,
  exception codes, document types and calendars are seed rows an administrator
  edits without a release (FR-AD-03).

## Schema changes — read before touching `packages/db`

Two commands, and picking wrong is expensive:

- `pnpm db:generate` — DDL derived from the TypeScript schema.
- `pnpm db:generate:custom` — an empty file for hand-written SQL (policies,
  triggers, grants, backfills). **It carries the schema snapshot forward**,
  which is what keeps `db:generate` diffing against reality next time.

Never hand-edit `migrations/meta/_journal.json`. `drizzle-kit push` is disabled
deliberately — it force-syncs the TS schema onto a live database and knows
nothing about the policies that enforce tenancy.

Declare tables with `pgTable` imported from `./table`, never from
`drizzle-orm/pg-core`: the wrapper registers them for the RLS and audit
coverage tests. A new table needs a policy written by hand — RLS enabled with
no policy denies every row to everyone, silently — and a
`select app.attach_audit('<table>')` in the same migration; the `0003` loop
ran once and does not revisit.

`CONTRIBUTING.md` has the full add-a-table walkthrough.

## The dev environment is real

There is no local database. Both `qabandi` and `qabandi_test` are on a remote
server, the dev mailbox (`freight@techpotions.app`, bound to branch DXB) is a
real inbox the running service polls every minute, and the model key is live.
Three rules follow, each learned the expensive way:

- **Run the web and service suites one at a time.** Concurrent runs against
  `qabandi_test` fail a different test each time; CI is sequential.
- **Anything that emails the sender of inbound mail needs a loop breaker.** A
  bounce once became 195 enquiries in half an hour (`Operations_Findings.md`
  §11).
- **"The model returned nothing" is a claim to check against
  `ai_invocations.response`,** not a diagnosis.

[`docs/Dev_Environment.md`](docs/Dev_Environment.md) has where everything
lives and the agreed automation roadmap — what shipped, what is next, what was
excluded.

## Style

Comments explain *why*, especially where the code looks odd — that is the
house style and it is load-bearing, because the git history is short. Match the
surrounding density. Commit messages are imperative prose: `fix: refuse to
start at boot, and give errors a face`.
