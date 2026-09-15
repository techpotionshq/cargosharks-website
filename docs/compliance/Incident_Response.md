# Security incident response

*What to do, in what order, and who decides.*

Last reviewed: **2026-08-25**. Owner: **[TO CONFIRM — a named person, not a
team. An incident plan with no name on it produces a meeting, not a response.]**

This plan is deliberately short. A twenty-page plan is not read at 02:00; this
one is meant to be.

---

## 0. Before anything

**Do not destroy evidence.** Do not restart the container, rotate the key or
drop the session until step 2 has captured what is needed — unless leaving it
running is actively causing harm, in which case contain first and say so in the
log. `DELETE` is revoked from the application role and the audit log is written
by triggers, so the database side of the record is unusually hard to lose. The
easy things to lose are container logs and the process itself.

## 1. Declare (target: 15 minutes from suspicion)

Anyone may declare. Over-declaring is cheap; the cost of the alternative is the
hour spent deciding whether it counts.

Open a log — a dated file, a channel, a document, anything append-only — and
record from the first minute: **what was seen, when, by whom, what was done.**
Every step below writes to it. This log is what a regulator, a customer and an
insurer each ask for, and reconstructing it afterwards from memory is where
incident reports lose credibility.

Assign three roles. One person may hold more than one; nobody holds all three.

| Role | Owns |
| --- | --- |
| **Lead** | Decisions, and the clock in section 5 |
| **Technical** | Containment, evidence, remediation |
| **Communications** | Customers, the regulator, staff |

## 2. Assess and contain (target: 1 hour)

Answer four questions, in the log:

1. **What is affected?** Which deployment, which tenant, which tables.
2. **Is it still happening?**
3. **Whose data?** Which customers, which categories, roughly how many people.
4. **How do we know?** The evidence, not the theory.

Containment, in order of preference: revoke the credential; revoke the session;
revoke the support grant; block the address; take the deployment down. Each one
before the next, because each is less damaging than the one after it.

**Queries that answer question 1 quickly.** Every one is read-only.

```sql
-- What did this principal touch, and when?
select occurred_at, table_name, action, row_id
  from audit_log where principal_id = $1
 order by occurred_at desc limit 500;

-- Every support session open or recently closed.
select g.id, g.principal_id, g.reason, g.expires_at, g.revoked_at
  from support_grants g
 where g.revoked_at is null and g.expires_at > now() - interval '30 days';

-- What a support engineer actually read.
select * from support_access_log where grant_id = $1 order by occurred_at;

-- Live sessions for an account, to revoke.
select id, token, ip_address, user_agent, expires_at
  from auth_session where user_id = $1;
```

Revoking a session is a delete from `auth_session`, and it takes effect on the
principal's **next request** — sessions are database-backed and opaque, never
JWTs, precisely so that this is true.

## 3. Preserve evidence

Before remediating: capture container logs, capture the relevant `audit_log`
and `support_access_log` rows to a file held outside the affected deployment,
and note the image digest actually running. Take a database snapshot if the
incident is a data-integrity one.

## 4. Remediate and recover

Fix the cause, not the symptom. Rotate every credential that could plausibly
have been exposed — `BETTER_AUTH_SECRET`, `MAILBOX_ENCRYPTION_KEY`, the database
passwords, the object-store keys, the model key. Rotating `BETTER_AUTH_SECRET`
signs everybody out, which is the intended effect.

Restore from backup only after the cause is understood, or the restore
reintroduces it.

## 5. Notify

**The clock starts when the incident is *known*, not when it is understood.**

| Who | When | What |
| --- | --- | --- |
| Affected customers (controllers) | **[TO CONFIRM — 24 or 48 hours. "Without undue delay" alone will not satisfy a reviewer, and 24h is what enterprise contracts ask for]** | What happened, what data, what we are doing, what they should do |
| Supervisory authority | Within the statutory window once the applicable law is settled — **72 hours** under GDPR-style regimes | The controller usually notifies; we supply the facts |
| Affected individuals | Where the risk to them is high | Plain language, in English and Arabic |

We are a **processor** for customer data. That means we notify the customer,
promptly and in full, and the customer notifies the regulator. Do not notify a
regulator on a customer's behalf without their instruction.

A first notification does not need to be complete. It needs to be *early* and
honest about what is not yet known. Say what is known, what is not, and when the
next update comes.

## 6. Review (within 5 working days of closure)

A written review: timeline, cause, what worked, what did not, and actions with
names and dates against them. Blameless — the aim is a system that fails less,
and a review that hunts for a culprit produces a team that reports later next
time.

Then: does anything here need to change? If the plan was wrong at 02:00, fix it
while that is still fresh.

---

## Standing obligations

- **Dependency patching.** The `Security` workflow runs weekly and Dependabot
  opens the pull requests. Better Auth security advisories are a named
  subscription obligation — self-hosting authentication trades a licence fee for
  a patching duty, and after handover that duty is the operator's
  (Architecture §13, NFR-18).
- **The loop breaker.** Anything that emails the sender of inbound mail needs
  one. A bounce once became 195 enquiries in half an hour
  (`Operations_Findings.md` §11). Treat a mail storm as an incident.
- **"The model returned nothing" is a claim to check** against
  `ai_invocations.response`, not a diagnosis.

## Contacts

| | |
| --- | --- |
| Security reports from outside | `apps/landing/public/.well-known/security.txt` |
| Incident lead | **[TO CONFIRM]** |
| Data protection contact | **[TO CONFIRM — a dedicated address such as `privacy@`, not the general enquiry mailbox]** |
| Hosting provider support | **[TO CONFIRM — blocked on the hosting decision]** |
| Cyber insurer and policy number | **[TO CONFIRM — most policies require notification within 72 hours or cover is void]** |
