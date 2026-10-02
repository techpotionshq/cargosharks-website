# Compliance

*What a buyer's security reviewer asks for, answered from the build rather than
from a template.*

Everything here is **self-assessed**. There is no audit, no certificate and no
independent testing behind any of it, and each document says so in its own
words rather than leaving it to be discovered. That honesty is the point: a
reviewer who finds an unstated gap discounts everything stated.

| Document | What it answers | Audience |
| --- | --- | --- |
| [`Security_Measures.md`](Security_Measures.md) | What the software actually does, and what it does not | The annex a DPA points at; the first thing a reviewer reads |
| [`CAIQ.md`](CAIQ.md) | The CSA questionnaire, 69 controls | Enterprise procurement |
| [`ROPA.md`](ROPA.md) | What personal data is held, why, and on whose instruction | Counsel, regulators |
| [`Sub_Processors.md`](Sub_Processors.md) | Who else can see the data | Customers, DPA schedules |
| [`Incident_Response.md`](Incident_Response.md) | What happens when it goes wrong, and who decides | Everyone, at 02:00 |
| [`Decisions_Required.md`](Decisions_Required.md) | The 57 open questions in the legal pages | The operator and counsel |

The customer-facing versions of some of this are published on the marketing
site — `apps/landing/src/content/pages/{privacy,dpa,terms}.tsx` — and the
security contact is at `/.well-known/security.txt`.

## Where this stands

**Strong**, and unusually so for the stage: tenancy enforced by the database
rather than by application code (83 of 89 tables with row-level security
enabled *and* forced, 205 policies); audit written by 81 triggers, and a build
that fails for any business table without one; `DELETE` revoked from the
application role; vendor support access granted by the customer, time-boxed,
read-only unless the customer grants write scope, and logged per transaction;
permissions checked per branch in the application as well as by policy; six CI jobs including the policy matrix run as the
unprivileged role; and, as of 2026-08-25, a nonce-based content-security policy,
enforced two-factor for Administrator and Finance, sign-in lockout, and weekly
supply-chain scanning. Since then (re-verified 2026-10-02): the lockout and
throttles are enforced inside Better Auth itself, every throttle and Better
Auth's own limiter read the client address from the trusted proxy hops rather
than the caller-written leftmost `X-Forwarded-For` entry, sign-out and password
reset end sessions, backup codes work at the two-factor challenge, invitations
create a real login with an emailed set-password link, and an all-branch
webhook or API key needs the administrator's permission in every branch.

**Missing**, and named in full in `Security_Measures.md` §6: any independent
attestation, encryption at rest, a monitoring backend and alerting on top of it,
retention periods, and a data-erasure mechanism.

Two items left that list on 25 August 2026. **Audit export** is built, and most
of the search with it — the screen searches by record id, person and address
across a table, an operation and a period, and `/api/audit.csv` exports the same
query under the same row-level security (`NFR-10`). `FR-AD-02` is not fully met:
it also asks for search by job, and the trigger records a job's id rather than
its reference, so a reference pasted from a document finds nothing yet. **TLS to
the database** is now chosen by
`DATABASE_SSL`, and a production start against a remote host refuses until
somebody chooses; which value a given deployment picked is a question to ask of
that deployment rather than of this directory.

The gaps cluster in attestation and operational procedure rather than in the
build. That is the cheaper half to fix — and it is worth being plain about what
that now means: everything still open needs a purchase order, a lawyer, or
somebody to commit to a cadence. None of it is waiting on an engineer.

## What to do next, and what it costs

1. **Close the four blockers in `Decisions_Required.md`** — which law applies,
   the erasure position, who operates the deployment, and hosting. A day of
   counsel and an afternoon of the operator's time. Unblocks most of the rest.
2. **Buy one penetration test.** $5–15k. Not a certificate, and it unblocks
   more enterprise deals than any certificate would.
3. **Publish the CAIQ.** Free. Answers most of what procurement sends.
4. **Start requiring pull-request review now** if a certificate is ever wanted.
   Free, but only if started early — auditors sample a past period and evidence
   cannot be created retrospectively.

Only after those: **ISO 27001** if the buyers are Gulf enterprises or
government, **SOC 2 Type II** if they are US or EU SaaS-native. Roughly
$20–35k and $25–40k respectively in the first year.

## Before any of this is sent to a customer

- **`security@` must exist.** `/.well-known/security.txt` is published and
  points at it. An advertised address that bounces is worse than none.
- **Fill in the corporate identity blanks** — registered entity, commercial
  registration number, address. They appear in every document.
- **Name an incident lead.** The plan has a blank where a person should be.

## Keeping it true

Every count in these documents is read from a live database or from the source,
and the query that produces it is included so it can be re-run. `pnpm test:db`
asserts that every business table has row-level security and an audit trigger,
walking the registry in `packages/db/src/schema/table.ts` — so a table nobody
remembered to protect fails the build rather than quietly making this file
wrong.

Re-verify on any release that touches `packages/db`, authentication or
`proxy.ts`, and update the date at the head of each document.
