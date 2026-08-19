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
pnpm lint          # oxlint + four repository invariants
pnpm typecheck
pnpm test:core     # engines, no infrastructure, ~1.4s
pnpm test:db       # migrations, seed, RLS matrix — needs a database
pnpm test:e2e      # every screen, both languages, on fixtures
```

`QABANDI_PILOT_FIXTURES=1 pnpm dev` runs the whole interface with no database.

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
no policy denies every row to everyone, silently.

`CONTRIBUTING.md` has the full add-a-table walkthrough.

## Style

Comments explain *why*, especially where the code looks odd — that is the
house style and it is load-bearing, because the git history is short. Match the
surrounding density. Commit messages are imperative prose: `fix: refuse to
start at boot, and give errors a face`.
