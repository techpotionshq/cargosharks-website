# Coordinator

**You move shipments. This chapter is the whole of your day.**

> Read [`00-orientation.md`](00-orientation.md) first if you have not. It covers
> signing in, branches and the five behaviours that will otherwise surprise you.

---

## Your day, in order

Open the **Dashboard**. It opens on the things that need you, and there is a
line at the top telling you how many there are. If it says nothing needs you,
that is a real statement and not a placeholder — every open shipment is running
to plan.

Then work in this order. It is the order the screens are built for.

1. **Needs your attention** — exceptions on live shipments, oldest first
2. **Overdue replies** — enquiries past their reply deadline
3. **Arriving this week** — what lands, and what you must have ready before it does
4. **Demurrage accruing** — containers past their free days, costing money now

Everything below is how to handle each of those.

---

## Enquiries

### Taking an enquiry

**Enquiries → New enquiry.** Enquiries also arrive from your website form; those
appear in the queue already, marked as unassigned.

What you must capture:

| Field | Why it matters |
|---|---|
| **Customer** | Start typing — the list is your customer register. If they are new, create them (you have permission). |
| **Mode and direction** | Sea FCL, sea LCL, air, land or courier; import, export or cross-trade. This decides which rates apply and which milestones the job will get later. |
| **Origin and destination** | From the ports and places register. If a place is missing, ask your operations manager to add it — do not approximate with a nearby port. |
| **Cargo** | Weight, volume, pieces, commodity. For air and LCL these decide the chargeable weight, so an estimate here becomes a wrong price later. |
| **Required by** | Feeds the reply deadline. |

**Assign an owner.** An enquiry with no owner has nobody's name against the
clock, and it is the single most common way an enquiry is lost. You can assign it
to yourself.

### The clock

Every enquiry has a reply deadline, counted in **working hours on your branch's
calendar**. The dashboard shows what has breached and what is due today, and the
SLA watch list is ordered by whichever is closest to breaching.

**You cannot stop the clock by looking at the enquiry.** It stops when a
quotation is sent. If an enquiry cannot be answered — the customer has gone
quiet, the cargo does not exist — that is a *close*, and closing is your
operations manager's or the sales team's decision, not yours. Say so rather than
leaving it to breach silently.

### Pricing it

Open the enquiry and start rating. The system looks for a live rate card covering
that lane, mode and validity date, and prices from it — chargeable weight is
calculated for the mode, and accessorials come from the catalogue.

**If there is no rate card for the lane**, you will be told so plainly rather
than given a wrong number. That means the lane has no buying rate on file and
somebody is about to price it from memory. Tell your operations manager — the
rate-card screen has a whole panel for exactly this problem.

**If a rate looks wrong**, it is a rate-card problem and not something to correct
by hand on this quotation. Fixing the card fixes every future quote; fixing this
one fixes one and hides the fault.

### Sending the quotation

You can send a quotation and you can revise one. A revision **supersedes** the
previous version rather than replacing it — the customer's copy of what you sent
before is still recoverable, which matters on the day somebody disputes it.

**You cannot mark a quotation accepted or rejected, or close an enquiry as won
or lost.** That is the sales team's or the operations manager's call. When a
customer accepts, tell whoever owns that enquiry so it is recorded properly —
a job booked against an enquiry that was never closed leaves your branch's win
rate wrong.

---

## Shipments

### Booking

A job normally begins from an accepted quotation, so the rates come with it and
what you sold is what you costed. You can also create one directly.

**Book it** to move it out of draft. Booking is where the milestone template is
applied — the checklist of stages for that mode and direction. Get the mode and
direction right *before* booking; they decide the milestones.

Capture the references as they arrive: master bill, house bill, booking number,
vessel and voyage or flight number, containers and seal numbers.

**Container and bill numbers are what your customer types into the tracking
page.** A missing container number is a customer who cannot track their own
shipment and rings you instead. This is the single highest-value data-entry
habit in the whole system.

### Milestones

Each shipment carries its stages with three dates: **planned**, **revised** and
**actual**. All three are kept.

- **Planned** is what you expected at booking.
- **Revised** is what you expect now — update it when the carrier tells you the
  vessel has slipped.
- **Actual** is what happened. Fill it when it happens, not at the end of the week.

