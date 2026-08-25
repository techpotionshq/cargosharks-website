---
name: qabandi-verify
description: Decide what to run to check a change in the Qabandi repo, and what NOT to run. Use BEFORE running any pnpm test, lint, typecheck or build command here. Triggers on "run the tests", "check this works", "is it green", "verify", "lint", "typecheck", "build", or whenever a change is finished and needs proving.
---

# What to run, and what to leave alone

**Default: `pnpm q gate`.** It reads the diff, runs only the checks that diff can
break, in parallel, and refuses to start the expensive ones on its own.

```bash
pnpm q gate          # the free tier for the current diff — usually 2–4s
pnpm q gate --dry    # print the plan, run nothing
pnpm q gate --full   # also run the database and slow suites, strictly one at a time
```

## The cost table, measured on this machine

Free. Run these constantly; there is no reason to skip them.

| | |
| --- | --- |
| any one `check-*.mjs` | 80–150ms |
| `oxlint` whole repo | 320ms |
| `tsc` one package | 0.4–2.0s |
| `pnpm typecheck` all six | 6.5s |
| `pnpm test:core` — 509 tests, no infrastructure | 3.7s |

Not free. **Never start these without saying so first.**

| | why |
| --- | --- |
| `pnpm test:db` | migrations, seed and the RLS matrix against the shared remote |
| `pnpm --filter @qabandi/web test` | web unit suite — also hits `qabandi_test` |
| `pnpm --filter @qabandi/service test` | service unit suite — also hits `qabandi_test` |
| `pnpm test:e2e` | every screen, both languages, minutes |
| `pnpm build` | the production build, minutes |

## The one rule that is not about speed

**There is no local database.** `qabandi_test` is a shared remote, and two suites
against it at once fail a different test each run. That reads as flakiness and
costs an afternoon before anyone remembers why. CI is sequential for this reason,
and `q gate --full` runs them one after another rather than in its parallel pool.
Never run `test:db`, the web suite and the service suite concurrently — not in
separate Bash calls, not in the background.

## What each check refuses

Each exists because the bug it catches actually shipped. When one fires, read the
message: it names the file, the line and the correct form.

| check | refuses |
| --- | --- |
| `check-boundaries` | `core` importing infrastructure; slices importing each other |
| `check-migrations` | a migration folder whose newest snapshot is stale |
| `check-messages` | an English string with no Arabic; a key that resolves to nothing |
| `check-links` | an `href` to a route that does not exist |
| `check-schedules` | a cron job with no handler registered to run it |
| `check-permissions` | a permission the app enforces that `core` does not declare |
| `check-brand` | a colour literal outside `packages/brand` |

A `PostToolUse` hook already runs the relevant ones after every edit and stays
silent unless one fails — so a green edit means those passed. `q gate` adds the
typechecks and `test:core`.

## When static checking is not enough

The gate proves types, invariants and the engines. It does not prove a query
returns the right rows or a screen renders. When that is the question, say which
suite is needed and why, then ask before starting it. `QABANDI_PILOT_FIXTURES=1
pnpm dev` renders 25 of the 49 screens with no database at all and is usually the
faster answer — `pnpm q where <url>` says whether a given screen is one of them.

Report what actually ran. If the gate was green but `test:db` did not run, say so;
the gate itself prints that line for exactly this reason.
