---
title: The agent portal
routes: [/agent, /agent/shipments/[id]]
messages: [agent.backToShipments]
---

# The agent portal

::: intro
Where your overseas partners see the shipments they are named on.
:::

## What it is for

An agent contact signs in at the same page as everyone else and lands on **Assigned shipments**: every shipment where their company is engaged as a partner, with its route, stage, estimated arrival and next step. They see nothing else.

![**The agent portal.** Shipments where the agent's company is named.](shot:/agent?who=agent)

## Opening a shipment

An agent can open any shipment on the list to see a read-only page: the route, the milestones, the containers and the references they need. Nothing on it can be changed. [{app:agent.backToShipments}]{.ui} returns to the list.

![**A shipment as the agent sees it.** Read-only, and only the shipments their company is named on.](shot:/agent/{first:/agent}?who=agent)

## Good to know

-   An agent login is created for a partner by whoever operates your deployment. It carries no branch role, so an agent can never see your other records.
-   Rate requests still arrive by email, and replies come back to the enquiry automatically.
-   An agent appears on a shipment once you [Engage a partner]{.ui} on it.
