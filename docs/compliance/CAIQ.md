# CAIQ — self-assessment

*The Consensus Assessments Initiative Questionnaire, answered against this
build. Free to publish, needs no auditor, and answers most of what enterprise
procurement sends.*

Assessed: **2026-08-25**. Framework: **CSA CAIQ v4** (CCM v4 domains).
Assessment type: **self-assessment**. Not audited, not certified, not
attested. Publishing it as anything else would be a misrepresentation.

**How to read the answers.** `Yes` means the control is implemented and can be
demonstrated in the code or against a running system. `Partial` means part of
it is real and the rest is named. `No` means it is not there. `N/A` means the
question does not apply to how this is built. There are deliberately a lot of
`No`s — a questionnaire without them is one nobody believes.

**Where the answers live.** The rows are held in
[`build-spreadsheets.py`](build-spreadsheets.py), which renders them into
`spreadsheets/CAIQ.xlsx` — the form a customer's procurement team asks for.
This file is the narrative beside them: it carries the reasoning that does not
fit in a cell. Change an answer in the script, re-run it, and correct the prose
here from what it prints.

---

## A&A — Audit and Assurance

| ID | Question | Answer | Notes |
| --- | --- | --- | --- |
| A&A-01 | Are audit and assurance policies established and reviewed? | **Partial** | Documented here and versioned in the repository. No annual review cycle in force |
| A&A-02 | Are independent audits performed at least annually? | **No** | No SOC 2, no ISO 27001, no penetration test. The single largest gap |
| A&A-03 | Are compliance audits risk-based? | **N/A** | Follows from A&A-02 |
| A&A-04 | Is there a process to remediate audit findings? | **Partial** | CI and the weekly security workflow gate findings; no external audit to remediate |
| A&A-05, 06 | Audit management process / remediation tracking | **Partial** | Tracked as repository issues and in `Decisions_Required.md` |

## AIS — Application and Interface Security

| ID | Question | Answer | Notes |
| --- | --- | --- | --- |
| AIS-01 | Are application security policies established? | **Yes** | `CLAUDE.md` non-negotiables, enforced by eight repository invariant checks in `pnpm lint` |
| AIS-02 | Is application security tested before release? | **Yes** | Every commit: types, engines, migrations, the RLS policy matrix on real PostgreSQL, and every screen end to end in both languages |
| AIS-03 | Is there automated static analysis? | **Yes** | Semgrep — `p/typescript`, `p/react`, `p/nodejs`, `p/secrets`, `p/owasp-top-ten`, `p/sql-injection` — on every change and weekly |
| AIS-04 | Is input validated? | **Yes** | Zod at every boundary. Server Actions are the only mutation path |
| AIS-05 | Is an SBOM produced? | **Yes** | CycloneDX on every security-workflow run, retained 90 days |
| AIS-06 | Are secure coding standards defined? | **Yes** | Enforced mechanically, not by review alone — dependency direction, message parity, permission coverage, fixture coverage, migration ordering |
| AIS-07 | Is dependency vulnerability scanning performed? | **Yes** | `pnpm audit`, weekly and per change; fails on high and above. Dependabot opens the fixes |

## BCR — Business Continuity and Operational Resilience

| ID | Question | Answer | Notes |
| --- | --- | --- | --- |
| BCR-01 | Is there a business continuity plan? | **No** | Not written |
| BCR-02 | Are RTO and RPO defined? | **No** | Open — `Decisions_Required.md` item 46 |
| BCR-03 | Are backups performed and tested? | **Partial** | Tooling exists and is exercised (`fleet:backup`, `fleet:restore-drill`, in the deploy checklist). The NFR-11 schedule — daily/14 days, weekly off-site/30 days, quarterly signed-off drill — is not operating |
| BCR-04 | Is there a documented disaster-recovery process? | **Partial** | Restore is a command; the surrounding procedure is not written |
| BCR-05 | Is continuity tested annually? | **No** | |

## CCC — Change Control and Configuration Management

| ID | Question | Answer | Notes |
| --- | --- | --- | --- |
| CCC-01 | Is there a change-management policy? | **Partial** | CI gates every change. Peer review is **not** currently required — see the note below |
| CCC-02 | Are changes tested before production? | **Yes** | Six CI jobs; a production build is one of them |
| CCC-03 | Is there a rollback capability? | **Partial** | Container images roll back. **Migrations are forward-only by design** and do not |
| CCC-04 | Are unauthorised changes prevented? | **Partial** | `drizzle-kit push` is disabled deliberately; migrations run as a separate role. Branch protection is not configured |
| CCC-05 | Is configuration baselined? | **Yes** | Everything in the repository; reference data is seed rows an administrator edits without a release |

