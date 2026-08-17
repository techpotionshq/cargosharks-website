# Agents and partners

> **Read this before you promise anything to an agent.** The agent portal is a
> scaffold in this release, not a working portal. This chapter says exactly what
> exists today, how to work with your agent network in the meantime, and what
> the portal will be when it ships.

---

## What exists today

**The route exists and is correctly scoped.** An agent contact who signs in sees
only jobs where their own partner record is named on the shipment — and that
scoping is enforced by the database, as one arm of the same policy that separates
your branches. It is not an application that was bolted on and then filtered.

**The screen itself is a placeholder.** It says *"Assigned shipments — shipments
where you are named as a partner, and open rate requests"* and shows nothing
else. RFQ dispatch, agents responding to rate requests, agents posting milestones
and documents, and compliance self-service are **in delivery**, not shipped.

**So: do not give an agent a login yet.** An agent who signs in and finds an
empty screen has learned something about you that is hard to unlearn. Wait until
it ships.

The reason it was left this way rather than mocked up is worth knowing, because
it is the same reason the rest of this manual is blunt about gaps: a portal that
requires real agents to log in and respond cannot be demonstrated convincingly
with fake data, so it was scoped correctly and left honest rather than filled in.

---

## How to work with agents today

Everything below is live, and it is the part that carries the operational weight.

### The partner register

**Network → Partners & agents.** Agents, hauliers and carriers, with their
contacts.

Keep two things true:

**Both names.** English and Arabic — they appear on documents.

**Compliance documents and their expiry dates.** Trade licence, insurance,
whatever your jurisdiction requires. **An expiry date that is not maintained is
worse than no register**, because it produces confidence that is not warranted,
and the moment it surfaces is during an audit rather than during a job.

Until the compliance expiry reminders ship, this needs a diary entry: review the
register monthly and chase what expires in the next sixty days.

### Naming an agent on a shipment

Add the partner to the shipment. That is what makes the job visible to their
contacts when the portal ships — and today it is what makes your own operations
board show who is handling the other end.

Do it at booking, not at the point something goes wrong. A shipment with no
partner named is one where the answer to *"who is our agent at destination?"*
lives in somebody's memory.

### Agent tariffs

An agent's rates go in as a **buy** rate card belonging to that partner. Load
them once and every quotation on those lanes prices from a contract rather than
from a search of somebody's mailbox.

A spreadsheet from an agent goes through **Network → Bulk import** — choose
*Rate cards*, direction *Buy*, and the partner it belongs to. Every line is
checked before anything is written, and if one line fails, nothing is imported.

**A card will be rejected for overlapping an existing card on the same lane.**
That is the protection working: two overlapping cards on one lane cannot exist in
this system. Fix the validity dates on one of them.

### Rate requests, in the meantime

Send them the way you send them today — email, WhatsApp, the phone. When the
answer comes back, put it in as a buy rate card with the validity the agent
quoted. That way the next quotation on that lane prices itself, and the request
does not have to be repeated in six weeks.

### Milestones and documents from the far end

Your coordinator enters them. When an agent emails a milestone date or a
document, it gets entered against the shipment the same day — see
[`01-coordinator.md`](01-coordinator.md).

**The same day, not the same week.** Your customer's tracking page is only as
current as the last date somebody entered, and an agent's update sitting in a
mailbox is a customer ringing you to ask a question the system could have
answered.

---

## What the portal will be

When it ships, an agent contact will sign in and see:

| | |
|---|---|
| **Assigned shipments** | Jobs where their partner is named — already scoped correctly today |
| **Rate requests** | RFQs you have sent them, with responses coming back into your comparison |
| **Rate-card upload** | Their tariff, loaded by them, checked the same way your imports are |
| **Milestone and document posting** | The far end updating the shipment directly |
| **Compliance self-service** | Their own licences and expiry dates, maintained by them |

The last one is the quiet win: the compliance register stops being something you
chase and becomes something they maintain.

**Ask your supplier which release**, and get the answer in writing. If you are
being told "soon", ask again.

---

## What to tell an agent who asks

> "We have a portal coming where you will see your assigned shipments, respond to
> rate requests and post milestones directly. It is not open yet and we will tell
> you when it is. Until then, nothing changes at your end — send us what you send
> us today."

Do not promise a date you were not given in writing.
