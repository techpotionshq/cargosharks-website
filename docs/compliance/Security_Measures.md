# Technical and organisational measures

*The annex a data-processing addendum points at, and the sheet a buyer's
security reviewer reads first.*

Last verified against the build: **2026-10-02**. Every count in section 1 is
read from a live database by `pnpm test:db`, not maintained by hand — see
"How the numbers are produced" at the foot.

This document states what the software does. It does **not** state what the
operator does, because that is a separate set of commitments and pretending
otherwise is how a measures annex becomes untrue between signature and audit.
Section 6 lists what is missing, deliberately and in full.

---

## 1. Access control and tenant separation

| Measure | How | Where |
| --- | --- | --- |
| Separation enforced by the database | Row-level security, `ENABLE` **and** `FORCE`, on 88 of 94 tables. 225 policies. Reading a table and writing it are separate policies where the two differ: a principal can read its own grants but writing one needs `admin.users.write` in that branch, and a trigger refuses changes to a principal's own type, customer, partner or credential link. | `migrations/0004_rls.sql`, `0050_fix_pass_policies.sql` |
| No unscoped path to data | `db` is not exported for query use. Every read opens one transaction through `withActor`, which stamps the principal into transaction-local settings the policies read. | `packages/db/src/actor.ts` |
| Safe under connection pooling | `set_config(..., true)` makes each setting transaction-local, so a pooled connection cannot carry one tenant's identity into the next request. | `actor.ts` |
| Least privilege at the role level | The application connects as `app_user`: `NOBYPASSRLS`, owns nothing, and `DELETE` is revoked. Migrations run as a separate `app_migrator`. | `migrations/01-roles.sql` |
| Unauthorised access returns *not found* | The row is not visible to the query, so there is no "forbidden" to probe. | FR-ID-04 |
| Permission checks in the application as well | Defence in depth: 39 enforced permission keys, checked **per branch** — the session carries each branch's permissions separately, and an action on a record asks for the permission in that record's branch (`assertCanIn`), so a finance grant in one branch does not reach another's invoices. Neither layer is trusted alone. | `apps/web/src/lib/permissions.ts`, `scripts/check-permissions.mjs` |

The six tables without row-level security are the five `auth_*` credential
tables and `inbound_webhook_events`, which holds provider delivery receipts for
deduplication and no business data. `audit_log` has row-level security: reading
it needs `admin.audit.read`, which only Administrator holds. Nine tables carry
no audit trigger — the five `auth_*` tables, because a trigger over credential
rows would copy secrets into the log; `audit_log` and `support_access_log`,
because a trigger on them would recurse; `inbound_webhook_events`; and
`vessel_positions`, AIS telemetry rewritten every few minutes per vessel, whose
audited fact is the vessel recorded on the job (it keeps row-level security,
scoped through `jobs`). Each
exclusion is declared with its reason in `packages/db/src/schema/` and recorded
in the migrations.

## 2. Authentication

| Measure | Detail |
| --- | --- |
| Passwords | Minimum twelve characters. Hashed by Better Auth; never stored or logged in clear. |
| Registration | Closed. Invitation only — there is no public sign-up form and no magic-link flow. Inviting a colleague, or a customer contact to the portal, creates the login and mails a one-hour link to set the first password, through the same reset flow; the administrator never sets or sees it. The people list shows who has not set a password yet. |
| Sessions | Database-backed and opaque. Never a stateless JWT, so revocation takes effect on the **next request**. Twelve-hour expiry. Signing out deletes the session row, not only the cookie. |
| Second factor | TOTP, mandatory for roles that carry `requires_two_factor` (Administrator, Finance). Enforced in both internal shells; an unenrolled principal cannot reach any screen. The challenge accepts a backup code as well as a TOTP code, so a lost phone is recoverable without an administrator. |
| Sign-in lockout | Five failed attempts, none more than thirty minutes after the last, lock the account for fifteen minutes. The lock lifts by itself, so it cannot be used to deny service to a named person. Enforced in Better Auth's own request hooks, so it holds for its raw `/api/auth` endpoints as well as for the sign-in form. |
| Rate limiting | Ten sign-in attempts per address per fifteen minutes, counting every attempt rather than only failures. Password-reset requests: ten per address per fifteen minutes and three per email per hour. Better Auth's built-in limiter runs as well in production. These budgets are kept in process memory, so a restart resets them; the lockout, which is stored, is the persistent control. |
| Client address | Taken from `X-Forwarded-For` as the entry `TRUSTED_PROXY_HOPS` places from the right (default 1, the shipped Traefik), never the leftmost entry a caller can write. The web proxy hands that address to Better Auth in a header it overwrites on every request, so the throttles, Better Auth's limiter, session rows and the audit trail all see the same address. |
| Account enumeration | One message for "no such user" and "wrong password". The password-reset form answers identically whether or not the address exists. |
| Reset links | One hour. A reset revokes the account's sessions. |