> **CCC-01 is the one to fix early if SOC 2 or ISO 27001 is wanted.** Both want
> evidence that changes were reviewed and authorised, and auditors sample a
> *past* period. Requiring a pull request and an approval costs nothing except
> starting now — evidence cannot be created retrospectively.

## CEK — Cryptography, Encryption and Key Management

| ID | Question | Answer | Notes |
| --- | --- | --- | --- |
| CEK-01 | Is data encrypted in transit? | **Partial** | TLS is terminated at the reverse proxy and HSTS is now set. **The database connection does not require TLS**, and web-to-service is plain HTTP on a private network |
| CEK-02 | Is data encrypted at rest? | **No** | A property of the host, and no host is chosen. Mailbox credentials *are* sealed with AES-256-GCM |
| CEK-03 | Are strong algorithms used? | **Yes** | AES-256-GCM for sealed credentials; TOTP for the second factor; password hashing by Better Auth |
| CEK-04 | Are keys managed and rotated? | **Partial** | Keys live in the environment, deliberately outside the database and its backups. No formal rotation schedule |
| CEK-05 | Are keys stored separately from the data they protect? | **Yes** | `MAILBOX_ENCRYPTION_KEY` stays in the environment precisely because `mailboxes` is in every backup and replica |

## DCS / DSP — Data Centre Security, Data Security and Privacy

| ID | Question | Answer | Notes |
| --- | --- | --- | --- |
| DCS-01 | Is physical security managed? | **N/A** | Inherited from the hosting provider, which is not chosen |
| DSP-01 | Is data classified? | **Partial** | Implicit in the schema and the ROPA; no formal classification scheme |
| DSP-02 | Is there a data inventory? | **Yes** | [`ROPA.md`](ROPA.md), derived from the schema |
| DSP-03 | Is data segregated between tenants? | **Yes** | Enforced by the database: row-level security `ENABLE` **and** `FORCE` on 82 of 88 tables, 197 policies, and a database per customer in the fleet tooling |
| DSP-04 | Is secure deletion supported? | **No** | The system is built on "nothing is deleted". See the erasure note in `ROPA.md` |
| DSP-05 | Are retention periods defined? | **No** | Open, and blocked on the erasure decision |
| DSP-06 | Is a DPIA performed where required? | **No** | Blocked on which law applies |
| DSP-07 | Are sub-processors disclosed? | **Yes** | [`Sub_Processors.md`](Sub_Processors.md) |
| DSP-08 | Can a customer's data be returned or exported? | **Partial** | Export exists per register; a whole-tenant export is not built |

## GRC — Governance, Risk and Compliance

| ID | Question | Answer | Notes |
| --- | --- | --- | --- |
| GRC-01 | Is there an information-security policy? | **Partial** | This directory. Not formally approved or on a review cycle |
| GRC-02 | Is there a risk-management programme? | **Partial** | Risks are named where they live — `Security_Measures.md` §6, `Operations_Findings.md`. No register with owners and dates |
| GRC-03 | Are roles and responsibilities defined? | **No** | Open — the incident plan has no named owner yet |
| GRC-04 | Is there an exception process? | **Yes** | Every deviation carries a written reason in code, and the invariant checks refuse silent omissions |

## HRS — Human Resources Security

| ID | Question | Answer | Notes |
| --- | --- | --- | --- |
| HRS-01 | Are background checks performed? | **No** | Open — item 25 |
| HRS-02 | Are confidentiality agreements in place? | **Partial** | Open — item 49 |
| HRS-03 | Is security awareness training provided? | **No** | |
| HRS-04 | Is there an onboarding/offboarding process? | **Partial** | Technically: accounts are `is_active = false` and revocation takes effect on the next request. Not documented as a procedure |

## IAM — Identity and Access Management

| ID | Question | Answer | Notes |
| --- | --- | --- | --- |
| IAM-01 | Is there an access-management policy? | **Yes** | Roles and permissions are seed rows; 35 enforced keys, granted per branch |
| IAM-02 | Is least privilege enforced? | **Yes** | Application role holds `NOBYPASSRLS`, owns nothing, and `DELETE` is revoked. Migrations run as a separate role |
| IAM-03 | Is multi-factor authentication supported? | **Yes** | TOTP, and **mandatory** for Administrator and Finance — enforced in both internal shells |
| IAM-04 | Are strong passwords enforced? | **Yes** | Twelve characters minimum |
| IAM-05 | Is there protection against brute force? | **Yes** | Five failures locks the account for fifteen minutes; ten attempts per address per fifteen minutes |
| IAM-06 | Are sessions managed securely? | **Yes** | Database-backed and opaque, never JWTs. Revocation takes effect on the next request. Twelve-hour expiry, `__Secure-` prefixed cookies |
| IAM-07 | Are privileged accesses logged? | **Yes** | 80 audit triggers; vendor support access is separately granted, time-boxed, read-only by structure, and logged per transaction |
| IAM-08 | Are access reviews performed periodically? | **No** | No cadence defined |
| IAM-09 | Is SSO/SAML supported? | **No** | Deliberately out of scope for Release One |

