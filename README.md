# Qabandi Digital Freight Platform

A freight forwarding platform for **AL-QABANDI & PARTNERS Co. (Shipping &
Forwarding), Kuwait**: enquiries from WhatsApp and email, partner rates and
quotations, shipments and documents, invoicing and supplier bills, a customer
portal, an agent portal and public tracking. English and Arabic throughout.

**The database enforces tenancy, audit and immutability; reference data drives
the engines; application code stays thin enough to be boring.** The reasoning
is in [`docs/Qabandi_Architecture.md`](docs/Qabandi_Architecture.md).

## Getting started

Needs Node 22+, pnpm and PostgreSQL 18 (18, not 16 or 17: primary keys use
`uuidv7()` and rate-card validity uses `WITHOUT OVERLAPS`).

```bash
pnpm install
cp .env.example .env
pnpm doctor          # what is configured, and what each missing thing disables
```

**No database at all.** Every screen runs on the built-in pilot dataset, which
is also the hosted demo:

```bash
QABANDI_PILOT_FIXTURES=1 pnpm --filter @qabandi/web dev
```

**With a database:**

```bash
pnpm db:up           # PostgreSQL 18 in Docker; or db:provision against an existing server
pnpm db:migrate
pnpm db:seed         # currencies, charge types, milestones, calendars, roles
pnpm db:create-branch --code KWI --name "Your Company Co." --country KW --currency KWD
pnpm db:create-user  --email you@example.com --name "Your Name" --role administrator
pnpm dev             # web on :3000, service on :3001
```

`pnpm db:seed-demo` loads a realistic dataset for a customer's own evaluation
instance. The team's shared development database, mailbox and model key are
real; read [`docs/Dev_Environment.md`](docs/Dev_Environment.md) before running
anything against them.

### Accounts

The product is invitation-only, and a role is granted per branch, so create a
branch before any user. `db:create-user` re-run for an existing email resets the
password.

Roles: `administrator`, `finance`, `operations_manager`, `coordinator`, `sales`,
`customs_broker`, `read_only`. Administrators and finance must enrol in TOTP.
An overseas agent is `--partner <code>`, not a role, and signs in to `/agent`.

## Layout

```
packages/core     pure domain engines; imports nothing
packages/brand    the whitelabel contract: palette, logo, letterhead
packages/db       schema, RLS policies, triggers, and withActor
apps/web          Next.js: ops, settings, customer portal, agent portal, tracking
apps/service      Fastify: workers, PDFs, webhooks, the public read API
scripts/          doctor, the lint invariants, and `pnpm q`
```

Dependencies run `core ← db ← {web, service}`, enforced by `pnpm lint`. One
`Dockerfile` builds both images; `compose.prod.yaml` is for Coolify.

## Commands

| | |
|---|---|
| `pnpm q <query>` | find a screen, string, route, table or symbol; `pnpm q gate` runs only the checks your diff can break |
| `pnpm dev` | web and service together |
| `pnpm lint` | oxlint plus the repository invariants |
| `pnpm typecheck` | every package |
| `pnpm test:core` | domain engines, no database, seconds |
| `pnpm test:db` | migrations, seed and the RLS matrix; needs a database |
| `pnpm test:e2e` | every screen, both languages, desktop and mobile |
| `pnpm db:generate` / `db:generate:custom` | a schema migration / a hand-written SQL migration |
| `pnpm db:migrate` / `db:seed` | apply migrations / load reference rows |
| `pnpm tenant:new`, `brand:new`, `fleet:*` | provisioning and running customer deployments |

## Rules that are not negotiable

Money is decimal, never a JS number. Every database read goes through
`withActor`. Nothing is deleted. Every string ships in English and Arabic.
Configuration is rows, not code. The detail behind each, and how to change the
schema safely, is in [`CLAUDE.md`](CLAUDE.md) and
[`CONTRIBUTING.md`](CONTRIBUTING.md).

## Documents

| | |
|---|---|
| [`CONTRIBUTING.md`](CONTRIBUTING.md) | the working loop, and adding a table with its policy |
| [`docs/Provisioning.md`](docs/Provisioning.md) | standing up a customer, whitelabel, integration settings |
| [`docs/Deployment_Coolify.md`](docs/Deployment_Coolify.md) | the two containers, and what must never be exposed |
| [`docs/Dev_Environment.md`](docs/Dev_Environment.md) | where the development stack lives |
| [`docs/Qabandi_Architecture.md`](docs/Qabandi_Architecture.md) | how it is built and why |
| [`docs/Qabandi_Release_One_SRS.md`](docs/Qabandi_Release_One_SRS.md) | what Release One is, requirement by requirement |
| [`docs/Freight_Domain_Primer.md`](docs/Freight_Domain_Primer.md) | the business, for an engineer new to it |
| [`docs/Operations_Findings.md`](docs/Operations_Findings.md) | what broke in the first deployment; read before customer two |
| [`docs/compliance/`](docs/compliance/README.md) | security measures and sub-processors, for a buyer's reviewer |

Other planning and market documents are in [`docs/`](docs/).