## 2.1 Transport to the database

`DATABASE_SSL` selects `disable`, `require` or `verify-full`; the last verifies the server certificate against `DATABASE_CA_CERT`. An `sslmode=` already present in the connection string wins outright, because silently replacing an operator's explicit parameter is how a secure-by-default flag ends up downgrading a connection somebody had already secured.

Left unset, the process starts anywhere the packets never leave the machine and **refuses to start in production against a remote host**. That refusal is the substance of the control: the previous behaviour was to connect in clear across a network and say nothing. `packages/db/src/client.ts`, nine tests in `packages/db/test/tls.test.ts`.

## 3. Audit and accountability

- **Audit is a trigger, not a convention.** 85 triggers. The first set was
  attached by a loop over every base table; a table added later is attached in
  its own migration, and `pnpm test:db` fails the build for any business table
  that has no trigger.
- **Nothing is deleted.** `superseded_by` / `closed_at` / `is_active`. `DELETE`
  is revoked from the application role, so immutability is a grant rather than
  a habit.
- **Background work is an attributable principal**, not an absence of one —
  every nightly accrual and notification is recorded against a system principal.
- **Vendor support access is granted, time-boxed, revocable and logged.** The
  customer writes the grant; expiry is checked inside the policy rather than by
  a cleanup job. A grant is read-only unless the customer deliberately gives it
  `write` scope, and even then support principals can only update rows in
  branch-scoped tables the grant reaches — no policy admits an insert, and
  `DELETE` is revoked from the role. One access-log row is written per
  transaction opened, inside that transaction, so an access that did not happen
  leaves no entry. A banner shows the customer a support session is open
  without them having to go and look.
- **Integrations are scoped.** A webhook endpoint or API key with no branch
  receives every branch's events, so creating or changing one needs
  `admin.api_keys.write` in every active branch — in the action and in the
  write policies on `webhook_endpoints` and `api_keys`. A public-API key acts as
  its own principal, which holds no grant, and the API returns a fixed
  projection rather than whole rows.

## 4. Application security

| Header | Value |
| --- | --- |
| `Content-Security-Policy` | Per-request nonce, `strict-dynamic`, no `unsafe-inline` on scripts. Four external origins, each justified in source. |
| `Strict-Transport-Security` | `max-age=63072000; includeSubDomains`. `preload` is deliberately **not** set — see the note in `proxy.ts`. |
| `X-Frame-Options` / `frame-ancestors` | `DENY` / `'none'` |
| `X-Content-Type-Options` | `nosniff` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `Permissions-Policy` | Everything denied except camera and geolocation, which proof of delivery needs. |
| `Cross-Origin-Opener-Policy` | `same-origin` |

Set in `apps/web/src/proxy.ts`. The Fastify service registers `@fastify/helmet`
and a 120-request-per-minute limit.

Other measures: mailbox passwords are sealed with AES-256-GCM under a key held
in the environment rather than in the database, and a check constraint refuses
a plaintext password — so a seed, a script or a 2am `psql` fix cannot write one.
Server Actions are the only mutation path. Money is `numeric(19,6)` end to end,
never a float.