## IVS / UEM / TVM — Infrastructure, Endpoints, Threat and Vulnerability

| ID | Question | Answer | Notes |
| --- | --- | --- | --- |
| IVS-01 | Is network segmentation in place? | **Partial** | The service's `/internal` routes are unreachable from outside the private network, and that is verified by three `curl` checks in the deploy procedure |
| IVS-02 | Are baseline configurations enforced? | **Yes** | One Dockerfile, standalone output, no devDependencies in the runtime image |
| TVM-01 | Is vulnerability scanning performed? | **Yes** | Dependencies, container image (Trivy) and source (Semgrep), weekly and per change |
| TVM-02 | Are vulnerabilities remediated within defined timeframes? | **Partial** | Gated on high and above; no formal SLA per severity |
| TVM-03 | Is penetration testing performed? | **No** | **The single highest-value thing to buy.** Roughly $5–15k |
| TVM-04 | Is there a vulnerability-disclosure process? | **Yes** | `/.well-known/security.txt`, RFC 9116 |

## LOG — Logging and Monitoring

| ID | Question | Answer | Notes |
| --- | --- | --- | --- |
| LOG-01 | Are security events logged? | **Yes** | Audit triggers on every business table; support access logged per transaction |
| LOG-02 | Are logs protected from tampering? | **Yes** | `audit_log` is insert-only and `DELETE` is revoked from the application role |
| LOG-03 | Are logs retained? | **Partial** | Nothing is deleted, so retention is effectively unlimited — but NFR-10's twelve-month *searchable and exportable* requirement is not met, because neither is built |
| LOG-04 | Is monitoring and alerting in place? | **No** | OpenTelemetry is wired with no exporter registered. NFR-18 requires this at handover |
| LOG-05 | Is there audit-log review? | **No** | No screen searches or exports the log |

## SEF — Security Incident Management

| ID | Question | Answer | Notes |
| --- | --- | --- | --- |
| SEF-01 | Is there an incident-response plan? | **Yes** | [`Incident_Response.md`](Incident_Response.md) |
| SEF-02 | Are incidents reported to customers? | **Partial** | The plan commits to it; the contractual window is not agreed — item 30 |
| SEF-03 | Is the plan tested? | **No** | No tabletop exercise has been run |
| SEF-04 | Is forensic evidence preserved? | **Partial** | The audit trail is unusually strong and hard to erase. No formal evidence-handling procedure beyond §3 of the plan |

## STA — Supply Chain and Third-Party Management

| ID | Question | Answer | Notes |
| --- | --- | --- | --- |
| STA-01 | Are third parties assessed? | **Partial** | Disclosed and reasoned in `Sub_Processors.md`; no formal assessment |
| STA-02 | Are sub-processors contractually bound? | **Partial** | Open — items 27, 10 |
| STA-03 | Is an SBOM maintained? | **Yes** | Per build |
| STA-04 | Is there supplier lock-in? | **No** | Deliberately: no supplier-hosted component in the runtime path, the customer owns the code and the cloud account on final payment, and the AI surface is removed by unsetting one key |

---

## Summary

| | Count |
| --- | --- |
| Yes | 29 |
| Partial | 23 |
| No | 18 |
| N/A | 2 |
| **Total** | **72** |

These are counted by `build-spreadsheets.py`, not tallied by hand — an earlier
draft of this file said 69 and was simply wrong. Re-run the script after
changing an answer and correct the table above from what it prints.

**The shape of this is worth naming.** The strengths cluster in tenant
separation, audit, identity and the build pipeline — the controls that are
expensive to retrofit and cheap to verify. The gaps cluster in *attestation*
and *operational procedure* — an audit, a pen test, monitoring, retention,
access reviews — which are cheap to fix and mostly need decisions and an
operator rather than engineering.

That is an unusual and favourable shape. Most vendors at this stage have the
paperwork and a weak build.

**In priority order:** a penetration test (TVM-03); monitoring and alerting
(LOG-04); the retention and erasure decision (DSP-04/05); pull-request review
starting now if a certificate is ever wanted (CCC-01); TLS to the database and
encryption at rest once a host is chosen (CEK-01/02).
