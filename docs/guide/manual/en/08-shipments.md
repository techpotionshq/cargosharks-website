---
title: Shipments
routes: [/jobs, /jobs/[id], /exceptions, /customs]
messages: [jobActions.setStatus, jobActions.recordMilestone, jobForm.open]
---

# Shipments

::: intro
Also called jobs. One shipment file holds everything about one movement of goods.
:::

## What it is for

The shipment file holds the milestones, references, containers, partners, parties, cargo, documents, free time clocks, customs, proof of delivery and the money. The **Shipments** page lists them all by stage.

![**The shipments list.** Every live shipment, its stage and what happens next.](shot:/jobs)

![**The shipment file.** Problems at the top, milestones on the left, the shipment details and free time on the right.](shot:/jobs/job-1041)

## Step by step

::: steps
1.  **Open the shipment** from an accepted quotation with [{app:jobForm.open}]{.ui}, so the agreed prices come across, or from [Shipments]{.ui}.
2.  **Add the booking details:** booking number, vessel and voyage, departure and arrival dates, master and house bill numbers.
3.  **Add a container** for each box, with its number, type and seal.
4.  **Engage a partner** under *Who is moving it*: the carrier, agents, haulier, broker, with their reference.
5.  **Add party** under *Who prints on the documents*: shipper, consignee and notify party.
6.  **Add cargo line** for each kind of goods: description, packages, HS code, weights and volume.
7.  **{app:jobActions.recordMilestone}** on the day it happens, and use [{app:jobActions.setStatus}]{.ui} to change the stage, for example to In transit.
:::

## Milestones

Each step keeps three dates: **planned** (what you expected), **revised** (what you expect now) and **actual** (what happened). All three are kept, so you can see where time really goes.

## Free time clocks

A shipping line allows a container a number of free days. After that it charges **demurrage** (container still at the port), **detention** (container kept outside the port) or **storage**. [Start a clock]{.ui} when the box is discharged or collected, and enter the end date when it leaves or is returned. The clock writes its own charge lines; do not enter them by hand.

## Exceptions

When something goes wrong, [Report a problem]{.ui}: what it is, how serious, who owns it, the due date and any cost. Tick *Show the customer* to put a notice on their tracking page; the customer sees a plain explanation, for example that customs is holding the shipment for checks and that they need do nothing unless contacted. [Resolve]{.ui} records what was done. The Exceptions screen lists open ones oldest first.

![**Exceptions.** Everything wrong across live shipments, oldest first.](shot:/exceptions)

## Customs

[Update customs]{.ui} on the shipment records the declaration number, the broker, the clear-by date and the stage, from waiting for documents to released. [Estimate duty]{.ui} gives a landed cost from the tariff and the HS codes. The Customs screen orders declarations by the deadline that closes first. The system tracks declarations; it does not file them with the authority.

![**Customs.** Declarations in clearance, by the window that closes first.](shot:/customs)

## Proof of delivery

[Capture delivery]{.ui}, ideally on a phone at the door: who received it, when, which container, a finger signature, photos and the location. Tick *Something was wrong* for short, damaged or refused cargo. A mistake is fixed with [Correct this]{.ui}; the original is kept.

## Good to know

-   **Booking checks credit.** A customer on hold or past their credit limit cannot be booked until a manager or finance records an override with a reason.
-   **Container and bill numbers** are what customers type into the tracking page. Enter them early.
-   **Coordinators move work forward;** cancelling, completing and closing a shipment belong to the operations manager.
-   **The charge ledger** at the foot of the file is the shipment's profit and loss: every cost and every sale, with the margin.
