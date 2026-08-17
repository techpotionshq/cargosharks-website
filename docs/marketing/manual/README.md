# User manual

**Find your role. Read that chapter. Read the orientation first if it is your
first day.**

---

## Start here

[**Getting started**](00-orientation.md) — signing in, two-factor, branches,
the language switch, and the five behaviours of this system that will otherwise
surprise you. Twenty minutes, once.

---

## Then your role

| If you are | Read | You will spend most of your time in |
|---|---|---|
| Moving shipments day to day | [**Coordinator**](01-coordinator.md) | Dashboard, Shipments, Enquiries |
| Running the operation | [**Operations Manager**](02-operations-manager.md) | Dashboard, Exceptions, Rate cards |
| Answering enquiries and quoting | [**Sales**](03-sales.md) | Enquiries, Quotations |
| Invoicing and chasing money | [**Finance**](04-finance.md) | Finance overview, Invoices, Payments |
| Clearing cargo | [**Customs Broker**](05-customs-broker.md) | Customs |
| Running the system itself | [**Administrator**](06-administrator.md) | Settings |

Chapters are cumulative where roles are: the operations manager's chapter assumes
you have read the coordinator's, and does not repeat it.

---

## To hand out

These two are written to be sent under your own brand. They name no software and
carry no supplier logo. Replace the bracketed tokens at the top and delete the
note.

| | |
|---|---|
| [**Tracking your shipments**](07-customer-portal.md) | **For your customers.** The public tracking page and the portal. |
| [**Agents and partners**](08-agent-portal.md) | **Read this yourself first.** The agent portal is a scaffold in this release, and this chapter says what to tell an agent in the meantime. |

---

## Reference

[**Who can do what**](09-permissions-reference.md) — the full permission matrix,
the four deliberate separations of duty, and the answers to the questions an
auditor asks. Keep this to hand before granting anyone a role.

---

## What is not in this release

Collected in one place so nobody spends an afternoon looking:

| | Status |
|---|---|
| Automatic carrier tracking feeds | Not in this release. Milestones are entered by your team. |
| Direct customs filing, Kuwait | **Not planned.** Declarations are tracked, not filed. |
| UAE MPCI filing | Roadmap |
| Saudi ZATCA e-invoicing | Roadmap |
| Agent portal — RFQ response, agent posting | In delivery. Route scoped, screens not built. |
| Email and WhatsApp notifications | In delivery |
| Scheduled email reports | In delivery. Every screen exports today. |
| Accounting-package connectors | Export today, connectors later |
| Self-service password reset | Needs a mail transport. Administrator resets today. |
| A user-invitation screen | Accounts are created from a shell. |

**If your supplier tells you one of these has shipped, ask to see it on your own
deployment.** This table is maintained against the working software rather than
against a plan.

---

## Conventions in these chapters

| | |
|---|---|
| **Screen names** | Written as they appear: *Operations → Customs* |
| **Permission keys** | In `code`, e.g. `invoice.issue` — send the key to your administrator, not a description of the screen |
| **In delivery** | Scaffolded, being finished, has a release |
| **Not planned** | Will not be built, with the reason given |

Nothing in this manual describes a capability the software does not have. Where a
chapter would naturally describe one, it says so instead — chapter 8 is the
clearest example, and it is the model for the rest.