## 5. Development and supply chain

- CI runs on every commit: formatting, lint, eight repository invariants, types,
  domain engines, migrations and the RLS policy matrix on real PostgreSQL 18,
  end-to-end coverage of every screen in both languages, and a production build.
- The RLS suite connects as `app_user` — not as the owner — so it cannot pass
  while proving nothing.
- Supply chain, on every change **and** every Monday: dependency advisories,
  a verified-secret sweep over full git history, container image scanning, and
  Semgrep static analysis. An SBOM is produced on every run and retained 90 days.
- Dependabot opens the pull requests that close what the advisory job finds.

## 6. What is *not* in place

Listed rather than omitted. A reviewer who finds these unaided discounts
everything above.

| Gap | Status |
| --- | --- |
| **TLS to the database is a deployment setting, not a guarantee.** `DATABASE_SSL` takes `disable`, `require` or `verify-full`, and in production against a non-local host the process refuses to start until one of them is chosen — so an unencrypted link is now a recorded decision rather than an accident. What this section cannot tell a reviewer is which value a given deployment picked; ask for it. Web-to-service traffic remains plain HTTP on a private network, by design. | **Closed in the build, open per deployment** |
| **Encryption at rest is not established.** It is a property of the host, and the host is not chosen. | Open — blocked on the hosting decision |
| **No independent security testing.** No penetration test, no SOC 2, no ISO 27001. The figures above are verified by our own tests, which is verification and not attestation. | Open |
| **Audit export is built; one half of the search is not.** The screen searches by record id, person and address across a table, an operation and a period, and `/api/audit.csv` exports the same query under the same row-level security. `FR-AD-02` also asks for search *by job*, and `row_id` holds the job's id rather than its reference — so a reference pasted from a document finds nothing until it is resolved to an id first. | **Export closed 2026-08-25**; reference lookup open |
| **No data-erasure mechanism.** "Nothing is deleted" is a design principle, and it collides with erasure rights. There is no supervised redaction path. | Open — legal decision first |
| **Retention periods are not set** for business records, audit entries, logs, object storage or backups. | Open — legal decision first |
| **Monitoring is instrumented but not operating.** Spans are opened per transaction and both applications register an exporter; without `OTEL_EXPORTER_OTLP_ENDPOINT` all of it degrades to no-ops. No collector is chosen, and there is no alerting on top of whatever one is. | Open — operator commitment |
| **HSTS is not preloaded**, and subdomains of a customer's own domain are therefore not protected before first contact. | Deliberate — see `proxy.ts` |
| **Backups are tooling, not a schedule.** `fleet:backup` and `fleet:restore-drill` exist; NFR-11's daily/weekly cadence and quarterly signed-off drill are not operating. | Open — operator commitment |
| **No formal access review cadence**, no documented RTO/RPO, no security awareness training record. | Open — operator commitment |

## How the numbers are produced

Counted against a freshly migrated and seeded database (migrations through
`0066`), 2026-10-05:

```sql
select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relkind = 'r';                    -- 94
select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relkind = 'r'
   and c.relrowsecurity and c.relforcerowsecurity;                  -- 88
select count(*) from pg_policies where schemaname = 'public';       -- 225
select count(*) from pg_trigger
 where tgname like '%\_audit' and not tgisinternal;                 -- 85
```

The permission count is `node scripts/check-permissions.mjs` ("39 enforced
keys, all declared"). `pnpm test:db` asserts that every business table has row-level security enabled
*and* forced and an audit trigger attached, walking the table registry in
`packages/db/src/schema/table.ts`. A table that nobody remembered to protect
fails the build rather than shipping.

## Related

- [`Sub_Processors.md`](Sub_Processors.md) — who else touches the data
- [`Incident_Response.md`](Incident_Response.md) — what happens when this fails
- [`ROPA.md`](ROPA.md) — what is processed, and why
- [`Decisions_Required.md`](Decisions_Required.md) — the 57 open questions
