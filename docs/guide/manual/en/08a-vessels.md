---
title: Vessel positions
routes: [/jobs/[id], /dashboard, /portal/shipments/[id], /agent/shipments/[id], /settings/integrations]
messages: [vesselPosition.title, vesselPosition.edit, vesselPosition.confirm, integrations.keys.vesselPositions]
components: [apps/web/src/features/vessels/ui/vessel-position-card.tsx, apps/web/src/features/vessels/ui/vessel-dialogs.tsx]
---

# Vessel positions

::: intro
Where the ship carrying a shipment was last heard, from the signals ships broadcast at sea (AIS).
:::

## What it is for

Ships at sea broadcast their identity, position, speed and course. When the integration is switched on, the system follows the vessel on each open sea shipment and shows its last known position on the shipment file, in the customer's portal and on the agent's shipment page. The dashboard map draws a dot for each vessel it has heard from.

![**The {app:vesselPosition.title} card** on a shipment in transit: where the ship was last heard, how long ago, its speed and course.](shot:/jobs/job-1046?scroll=section.rounded-card:has(h2:text-is("{app:vesselPosition.title}"))&crop=section.rounded-card:has(h2:text-is("{app:vesselPosition.title}")))

## Reading the card

-   **Current** means the ship was heard recently. **Last known** means it has not been heard for a while, usually because it is out of range of the coastal receivers, and the card says how long ago.
-   **Destination and ETA reported by the vessel** are typed into the ship's transponder by its crew. They are shown for information and are not your ETA; the shipment's own arrival date stays the one your team records.
-   The source of every position is named on the card.

## Telling the system which ship it is

A ship is identified by its **MMSI** (nine digits, used by AIS) and its **IMO number** (seven digits, which stays with the ship for life). The carrier's schedule or a vessel database shows both.

::: steps
1.  On the shipment, open [{app:vesselPosition.edit}]{.ui} on the card and enter the MMSI, and the IMO number if you have it.
2.  When only the vessel's name is on the shipment, the card may offer a **possible match** it has heard on AIS. Check the IMO number, then press [{app:vesselPosition.confirm}]{.ui}. Nothing shows until a person confirms the ship.
:::

![**A possible match.** The name matches a ship heard on AIS; a person confirms it before positions show.](shot:/jobs/job-1048?scroll=section.rounded-card:has(h2:text-is("{app:vesselPosition.title}"))&crop=section.rounded-card:has(h2:text-is("{app:vesselPosition.title}")))

![**The dashboard map** with the last known position of each vessel.](shot:/dashboard?scroll=text=Where the cargo is)

## Switching it on

Vessel positions are an integration, off by default. An administrator turns it on under [Settings]{.ui}, [Integrations]{.ui}, [{app:integrations.keys.vesselPositions}]{.ui}. The free service it uses has coastal receivers only: it covers China, Singapore and Europe well, and the Gulf not at all, so a ship approaching Kuwait often shows as last known until it is in port.

![**Settings, Integrations, {app:integrations.keys.vesselPositions}.**](shot:/settings/integrations?scroll=section.rounded-card:has(h2:text-is("{app:integrations.keys.vesselPositions}"))&crop=section.rounded-card:has(h2:text-is("{app:integrations.keys.vesselPositions}")))
