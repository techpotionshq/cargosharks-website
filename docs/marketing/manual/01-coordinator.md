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

**Enquiries → New enquiry.** Enquiries also arrive by email — mail to a mailbox
your administrator has connected becomes an enquiry for that branch within a
minute — and those appear in the queue already, marked as unassigned, with
*Email* as the channel.

If document extraction is switched on, an emailed enquiry opens with a panel
headed **Read from the email**: the mode, lane, commodity, weight and the rest,
as the assistant read them off the mail, each with the line it was read from.
**Accept** the ones that are right and **Dismiss** the ones that are not;
nothing is written to the enquiry until you do. A proposal with *No line quoted*
is one to check against the mail before accepting.

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
quotation is sent, or when you press **Mark replied** to record a reply you made
outside the system — by phone, say. That records the time of your first reply,
which is what the deadline is measured against, and it cannot be undone. If an
enquiry cannot be answered — the customer has gone quiet, the cargo does not
exist — that is a *close*, and closing is your operations manager's or the
sales team's decision, not yours. Say so rather than leaving it to breach
silently.

**Start rating** tells the queue somebody is on it. It does not stop the clock.

### Pricing it

Open the enquiry and press **Price it**. The system looks for a live rate card
covering that lane, mode and validity date, and prices from it — chargeable
weight is calculated for the mode, and accessorials come from the catalogue. The
**Rate comparison** shows every option with buy, sell and margin side by side;
the buy side and the margin are internal and never reach the customer.

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

The quotation itself is a PDF on your letterhead — **PDF (EN)** and **PDF (AR)**
on the quotation page — with the branch's trading conditions and its list of
what is not included printed on it.

**You cannot mark a quotation accepted or rejected, or close an enquiry as won
or lost.** That is the sales team's or the operations manager's call. When a
customer accepts, tell whoever owns that enquiry so it is recorded properly —
a job booked against an enquiry that was never closed leaves your branch's win
rate wrong.

---

## Shipments

### Booking

A job normally begins from an accepted quotation, so the rates come with it and
what you sold is what you costed. You can also create one directly with
**New shipment**.

**Move it on** to *Booked* to take it out of draft. Booking is where the
milestone template is applied — the checklist of stages for that mode and
direction. Get the mode and direction right *before* booking; they decide the
milestones.

**Booking checks the customer's credit.** A customer on credit hold, or one the
shipment would put past their credit limit, cannot be booked. The message says
which; the answer is a credit override on the customer's account, and that is
your operations manager's or Finance's to record, not yours.

Capture the references as they arrive: master bill, house bill, booking number,
vessel and voyage or flight number. **Add a container** for each box — number,
type, seal — because a container is what a free-time clock runs against and
what a proof of delivery is signed for.

**Engage a partner** under *Who is moving it*: the carrier, the agent at the far
end, the haulier, the broker, the terminal — with their reference, so the number
you quote when you ring them is on the file rather than in a mailbox. These are
the companies you placed the work with, and who gets settled with; they are not
the shipper and consignee on the bill. Those go under *Who prints on the
documents*, below.

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

**Record a milestone** sets the actual time on a step; **Take it back** clears a
time recorded by mistake. The shipment's stage — departed, arrived, entered
clearance, delivered — is set with **Move it on**, and the stages you can move
it to are the ones offered; if a step you expect is not there, the shipment is
not in the state you think it is.

### Putting a shipment on hold

You can place a shipment on hold and release it. Use it when a shipment has
genuinely stopped — cargo not ready, payment held, documents missing — and it
tells everyone else why.

**You cannot cancel a shipment, complete it or close it.** Those are your
operations manager's. A shipment that should be cancelled goes to them with a
reason, and the reason is the useful part.

### Exceptions

When something goes wrong, **Report a problem** on the shipment: what it is, how
severe, who owns it, when it is due, and the cost impact if there is one.
**Show the customer** puts it on their tracking page as a notice; turn it off
for an internal-only note. **Resolve** closes it, and what you type under
*What was done* is the only record of how it was fixed.

**Raise it even if you are about to fix it.** An exception that existed for two
hours and was resolved is data about how often that happens; an exception that
was fixed and never recorded is a pattern nobody can see. The number of times a
lane goes wrong is what renegotiates the contract.

The exceptions screen lists everything open across live shipments, oldest first.
Anything with nobody's name on it is flagged as unassigned.

### Free time

Containers past their free days accrue **demurrage**, **detention** or **storage**
against the carrier's terms.

**Start a clock** when a box is discharged or collected — the kind (demurrage is
the box at the port, detention is the box off it, storage is the warehouse), the
container, the start date, and who the days are owed to. The free days and the
per-diem come from your branch's free-time terms; change them only where this
shipment's terms differ.

**From then on the clocks run themselves and write their own charge lines.** You
do not have to calculate anything and you must not enter these charges by hand —
you will duplicate them.

What you *do* have to do is enter the dates the clocks depend on: the start —
discharge or gate out, whichever the kind counts from — and the **Ends** date
when the box leaves the terminal or comes back to the line. Setting the end
stops the accrual; charged days stay. A clock with no end date is a detention
clock that never stops, which produces a wrong charge and a customer argument
you will lose.

The shipment shows free days, chargeable days, per-diem rate, and what has
accrued so far. So does the dashboard, in total, at the top.

### Proof of delivery

