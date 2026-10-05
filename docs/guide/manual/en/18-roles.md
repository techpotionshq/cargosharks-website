---
title: "Roles: who sees and does what"
routes: [/settings/users]
messages: [settings.areas.support.title]
---

# Roles: who sees and does what

::: intro
Seven roles ship with the product. Your administrator can adjust the permission list without a new release.
:::

| Role | In one line | Two-factor |
|---|---|---|
| Administrator | Everything, including anything a future release adds. | Required |
| Finance | Invoices, receipts, supplier bills and payments, duty paid, settlements. Nothing operational. | Required |
| Operations Manager | Everything a coordinator does, plus cancelling and closing shipments, rate cards, partners and reference data. | No |
| Coordinator | Moves shipments forward: booking, milestones, documents, customs, capturing supplier bills. | No |
| Sales | Enquiries and quotations, accepting and rejecting quotes, closing enquiries won or lost. | No |
| Customs Broker | Customs declarations, duty paid, and the shipment dates clearance depends on. | No |
| Read Only | Sees shipments and reports. Changes nothing. | No |

## A few permissions worth knowing

| Action | Admin | Finance | Ops Mgr | Coord | Sales | Customs | Read |
|---|---|---|---|---|---|---|---|
| Price an enquiry, send a quotation | ● | ○ | ● | ● | ● | ○ | ○ |
| Accept or reject a quotation, close won or lost | ● | ○ | ● | ○ | ● | ○ | ○ |
| Book and update shipments | ● | ○ | ● | ● | ○ | update only | ○ |
| Cancel, complete or close a shipment | ● | ○ | ● | ○ | ○ | ○ | ○ |
| Issue and release documents | ● | ○ | ● | ● | ○ | ○ | ○ |
| Create or change rate cards, request rates | ● | ○ | ● | ○ | ○ | ○ | ○ |
| Issue, void or credit an invoice; record a receipt | ● | ● | ○ | ○ | ○ | ○ | ○ |
| Capture a supplier bill | ● | ● | ● | ● | ○ | ○ | ○ |
| Approve and pay a supplier bill | ● | ● | ○ | ○ | ○ | ○ | ○ |
| Read reports | ● | ● | ● | ○ | ● | ○ | ● |
| Users, roles, support access, integrations | ● | ○ | ○ | ○ | ○ | ○ | ○ |

● allowed · ○ not allowed. The full matrix of permissions is on [Settings]{.ui}, [Users & roles]{.ui}.

::: note
**Separation of duties**

Finance alone issues invoices and approves supplier payments; operations cannot. Coordinators move work forward; only a manager reverses it. Branch separation is enforced by the database itself, so a record in a branch you do not hold simply shows as not found.
:::
