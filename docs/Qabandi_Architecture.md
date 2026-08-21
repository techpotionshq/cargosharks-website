# Qabandi Digital Freight Platform — Technical Architecture

**Architecture Specification · v1.0 · Internal**

| | |
|---|---|
| **Client** | AL-QABANDI & PARTNERS Co. (Shipping & Forwarding), Kuwait |
| **Prepared by** | techpotions |
| **Date** | August 2026 |
| **Status** | Draft for discovery review |
| **Covers** | Release One · 126 functional · 18 non-functional requirements |
| **Companion documents** | `Qabandi_Release_One_SRS.md` · `Qabandi_Pilot_15_Day.md` · `Freight_Domain_Primer.md` |

> **The architecture in one line:** the database enforces tenancy, audit and immutability; reference data drives the engines; application code stays thin enough to be boring.

---

## Contents

1. [What this document decides](#1-what-this-document-decides)
2. [Stack](#2-stack)
3. [Topology](#3-topology)
4. [Repository layout](#4-repository-layout)
5. [The database as enforcement boundary](#5-the-database-as-enforcement-boundary)
6. [Schema](#6-schema)
7. [The engines](#7-the-engines)
8. [Identity and access](#8-identity-and-access)
9. [Background work](#9-background-work)
10. [Integrations and ports](#10-integrations-and-ports)
11. [Money, language and time](#11-money-language-and-time)
12. [Performance](#12-performance)
13. [Environments, delivery and handover](#13-environments-delivery-and-handover)
14. [Decisions to confirm in discovery](#14-decisions-to-confirm-in-discovery)
15. [Traceability](#15-traceability)

---

## 1. What this document decides

The SRS says *what* Release One does. This says *how it is built*, and — more usefully — **what is deliberately not built**.

Three rules govern every choice below.

1. **Cross-cutting concerns are solved once, at the database boundary.** Branch scoping, audit and immutability are not the responsibility of feature code, because feature code forgets. A missed `where` clause must not be able to leak another branch's data.
2. **Anything the SRS requires to be editable without a code change is a row, not a class.** `FR-AD-03` mandates this for charge types, milestone templates, exception codes, document types and notification templates. Honouring it properly deletes most of the code we would otherwise write.
3. **No abstraction without a named second implementation.** Interfaces are introduced where the SRS itself names a future change — not in anticipation of one.

**What we are not building:** no repository layer, no DI container, no DTO/mapper layer, no service classes, no CQRS, no event bus, no microservices, no Redis, no GraphQL, no client-side state manager. Each is noted with its reason in the section it would otherwise appear in.

---

## 2. Stack

| Concern | Choice | Why this, and not the obvious alternative |
|---|---|---|
| **Database** | PostgreSQL 18 | Load-bearing, not interchangeable. RLS satisfies `NFR-09` and `FR-ID-04`; triggers satisfy `FR-AD-01`; `jsonb` carries rate snapshots; `numeric` carries KWD's three decimals. Version rationale and the four v18 features this design uses: [§6.4](#64-why-postgresql-18). |
| **Data access** | Drizzle ORM over `node-postgres` | SQL-first, so RLS and triggers stay visible rather than hidden behind an ORM. Schema is the single source of truth for types and validation. |
| **Validation** | Zod, generated from the Drizzle schema via `drizzle-zod` | One column definition becomes DB constraint, TS type, server validation, form validation, API contract and import validation. |
| **Web** | Next.js (App Router), React Server Components, Server Actions | One application serving four audiences as route groups. |
| **Service** | Fastify (Node 22 LTS), containerised | Exists for work Next.js cannot do: long-running workers, Chromium PDF rendering, inbound webhooks, the public read API. |
| **Queue / scheduler** | pg-boss | Postgres-backed, with a Drizzle adapter. Jobs enqueue *inside* the business transaction — a transactional outbox with no extra component. Rejected Redis/BullMQ: it buys throughput we will never need and adds a stateful service to hand over. |
| **Auth** | Better Auth — core only | See [§8](#8-identity-and-access). Credentials and sessions only; authorization is ours. |
| **Files** | S3-compatible object storage behind a `FileStore` port | Supabase Storage for the pilot, S3 for R1, one interface. |
| **PDF** | Headless Chromium rendering HTML templates | The only renderer with dependable Arabic shaping and RTL. `NFR-01`, `§8`. |
| **i18n** | `next-intl`, CSS logical properties, `dir` on `<html>` | Bilingual from the first commit. See [§11](#11-money-language-and-time). |
| **Realtime** | SSE over Postgres `LISTEN/NOTIFY` | The ops board and milestone updates are low-frequency. Rejected WebSockets: nothing in the SRS needs bidirectional push. |
| **Testing** | Vitest (core, unit) · Playwright (flows) · `pgTAP` or SQL fixtures (RLS policies) | RLS is a security control and gets its own tests. |

**Deliberately absent:** an ORM-agnostic repository layer. Drizzle *is* the data access layer, and Postgres is not swappable here by design — wrapping it to enable a migration that will never happen adds indirection with no payoff.

---

## 3. Topology

Two deployables, one database.

```
                 ┌──────────────────────────────┐
   browsers ───► │  apps/web        (Next.js)   │
                 │  ops · portal · agent · track│
                 └──────────────┬───────────────┘
                                │
                 ┌──────────────▼───────────────┐
                 │  PostgreSQL 16               │
                 │  RLS · audit triggers        │
                 │  pg-boss queue tables        │
                 └──────────────▲───────────────┘
                                │
   webhooks  ───► ┌─────────────┴────────────────┐
   (WhatsApp,     │  apps/service    (Fastify)   │ ───► email · WhatsApp
    email, FX)    │  workers · PDF · read API    │      webhooks · storage
                 └──────────────────────────────┘
```

`apps/web` never sends an email, renders a PDF or calls a third party inline. It writes a row and enqueues a job. Everything outward-facing is the service's, which is what makes retry, delivery logging (`FR-NT-06`) and rate limiting (`FR-NT-07`) a single implementation rather than a per-caller concern.

### 3.1 Hosting — pilot and Release One differ deliberately

| | Pilot (15 days) | Release One |
|---|---|---|
| **Web** | Vercel | Container on the client's cloud |
| **Database** | Managed Supabase | Postgres in a Gulf region — RDS or self-hosted |
| **Service** | Fly.io / Railway container | Container alongside web |
| **Files** | Supabase Storage | S3-compatible, same region |

The pilot is explicitly *"a copy of their data in a private environment"* (`Pilot §3.2`), so it carries no residency obligation and should optimise for setup speed. Release One carries `NFR-12` (Gulf region, with ministry-contract obligations considered) and `NFR-17` (their cloud account, no lock-in).

**What makes that move cheap:** Drizzle over a plain Postgres connection rather than PostgREST; auth in our own tables; storage behind a port. No Supabase-specific API appears in application code. The migration is a connection string, a storage adapter and a DNS change.

---

## 4. Repository layout

```
packages/
  core/               pure domain. imports nothing. no I/O, no DB, no framework.
    money.ts          currency-aware decimal arithmetic
    chargeable.ts     volumetric divisors, break points, minimums
    rating.ts         rate basis per mode, accessorial calculation, margin rules
    clocks.ts         free-time accrual, SLA ageing, working calendars
    states.ts         allowed transitions for enquiry, job, customs, invoice

  db/                 the only place a field is defined
    schema/           drizzle tables
    policies/         RLS policies, as migrations
    triggers/         audit trigger, updated_at
    actor.ts          withActor() — the transaction wrapper
    client.ts         pool configuration

apps/
  web/                next.js
    app/
      (ops)/          internal — enquiries, jobs, rates, finance, admin
      (portal)/       customer
      (agent)/        agent and partner
      (public)/       tracking, quote request
    features/<slice>/ schema.ts · queries.ts · actions.ts · ui/
    lib/              session resolution, permission checks, i18n

  service/            fastify
    workers/          one file per job type
    webhooks/         whatsapp · email · fx
    pdf/              templates + chromium renderer
    api/              public read API (FR-AD-05)
```

**One dependency direction:** `core ← db ← {web, service}`. Core never points outward, which is what lets `FR-RT-03`'s worked examples run as millisecond unit tests with no database.

**Slices do not import each other.** Shared logic goes *down* into `core` or `db`, never sideways. Where two slices look similar but represent different concepts — quote lines and invoice lines, customer contacts and agent contacts — they stay separate until a third case proves the pattern is real.

---

## 5. The database as enforcement boundary

This is the load-bearing section. Get it right once and no feature developer thinks about tenancy or audit again.

### 5.1 Connection identity

The application connects as `app_user` — a role with no `BYPASSRLS` and no table ownership. Migrations run as a separate `app_migrator`. This matters: an owner role silently bypasses RLS unless `FORCE` is set, so we set both.

### 5.2 The actor transaction

Every request opens exactly one transaction and stamps the actor into transaction-local settings.

```ts
// packages/db/actor.ts
export async function withActor<T>(actor: Actor, fn: (tx: Tx) => Promise<T>) {
  return db.transaction(async (tx) => {
    await tx.execute(sql`
      select
        set_config('app.principal_id',   ${actor.principalId},            true),
        set_config('app.principal_type', ${actor.type},                   true),
        set_config('app.branch_ids',     ${actor.branchIds.join(',')},    true),
        set_config('app.customer_id',    ${actor.customerId ?? ''},       true),
        set_config('app.partner_id',     ${actor.partnerId  ?? ''},       true),
        set_config('app.ip',             ${actor.ip ?? ''},               true)
    `)
    return fn(tx)
  })
}
```

The third argument to `set_config` — `true` — makes the setting **transaction-local**. That is what makes this safe behind PgBouncer in transaction-pooling mode: the setting cannot survive into another request's use of the same pooled connection. A session-level `SET` would leak, and this is the single most important detail in the file.

There is no un-actored path to the database from request handling. Background workers use `withActor(SYSTEM_ACTOR, …)`, which is itself an auditable principal.

### 5.3 Row-level security

Helper functions read the settings:

```sql
create function app.principal_type() returns text language sql stable as $$
  select nullif(current_setting('app.principal_type', true), '')
$$;

create function app.branch_ids() returns uuid[] language sql stable as $$
  select coalesce(
    string_to_array(nullif(current_setting('app.branch_ids', true), ''), ',')::uuid[],
    '{}'::uuid[])
$$;
```

One policy serves all three user populations:

```sql
alter table jobs enable row level security;
alter table jobs force  row level security;

create policy jobs_scope on jobs using (
  case app.principal_type()
    when 'internal'         then branch_id = any(app.branch_ids())
    when 'customer_contact' then customer_id = app.customer_id()
    when 'agent_contact'    then exists (
      select 1 from job_partners jp
       where jp.job_id = jobs.id and jp.partner_id = app.partner_id())
    else false
  end
);
```

`FR-ID-04` is satisfied literally: an unauthorised request for another branch's job returns **not-found**, because the row is not visible to the query at all — not filtered in the interface.

Around fifteen policies cover the whole system. Tables fall into four scoping shapes: branch-scoped (jobs, enquiries, invoices), group-shared (customers, partners, locations, commodities), config (reference data, read-all / write-admin), and audit (insert-only).

### 5.4 Audit

One trigger function, attached to every business table:

```sql
create table audit_log (
  id           bigserial primary key,
  at           timestamptz not null default now(),
  principal_id uuid,
  table_name   text not null,
  row_id       uuid not null,
  op           text not null,
  before       jsonb,
  after        jsonb,
  branch_id    uuid,
  ip           inet
);

revoke update, delete on audit_log from public, app_user, app_admin;
```

```sql
create function app.audit() returns trigger
language plpgsql security definer as $$
begin
  insert into audit_log (principal_id, table_name, row_id, op, before, after, ip)
  values (
    nullif(current_setting('app.principal_id', true), '')::uuid,
    tg_table_name,
    coalesce(new.id, old.id),
    tg_op,
    case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end,
    case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end,
    nullif(current_setting('app.ip', true), '')::inet
  );
  return coalesce(new, old);
end $$;
```

Attached by a migration that loops over the tracked tables, so adding a table adds its audit automatically.

`FR-AD-01` requires that **no role, including administrator, can edit an audit entry**. Application-level audit logging cannot satisfy that — an administrator with database access edits the row. Revoking `UPDATE`/`DELETE` at the database can. This is why audit is a trigger and not a helper function called from each mutation, and it removes the most likely DRY violation in the codebase: the `audit.log(...)` call someone forgets.

### 5.5 Nothing is deleted

`SRS §7` rule two. Enforced structurally: no business table exposes a delete path. Records carry `superseded_by`, `closed_at` or `is_active`. Users are deactivated (`FR-ID-09`); rate cards are versioned (`FR-RT-08`).

---

## 6. Schema

Sketch, not the full DDL — the shapes that carry the difficult requirements. Every primary key is `uuid primary key default uuidv7()`; every timestamp is `timestamptz`; every amount is `numeric`.

### 6.1 Tenancy and identity

```
branches            id · code · legal_name_en · legal_name_ar · country
                    base_currency · tax_registration · invoice_series
                    letterhead_asset_id · calendar_id
principals          id · type(internal|customer_contact|agent_contact)
                    auth_user_id · email · name_en · name_ar · locale
                    customer_id? · partner_id? · is_active
roles               id · key · name_en · name_ar
role_permissions    role_id · permission_key · allowed        ← FR-ID-03, editable
principal_branch_roles  principal_id · branch_id · role_id    ← FR-ID-02, role per branch
```

`principal_branch_roles` is the composite that `FR-ID-02` requires — a user holds a *different role in each branch*, not one global role. No hosted auth provider models this, which is why authorization stays in our tables.

### 6.2 Commercial

```
customers           id · legal_name_en · legal_name_ar · registration · tax_reg
                    (group-level — FR-MD-01)
customer_branch_terms  customer_id · branch_id · payment_terms · credit_limit
                       free_time_days · default_incoterm   ← per-branch beneath one record
partners            id · type(agent|haulier|carrier) · country · currency
partner_coverage    partner_id · mode · origin · destination      ← drives RFQ routing
partner_compliance  partner_id · doc_type · asset_id · issued · expires
rate_cards          id · direction(buy|sell) · partner_id? · customer_id?
                    mode · origin · destination · validity daterange
                    version · superseded_by
rate_card_lines     rate_card_id · charge_type_id · basis · rate · currency · minimum
```

Validity is a `daterange` rather than a pair of loose date columns, which lets the database refuse overlapping versions outright:

```sql
create extension if not exists btree_gist;

alter table rate_cards add constraint rate_cards_no_overlap
  unique (direction, partner_id, customer_id, mode, origin, destination,
          validity without overlaps);
```

`FR-RT-01` requires that only cards valid on the enquiry's ready date are considered, and `FR-RT-08` requires editing to create a new version rather than mutate the old one. Two overlapping cards for the same lane make "the valid rate" ambiguous — a pricing bug that surfaces as a wrong quote weeks later. This makes it unrepresentable rather than merely unlikely.

### 6.3 The job spine

```
enquiries    id · branch_id · customer_id · owner_id · status · channel
             sla_started_at · sla_due_at
quotes       id · enquiry_id · version · status · valid_until
             priced_snapshot jsonb        ← SRS §7 rule one
             rate_card_version_id         ← lineage, for reporting only
jobs         id · branch_id · customer_id · quote_id · reference · mode · status
job_milestones   job_id · code · planned · revised · actual · owner_role
                 customer_visible
customs_stages   job_id · declaration_type · declaration_no · filed_at
                 duty_amount · inspection · released_at
equipment        job_id · container_no · type · seal · gate_out · gate_in
free_time_clocks equipment_id · kind · free_days · starts_on · per_diem
                 currency · counterparty · accrued_days · charge_line_id
exceptions       job_id · code · severity · owner_id · opened_at · closed_at
                 customer_visible · cost_impact
documents        job_id · doc_type · version · asset_id · released_at · author_id
charge_lines     job_id · direction(cost|revenue) · charge_type_id
                 amount numeric(19,6) · currency · fx_rate numeric(19,8)
                 fx_rate_at · counterparty_id · invoice_id?
invoices         id · branch_id · customer_id · series_no · currency
                 tax_treatment · language · issued_at
messages         id · job_id? · enquiry_id? · channel · direction · body
                 external_ref · delivered_at · read_at
```

**The snapshot rule, concretely.** `quotes.priced_snapshot` stores the resolved rate lines, divisors, accessorials, FX rate and margin as they stood at pricing time. `rate_card_version_id` is kept for lineage but is never read to reprice. A rate change tomorrow cannot rewrite what was quoted yesterday (`FR-RT-08`), and an invoice raised in June still reconciles to a March booking (`FR-RT-06`).

**Every charge line stores its own FX rate and the timestamp it was taken.** `FR-RT-06` requires a USD-priced quote invoiced in KWD to reconcile months later; that is only possible if the rate is on the row rather than looked up.

### 6.4 Why PostgreSQL 18

Released September 2025, on 18.6 as of August 2026, and supported by Aurora and RDS in all commercial regions since June 2026. Four of its additions are used directly here rather than incidentally:

| Feature | Used for |
|---|---|
| **`uuidv7()`** | Default for every primary key. Time-ordered UUIDs insert sequentially into B-tree indexes instead of scattering, which removes the write amplification and index bloat that UUIDv4 causes on the write-heavy tables — `job_milestones`, `charge_lines`, `messages`, `audit_log`. |
| **Temporal `WITHOUT OVERLAPS` constraints** | Rate card validity, as above. Achievable before 18 with a hand-rolled GiST exclusion constraint; 18 makes it standard SQL and adds temporal foreign keys. |
| **B-tree skip scan** | The coverage lookup index (`FR-RT-10`), where queries do not always constrain the leading column. Directly serves the two-second budget. |
| **`RETURNING OLD.*` / `NEW.*`** | Returning prior state on an update without a second round trip — useful in the state-transition paths, where the previous status is needed for the response. |

Asynchronous I/O and retained optimizer statistics across major upgrades come along for free; neither is decisive at this data volume, but the upgrade-statistics change materially shortens the maintenance window in `NFR-06`.

**Not 19.** Beta 3 as of August 2026, with general availability expected September or October — inside the sixteen-week build. Nothing in 19 is load-bearing here, and a major version that lands mid-delivery is risk without return. Plan to move after hypercare, not during it.

**Not 16 or 17.** Both are supported and would work. 18 costs nothing extra and provides `uuidv7()` and temporal constraints, which are the two features this schema would otherwise hand-roll.

---

## 7. The engines

The SRS appears to demand dozens of implementations. It does not. Each engine below is one piece of code driven by configuration rows — which is both the leanest build and what `FR-AD-03` requires.

| Appears to be | Is actually | Requirement |
|---|---|---|
| ~18 accessorial types | 6 calculation functions + 18 rows | `FR-RT-05` |
| Milestone sets per mode | 1 template engine + template rows | `FR-JB-01…05` |
| Demurrage, detention, storage | 1 clock + 3 config rows | `PP-07`, `FR-JB-08` |
| Enquiry SLA, customs SLA, exception ageing | 1 working-calendar duration function | `NFR-03` |
| 9 events × 3 channels × 2 languages | 1 dispatcher + 3 adapters + template rows | `FR-NT-01…03` |
| 5 entities × tax and numbering rules | 1 invoice model + branch config rows | `FR-ID-01`, `FR-FN` |

### 7.1 Charge calculation

```ts
type Basis = 'flat' | 'per_unit' | 'per_kg' | 'per_container' | 'per_day' | 'percent'

export function calcCharge(
  line: { basis: Basis; rate: Decimal; minimum?: Decimal; currency: Currency },
  ctx:  { units?: number; kg?: Decimal; containers?: number; days?: number; of?: Decimal },
): Money
```

Six branches. The catalogue in `FR-RT-05` — terminal handling, documentation, fuel, security, clearance, delivery order, haulage, DG, out-of-gauge, reefer, inspection, legalisation, permit, insurance, demurrage, detention, storage — is seed rows against these six, each with its own currency and minimum. A new accessorial in 2027 is an admin screen entry, not a release.

### 7.2 Free-time clocks

Demurrage, detention and storage differ only in what starts them, who they are owed to and what they cost per day. One engine:

```ts
export function accrue(
  cfg:      { kind: ClockKind; freeDays: number; perDiem: Decimal; currency: Currency },
  window:   { startedOn: Date; endedOn: Date | null },
  calendar: WorkingCalendar,
  asOf:     Date,
): { chargeableDays: number; amount: Money }
```

Run nightly per open clock. Where `chargeableDays > 0` it writes a `charge_line` — which is commitment three in `SRS §4.2` ("every cost-bearing event writes a line") implemented as a scheduled pure function rather than an operator's memory.

### 7.3 Milestones

`milestone_templates(mode, service_type, seq, code, name_en, name_ar, owner_role, customer_visible)`. Job creation instantiates the matching template set into `job_milestones`. The four flows in `Freight_Domain_Primer §9–10` — sea import, sea export, air, land — are four sets of rows against one engine. `states.ts` holds the allowed transitions; illegal transitions are rejected in `core`, not in the UI.

### 7.4 Notifications

One dispatcher, driven by `notification_templates(event_key, channel, lang, branch_id?)`:

```
domain event → outbox row (same transaction) → pg-boss → dispatcher
   → resolve recipients (role rules + customer preferences + opt-outs)
   → resolve template (event × channel × language × branch)
   → adapter.send() → delivery record
```

Three adapters implement one two-method port. Adding a channel later is one adapter and a column value. `FR-NT-06`'s delivery states and `FR-NT-07`'s quiet hours live in the dispatcher, once — not in nine event handlers.

---

## 8. Identity and access

**Better Auth, core surface only** — email/password and TOTP. Sessions are database-backed and opaque, never stateless JWTs, because `FR-ID-08` requires revocation to take effect *on the next request* and `FR-MD-03` requires revoked portal access to block sign-in *at once*. The per-request session lookup costs nothing extra: it happens inside the same transaction that sets the RLS context.

**Explicitly not enabled:** the SSO, SCIM, OIDC/OAuth-provider, MCP and Stripe plugins. Release One needs none of them, and they carry the whole of the library's 2026 advisory history. The api-key plugin is also excluded — `FR-AD-05` keys are written directly (prefix, hash, scope, revoke, ~100 lines) rather than importing a plugin whose authorization logic has been wrong before.

The one core-adjacent advisory — pre-account hijacking via magic-link and email-OTP — has no entry point here: `FR-ID-07` makes the product invitation-only and there is no open registration or magic-link flow.

**Layering:**

| Layer | Owner | Enforces |
|---|---|---|
| Credentials, sessions, TOTP | Better Auth (`auth_*` tables) | `FR-ID-05…08` |
| Principal, branches, roles | Our tables | `FR-ID-02`, `FR-ID-09` |
| Permission matrix | `role_permissions`, editable | `FR-ID-03` |
| Row visibility | Postgres RLS | `FR-ID-04`, `NFR-09` |

Authorization never enters the auth library, which keeps it replaceable in days. Mandatory 2FA for Administrator and Finance (`FR-ID-06`) is checked at **session establishment**, not only at enrolment — otherwise a session predating the policy survives it.

Three credential types, kept separate: user sessions; per-customer API keys (`FR-AD-05`, read-only, scoped); and public tracking (`FR-CP-05`), which is unauthenticated by design and therefore needs a second identifier plus rate limiting — an enumeration control, not a session.

---

## 9. Background work

Everything below runs in `apps/service` on pg-boss. Jobs enqueue inside the business transaction, so a job never exists for a write that rolled back.

| Job | Trigger | Requirement |
|---|---|---|
| Inbound mail poll → enquiry | Every minute | `FR-EQ-02` — IMAP over the branch mailboxes, attachments preserved |
| Inbound email → enquiry | Webhook | `FR-EQ-02` — the provider half; the route verifies and enqueues, the conversion is unbuilt |
| Inbound WhatsApp → job thread | Webhook | `FR-NT-05` |
| Notification dispatch | Outbox | `FR-NT-01…07` |
| PDF render — quote, invoice, DO, job pack | On demand | `§8`, bilingual, per-entity letterhead |
| Free-time accrual | Nightly | `FR-JB-08` |
| SLA escalation | Every 15 min | `FR-EQ-01` |
| Compliance expiry warnings — 60/30/7 days | Nightly | `FR-MD-05` |
| Rate card expiry digest | Nightly | `FR-RT-11` |
| FX rate ingest | Daily | `§8` |
| Bulk import validation | On upload | `FR-MD-11`, `FR-RT-09` — validate wholly, then commit |
| Outbound webhook delivery | Event | `FR-AD-06` — retry with backoff, delivery log |
| Scheduled reports | Daily / weekly | `FR-RP-07` |

Bulk import runs as a job precisely because `FR-MD-11` requires that a file with errors **imports nothing** and returns a row-by-row report: validate the whole file, report, then commit in one transaction on confirmation.

---

## 10. Integrations and ports

Eight interfaces in the entire system. Each has a real first implementation today and a named second one in the SRS.

| Port | R1 implementation | Named second | Source |
|---|---|---|---|
| `NotificationChannel` | email · WhatsApp · in-app | further channels | `FR-NT-02` |
| `FileStore` | Supabase Storage | S3 | pilot → R1 move |
| `AuthProvider` | Better Auth | replaceable | `§8` |
| `FxRateSource` | daily feed + manual override | provider change | `§8` |
| `CarrierTracking` | manual milestone entry | carrier-direct (DCSA) | `§8`, R2 |
| `CustomsFiling` | manual reference capture | Kuwait Single Window | `§8`, R2 |
| `EInvoiceTransmit` | compliant data, no transmission | accredited provider | `§8`, R2 |
| `InboundMailSource` | IMAP poll of the mailboxes in `mailboxes` | provider webhook (Resend · Postmark · SES) | `FR-EQ-02`, `§9` |

The last three of the original seven are not speculative: R1 has a genuine first implementation (manual capture), and `SRS §8` states the intent that R2's connection be *"a plug, not a rebuild."* Everything else in the system is concrete.

`InboundMailSource` is the eighth and it was added rather than assumed. Al-Qabandi's front door is five mailboxes — `SRS §3` calls that *"the single most telling finding"* — so the first implementation reads those five over IMAP rather than asking anybody to move: no MX change, no new vendor, and the existing mail host's spam filtering inherited for free. The named second is the provider webhook `§9` already lists as an integration, and the route for it exists. Both produce the same `InboundMessage`, which is the point: `FR-EQ-02`'s rules about what becomes an enquiry, what threads onto a job, and which sender may be identified as a customer are the hard part, and they are written once.

**Which mailboxes, and the one thing that stayed in the environment.** The mailbox list is `mailboxes` rows edited at Settings → Mailboxes, not configuration — `FR-AD-03` again, and the difference between onboarding an office in a minute and onboarding it in a sprint. The exception is `MAILBOX_ENCRYPTION_KEY`, which seals the passwords on those rows with AES-256-GCM. It stays in the environment deliberately: `mailboxes` is in every backup, restore drill and replica, and a key stored beside the ciphertext it protects is encoding rather than encryption. The database enforces the shape with a check constraint, so a plaintext password cannot be written by a script, a seed, or a fix applied against `psql` at 2am — the failure mode that would otherwise work perfectly and be invisible until somebody read a dump.

**Where a deployment is wired up, and why it is not the environment.** Every port above was configured by environment variable, and therefore by redeploy, until `integration_settings` existed. That is the wrong shape for what these actually are: the SMTP relay, the Maersk registration, the e-invoice provider and the WhatsApp number are all the *client's* to provision (`IN-06`, Discovery Q5), so each one arriving blocked on whoever held the deploy keys rather than on whoever held the credential. They are rows now, edited at Settings → Integrations, with credentials sealed under the same `MAILBOX_ENCRYPTION_KEY` and the same `v1:` check constraint as a mailbox password.

Three properties make that safe to have done:

- **The environment is still the fallback, never replaced.** A row wins; the variable answers when there is none. A deployment that configures nothing on the screen behaves exactly as it did before the table existed, which is what makes the change additive for an installed fleet — and it is also the bootstrap, because `SMTP_*` has to work before anybody can sign in to change `SMTP_*`.
- **The two layers fail differently, deliberately.** An invalid *variable* still stops the service at boot, exactly as `§10`'s resolvers always did. An invalid *row* must not: refusing to resolve would take out the settings screen along with the mistake, leaving a deployment recoverable only through `psql`. So a bad row degrades to the Release One driver, records the reason on itself, and the screen shows it red — the same shape `mailboxes.last_error` already uses, against a worse failure, because a carrier key that stops working produces no empty queue to notice, only a board of shipments that have not moved.
- **The permission is the whole of the scoping.** `integration_settings` has no `branch_id`, because there is no such thing as a Kuwait-only SMTP relay: one row is the relay every branch sends through. So the policy conditions on `admin.integrations.write` rather than on the branch list every other configuration table narrows by — the only table in the schema where that is the right answer.

Three settings moved *out* of the environment without becoming integration rows, because they belong to something that already had a row: `INBOUND_MAIL_BATCH` and `INBOUND_MAIL_MAX_ATTACHMENT_MB` are columns on the mailbox they tune, `FX_QUOTE_CURRENCIES` is `currencies.is_tracked`, and `FR-NT-07`'s quiet hours — which were not even variables, but constants in the dispatcher — are columns on `branches`, whose `time_zone` the comparison was already made in.

`CarrierTracking` is the first of the three to have the plug fitted, and it is the argument for the rule. Three implementations have sat behind it — manual entry, an aggregator that pushed events at a webhook, and the carriers themselves answering a poll. Fitting the third changed one signature (`poll` takes a query rather than a bare string, because DCSA has three reference parameters and a string cannot say which one it is); *removing* the aggregator, once carrier-direct proved cheaper and honest about what it knows, took a driver row, a route and a worker, and nothing outside `adapters/` and the poll worker had to be told.

**Outbound public surfaces:** the read-only REST API (`FR-AD-05`) and webhooks (`FR-AD-06`) are served from `apps/service`, share the Zod schemas generated from the Drizzle tables, and are versioned from day one.

---

## 11. Money, language and time

Three areas where a wrong default is expensive to unwind, so they are settled before the first feature.

**Money.** Amounts are `numeric(19,6)`; FX rates `numeric(19,8)`. Never floats, never JS `number` for amounts. A `currencies` table carries `minor_units` — KWD 3, AED/QAR/USD 2 — and rounding happens per currency at the invoice line, never globally (`NFR-02`). `core/money.ts` is the only place arithmetic happens.

**Language.** Bilingual from the first commit, not from R1.3. `dir` set on `<html>`; CSS logical properties throughout (`margin-inline-start`, never `margin-left`); every string through `next-intl`; Arabic and English name columns on every entity a document renders. `SRS §10.2` already argues that retrofitting RTL produces a worse result — the corollary is that R1.3 must be a *translation and review* gate, not a rebuild. PDF templates are the same HTML pipeline, so RTL is solved once for screen and document.

**Time.** All timestamps `timestamptz`, stored UTC. Working calendars are per branch (`NFR-03`) — Kuwait, Qatar and the UAE share neither a weekend nor a holiday list — and every SLA, ageing and free-time calculation goes through `core/clocks.ts`. Hijri dates are a display concern in the Arabic locale (`NFR-04`), never stored.

---

## 12. Performance

`NFR-05` sets three budgets. None require caching infrastructure at Al-Qabandi's volume; all three are index and query-shape problems.

| Budget | Approach |
|---|---|
| Coverage lookup < 2s (`FR-RT-10`) | Composite B-tree on `(mode, origin, destination)` plus GiST on `validity`; v18 skip scan covers queries that leave the leading column unconstrained. Ranking in SQL, not in Node |
| Instant quote < 10s (`FR-EQ-05`) | Lookup + pure calculation. No I/O beyond the single query. Realistically well under 1s |
| Lists and job screens < 2s | Keyset pagination, RSC streaming, no N+1 — Drizzle relational queries |

`NFR-07` asks for five years of headroom. At five offices this is comfortably a single Postgres instance; partitioning `audit_log` by month is the only measure anticipated, and only when it earns it.

---

## 13. Environments, delivery and handover

**Two environments** — staging and production (`FR-AD-07`), identical in shape, production released from tagged commits only. Migrations are forward-only, versioned in the repository, applied by `app_migrator` in CI.

**Pipeline:** typecheck → lint → `core` unit tests → RLS policy tests → Playwright flows → migration dry-run → deploy. RLS policy tests are non-negotiable: they are the enforcement mechanism for `FR-ID-04` and `NFR-09`, and an untested policy is an untested access control.

**Handover (`NFR-17`, `NFR-18`).** The client's repository, the client's cloud account, no supplier-hosted component in the runtime path. The runbook covers backup and restore drills (`NFR-11`), monitoring and alerting, the migration procedure — and one obligation worth naming explicitly in the hypercare knowledge transfer: **dependency patching, specifically subscription to Better Auth security advisories.** Self-hosting auth trades a subscription fee for a patching duty, and after handover that duty is Al-Qabandi's. Better it appears in the runbook than in an incident.

---

## 14. Decisions to confirm in discovery

| # | Question | Blocks | Why it matters |
|---|---|---|---|
| 1 | Which cloud and which region? Does any ministry contract constrain data residency? | Hosting, `NFR-12` | Their MoD track record makes this a real constraint, not a formality. Decides whether managed services are available at all, and whether PostgreSQL 18 is offered there — Aurora and RDS carry it in all commercial regions; other providers should be checked before committing. |
| 2 | Is there any customer who will require SSO into the portal? | `§8` | Nothing in the SRS asks for it. If one appears, federation is added on top of `principals` — worth knowing before, not after. |
| 3 | Which accounting package? | `FR-FN` export format | R1 exports a file; the shape depends on the answer. |
| 4 | Expected volumes — enquiries/day, jobs/month, documents/job | `NFR-07` sizing | Everything here assumes hundreds/day. An order of magnitude more changes the queue and index strategy, nothing else. |
| 5 | WhatsApp Business API account ownership and template approval timeline | `FR-NT` | Provisioning is the long pole and is Al-Qabandi's to start. |
| 6 | Who owns dependency patching after handover? | `§13` | Named person, not a team. |

---

## 15. Traceability

| Requirement | Mechanism | Section |
|---|---|---|
| `FR-ID-02` role per branch | `principal_branch_roles` composite | [6.1](#61-tenancy-and-identity) |
| `FR-ID-03` editable permission matrix | `role_permissions` rows | [8](#8-identity-and-access) |
| `FR-ID-04` · `NFR-09` row-level scoping | Postgres RLS + `FORCE`, non-bypass role | [5.3](#53-row-level-security) |
| `FR-ID-08` immediate revocation | DB-backed opaque sessions | [8](#8-identity-and-access) |
| `FR-RT-06` FX reconciliation | Rate stored per charge line | [6.3](#63-the-job-spine) |
| `FR-RT-08` · `SRS §7` snapshots | `quotes.priced_snapshot` jsonb | [6.3](#63-the-job-spine) |
| `FR-AD-01` immutable audit | Trigger + revoked `UPDATE`/`DELETE` | [5.4](#54-audit) |
| `FR-AD-03` configurable reference data | Config rows driving all engines | [7](#7-the-engines) |
| `FR-NT-06` delivery states, retry | Outbox + pg-boss + delivery record | [7.4](#74-notifications) |
| `NFR-01` native RTL | Logical properties, shared HTML→PDF pipeline | [11](#11-money-language-and-time) |
| `NFR-02` KWD three decimals | `numeric`, per-currency `minor_units` | [11](#11-money-language-and-time) |
| `NFR-03` per-branch calendars | `core/clocks.ts`, calendar per branch | [11](#11-money-language-and-time) |
| `NFR-17` no lock-in | Portable Postgres, ports at every vendor edge | [3.1](#31-hosting--pilot-and-release-one-differ-deliberately) |

---

*Document ends. Architecture v1.0 · Release One · techpotions · August 2026 · Internal. Specification: `Qabandi_Release_One_SRS.md`. Pilot scope: `Qabandi_Pilot_15_Day.md`. Domain: `Freight_Domain_Primer.md`.*
