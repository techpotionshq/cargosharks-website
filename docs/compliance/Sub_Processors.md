# Sub-processors

*Every third party that can hold or see customer data, what it does, and what
happens if it is switched off.*

Last reviewed: **2026-10-02**.

A customer's data-protection addendum will require this list, a notice period
before it changes, and a right to object. **The notice period and the objection
mechanism are not yet agreed** — see [`Decisions_Required.md`](Decisions_Required.md),
items 10 and 27.

The design principle worth stating first: no supplier-hosted component sits in
the runtime path (NFR-17). Every entry below is either configurable per
deployment, or optional, or both. A customer who will not accept a given
processor can be run without it, and the column that says so is the one their
reviewer should read.

---

## Processing customer personal data

| Processor | Purpose | Data reaching it | Can it be turned off? |
| --- | --- | --- | --- |
| **Hosting provider** *(not chosen)* | Runs the application, the database and the object store | All of it | No — but the region and the provider are the customer's choice, and the whole deployment can be run in the customer's own cloud account |
| **Object storage** — S3-compatible; Cloudflare R2 in the reference deployment | Bills of lading, invoices, proof-of-delivery photographs, correspondence attachments | Documents and their metadata | No, but the driver is pluggable (`adapters/file-store.ts`) and any S3-compatible endpoint, including a self-hosted one, is configuration |
| **SMTP provider** *(per deployment)* | Sends quotes, invoices, notifications, password-reset links | Recipient addresses, message bodies, attachments | No. The address is configuration; the provider is the operator's |
| **IMAP mailbox provider** *(per deployment)* | Reads the inbound enquiry mailbox | Whatever a customer or agent emails in | Yes — mailbox polling is per-row configuration at Settings → Mailboxes |
| **OpenRouter** (`openrouter.ai`) | The AI surface: enquiry extraction, the assistant | Enquiry text and document extracts submitted for extraction | **Yes.** Unset the key and the surface disappears from the navigation. This is the one to switch off for a customer with residency obligations |

## Not processing personal data

| Service | Purpose | What it receives |
| --- | --- | --- |
| **Carrier APIs** — Maersk, Hapag-Lloyd, CMA CGM, DCSA endpoints | Container and shipment tracking | Container and bill-of-lading numbers. No personal data |
| **`open.er-api.com`** | Daily exchange rates | Nothing. An outbound request for public rates |
| **aisstream.io** (`stream.aisstream.io`) | Vessel positions (AIS) for ships on open sea jobs. Off by default; on only when an administrator sets the `vesselPositions` integration | The MMSIs of those vessels and the deployment's API key. No personal data and no customer or job identifiers |
| **`tiles.openfreemap.org`** | Map tiles and glyphs for the lane map | The viewer's IP address and the tiles requested, by virtue of the request |
| **Google Fonts** (`fonts.googleapis.com`, `fonts.gstatic.com`) | Three typefaces | The viewer's IP address and user agent |

### The fonts are a known and cheap problem

Loading fonts from Google discloses every visitor's IP address to a third party
on every page, including on the signed-out tracking page. Some regulators have
treated that as a transfer requiring a basis of its own.

The fix is to self-host the three families, which is a build-time change of
perhaps an hour and removes the entry from this table entirely. It is currently
declined for a stated reason — a build that reaches the network to succeed
fails in a room with no internet, which the pilot rehearsal depends on — but
that reason applies to the *build*, not to serving the files from our own
origin. **Recommendation: self-host before launch.** It is cheaper now than it
is to defend later. Item 6 in `Decisions_Required.md`.

## Not sub-processors

Named because reviewers ask, and because the answer is short:

- **GitHub** — source code and CI. No customer data. CI runs against ephemeral
  throwaway databases seeded with fixtures.
- **Anthropic / Claude Code** — used in development against the repository. Not
  in the runtime path and not connected to any customer deployment.
- **Sentry or an equivalent error tracker** — not currently configured.
  OpenTelemetry is wired with no exporter registered, and the actor transaction
  deliberately attaches the tenant's *id* and never the customer's name, so that
  a telemetry backend does not become a second copy of the data with weaker
  access control. Whichever exporter is eventually chosen becomes an entry here.

## When this list changes

Adding a processor is a change to this file **and** a notice to every customer
under whatever the agreed period turns out to be. The file is versioned in the
repository so the history is the evidence of when a change was made.