The difference between planned and actual is what your management uses to work
out where time is really going. Backfilling a week of dates on a Thursday
afternoon produces a shipment that looks perfect and tells nobody anything.

**Updating milestones moves the shipment through its stages** — departed, arrived,
entered clearance, delivered. The stages you can move it to are the ones offered;
if a step you expect is not there, the shipment is not in the state you think it
is.

### Putting a shipment on hold

You can place a shipment on hold and release it. Use it when a shipment has
genuinely stopped — cargo not ready, payment held, documents missing — and it
tells everyone else why.

**You cannot cancel a shipment, complete it or close it.** Those are your
operations manager's. A shipment that should be cancelled goes to them with a
reason, and the reason is the useful part.

### Exceptions

When something goes wrong, raise an exception on the shipment: what it is, how
severe, who owns it, when it is due, and the cost impact if there is one.

**Raise it even if you are about to fix it.** An exception that existed for two
hours and was resolved is data about how often that happens; an exception that
was fixed and never recorded is a pattern nobody can see. The number of times a
lane goes wrong is what renegotiates the contract.

The exceptions screen lists everything open across live shipments, oldest first.
Anything with nobody's name on it is flagged as unassigned.

### Free time

Containers past their free days accrue **demurrage**, **detention** or **storage**
against the carrier's terms.

**The clocks run themselves and write their own charge lines.** You do not have
to calculate anything and you must not enter these charges by hand — you will
duplicate them.

What you *do* have to do is enter the dates the clocks depend on: discharged,
gated out, empty returned. A missing "empty returned" date is a detention clock
that never stops, which produces a wrong charge and a customer argument you will
lose.

The shipment shows free days, chargeable days, per-diem rate, and what has
accrued so far. So does the dashboard, in total, at the top.

---

## Customs

You can file and update the customs stage — record the declaration type and
number, move it through its statuses, record the duty.

You cannot record the duty **payment**; that is Finance's, and the separation is
deliberate.

If you are not the person who does clearance, that is your customs broker's
chapter and you can leave it to them. See [`05-customs-broker.md`](05-customs-broker.md).

---

## Documents

Every file belongs to a shipment and has a **type** — bill of lading, invoice,
packing list, certificate of origin, delivery order.

**Released or draft.** Released documents are visible to the customer, in the
portal and on the tracking page. Drafts are not. Release is a decision you make
per document, so nothing reaches a customer because somebody forgot the default.

**Uploading a new version supersedes the old one.** Both stay visible. Never
upload a corrected document under a new name to work around the version — a
shipment with two bills of lading and no relationship between them is exactly the
confusion the versioning exists to prevent.

---

## Customers

You can create and edit customers, and their contacts. Two habits are worth
having from day one:

**Both names.** English and Arabic. The Arabic name is what appears on the Arabic
quotation and the Arabic portal, and an entity with only an English name produces
a document that reads half-translated to your customer.

**A real contact.** Name, email, phone. This is what the portal invitation and
every notification uses.

---

## Bulk import

If you have arrived with a spreadsheet of customers, contacts, agents, ports or
rates, use **Network → Bulk import** rather than typing them in. It checks every
row before writing anything and imports nothing at all if any row fails.

Full instructions are in the administrator chapter, [§Bulk import](06-administrator.md#bulk-import),
and the same rules apply to you.

---

## What you cannot do, and who to ask

| You want to | Ask |
|---|---|
| Cancel or close a shipment | Operations Manager |
| Mark an enquiry won or lost | Operations Manager or Sales |
| Accept or reject a quotation | Operations Manager or Sales |
| Add or change a rate card | Operations Manager |
| Add an agent, haulier or carrier | Operations Manager |
| Add a port or place | Operations Manager |
| Anything on an invoice or a receipt | Finance |
| Record duty paid | Finance |
| See the audit log | Administrator |
| Get access to another branch | Administrator |

---

## Five habits that make the difference

1. **Enter the actual date on the day it happens.** Everything downstream — ETA,
   exceptions, free time, the customer's tracking page — is only as true as the
   last date somebody entered.
2. **Put the container and bill numbers in as soon as you have them.** They are
   how your customer finds their own shipment without ringing you.
3. **Raise the exception even when you are fixing it.**
4. **Never fix a wrong price on the quotation.** Fix the rate card.
5. **Never leave an enquiry unassigned overnight.** The clock is running against
   your branch either way.