When the cargo changes hands, **Capture delivery** on the shipment — on a phone
at the door, ideally. Who received it, when, which container or the whole
shipment, a signature drawn with a finger, photographs of the cargo and the
signed paper, and the device's location if it offers one. If something was
short, damaged or refused, tick **Something was wrong** and say what: the
delivery is still recorded, and that note is what a claim is argued from.

A mistake is corrected with **Correct this**. The original is kept and marked
*Corrected*; nothing is overwritten.

### The charge ledger

The **Charge ledger** at the foot of the shipment is its P&L: every cost and
every revenue line, with the margin. Costs arrive on their own from free-time
clocks and consolidation splits, and you can **Add charge** for anything else —
a buy is what the shipment costs you, a sell is what the customer is charged.
Each line keeps the exchange rate it was struck at, so the figure never moves
again.

---

## Customs

You can file and update the customs stage — **Update customs** records the
declaration type and number, the broker, the clear-by date, and moves it through
its statuses; the duty goes in as assessed.

**Estimate duty** gives you the landed cost before it ships: goods value,
freight and insurance against the tariff loaded under Reference data, matched by
the HS code on each cargo line. It is an estimate, not an assessment, and both
are kept so the gap between them can be measured.

You cannot record the duty **payment**; that is Finance's, and the separation is
deliberate.

If you are not the person who does clearance, that is your customs broker's
chapter and you can leave it to them. See [`05-customs-broker.md`](05-customs-broker.md).

---

## Documents

Every file belongs to a shipment and has a **type** — bill of lading, invoice,
packing list, certificate of origin, delivery order. **Operations → Documents**
lists every one across your branches, newest first.

### What the documents are built from

Two panels on the shipment feed every document it produces, and both must be
filled before anything is issued:

**Who prints on the documents** — **Add party** for the shipper, consignee,
notify party, second notify, delivery agent and forwarding agent. Printed on the
bill exactly as entered, in both languages, and kept as entered: a document
records what was said, not what is currently true.

**What is in the shipment** — **Add cargo line** for each line of goods:
description as the shipper declared it, marks and numbers, packages, HS code,
gross and net weight, volume, and the container it is stuffed in. The packing
list is grouped by container from these; the customs pack and the duty estimate
read the HS codes.

### Issuing

**Issue and preview** on the shipment produces four documents:

| Document | What it is |
|---|---|
| **House bill of lading** — or **House air waybill** on an air shipment | Contract of carriage. Watermarked until numbered; the number comes from the branch's house B/L series, if one is set. |
| **Delivery order** | Expires seven days after issue. |
| **Packing list** | Grouped by container, with net weight. |
| **Customs declaration pack** | What the broker would otherwise retype. |

**EN** and **AR** preview the document in either language — a preview renders
and stores nothing, so opening one costs nothing. **Issue** keeps the copy that
was handed over: it stores the PDF, writes the document onto the shipment, and
supersedes the previous version. Regenerating never replaces.

For a sea house bill that has been numbered, **Surrender bill** records a telex
release: the shipper has handed the originals back and the agent releases
without them. Copies print stamped from then on. It cannot be undone.

### Releasing

**Released or draft.** Released documents are visible to the customer, on the
tracking page and in the portal. Drafts are not. **Release** is a decision you
make per document, so nothing reaches a customer because somebody forgot the
default — and it is not the same act as issuing. Issuing says *these bytes are
the document*; releasing says *the customer now has it*.

**Issuing a new version supersedes the old one.** Both stay visible. Never work
around the version by issuing a corrected document as something else — a
shipment with two bills of lading and no relationship between them is exactly
the confusion the versioning exists to prevent.

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

## Consolidations

**Operations → Consolidations.** Many house bills under one master, and the
master's cost split between them.

**New consolidation** opens a master: mode, direction, port of loading and
discharge, the carrier or co-loader, the master bill, booking, vessel and voyage
or flight, ETD and ETA. The master bill belongs here, not on any house. Then
**Attach** the shipments sailing under it — a house cannot join a master of a
different mode — and **Detach** one that moves to another sailing. **Close
manifest** at the cut-off.

**Could share a container**, at the foot of the consolidations screen, is the
system doing this for you: loose LCL and air shipments on the same lane and
sailing, grouped, with how full a container they would make. **Consolidate**
opens the master with those houses already attached.

**Manifest** — and **AR** for the Arabic — is the PDF for the carrier and the
far end.

**Add cost** records what the consolidation cost or earned as a whole — the
basis decides how it divides across the houses. **Split** is not yours: it
writes a cost line onto every house, which decides twenty margins, and it sits
with your operations manager or Finance.

---

## Supplier bills

When an agent, a line or a haulier bills you, you capture it — **Finance →
Payables → Capture bill** — because you are the one who knows which of the
thirty shipments on a monthly agent invoice each line belongs to. Enter the
bill as it arrived, their lines as they wrote them, then **Match** each line to
the cost line on the job it should settle.

**Read a bill** does the typing for you: upload the PDF or a photograph of the
printout and the lines are captured for you to check. It lands as *Received*,
like anything typed in. If the figures do not add up, nothing is written and the
scan is kept on file; if no model key is configured, it says so and you capture
the bill by hand.

Nothing you do here releases money. Approving a bill for payment, and paying
it, are Finance's — see [`04-finance.md`](04-finance.md#payables).

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
| Let a customer book past their credit limit | Operations Manager or Finance |
| Split a consolidation's master cost across its houses | Operations Manager or Finance |
| Approve or pay a supplier's bill | Finance |
| Anything on an invoice or a receipt | Finance |
| Record duty paid | Finance |
| See the audit log | Administrator |
| Connect a mailbox | Administrator |
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
