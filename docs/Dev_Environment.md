# Dev Environment and Automation Roadmap

**Working notes · Internal · last revised 23 August 2026**

| | |
|---|---|
| **Question answered** | Where does the development stack actually live, which parts of it are real external services, and what is the agreed order of the automation work? |
| **Relationship to the code** | Nothing here is derivable from the repository — it is the state of one developer's environment and a set of product decisions. `Operations_Findings.md` §11 records what the first day against these services taught. |
| **Never in this file** | A credential. Every value lives in `.env.local`, which is gitignored; this records only *where* things are. |

---

## 1. Where things live

There is **no local Postgres and no Docker** on the development machine (an
orphaned PostgreSQL 16 data directory exists with no binaries; the schema needs
18 for `uuidv7()` and temporal `WITHOUT OVERLAPS`). Both databases are on the
remote dev server:

| | Database | Used by |
|---|---|---|
| `DATABASE_URL` | `qabandi` | `pnpm dev`, the running service, the real mailbox poll |
| `TEST_DATABASE_URL` | `qabandi_test` | every `describe.skipIf(!enabled)` suite |

`qabandi_test` was provisioned with `db:provision`, `db:migrate`, `db:seed`
and `db:seed-demo`. It is never emptied — `DELETE` is revoked — so see §3.

**Object storage** is Cloudflare R2, bucket `qabandi`. Verify with
`pnpm --filter @qabandi/service verify:storage`.

**Without the R2 credentials, set `FILE_STORE_DRIVER=memory` in `.env.local`.**
The store defaults to `s3`, and an `s3` store with nothing configured refuses
every write: each email attachment and each upload fails with *"Object storage
is not configured"*. `memory` keeps the bytes in the process and loses them at the next restart,
which is acceptable on a laptop and is exactly why it is never a fallback the
code picks for you (`unavailableFileStore` in `apps/service/src/adapters/file-store.ts`
says why). It is here and not in `.env.example` because that file deliberately
lists no integration variables — see its "The integrations are NOT here"
header — and an active `fileStore` row at Settings → Integrations wins over the
variable.

**The dev mailbox is real.** `freight@techpotions.app` on `mail.spacemail.com`
(IMAP 993, SMTP 465) is a `mailboxes` row bound to the **DXB** branch. While
the service is running, anything emailed to that address becomes an enquiry
within a minute, its attachments are stored, and — if the sender resolves to a
known partner — any PDF is read as a supplier bill. Sending from the mailbox to
itself works and is how the pipeline was proven. It is also how the bounce loop
in `Operations_Findings.md` §11 happened: treat it as production-shaped.

**The model** is OpenRouter, `minimax/minimax-m3`. The key is held in the `ai`
row of `integration_settings`, **sealed under `MAILBOX_ENCRYPTION_KEY`** — that
key seals every integration secret, not only mailbox passwords, and a row
sealed under a different key reads as `model: "none"` in the boot log with an
error that used to blame the mailbox. `OPENROUTER_API_KEY` is the fallback
beneath the row. Verify with `verify:model`. Observed cost: about $0.0008 to
read an enquiry, about $0.002 to read a bill.

**Carrier tracking** stays `manual` until Maersk, Hapag-Lloyd and CMA CGM
credentials exist. The adapters are written; there is nothing to build.

## 2. Running it

`pnpm --filter @qabandi/service dev` restarts on every source edit, so a saved
change is live on `:3001` — and polling the real mailbox — within about twenty
seconds. Read the boot log's `inboundMail:` and `model:` lines before testing
either surface. Use the `verify:*` scripts rather than ad-hoc probes.

## 3. Testing against the remote database

- **One suite at a time.** The web and service suites run concurrently against
  `qabandi_test` produce a different single spurious failure each run, from the
  other suite's writes landing between a test's two steps. CI is sequential.
- **Timing.** Web about 8–10 minutes, service about 35–40, over the network.
  Timeouts are 60 s in both configs for this reason; a failure at exactly the
  timeout is the network, not the code.
- **Fixtures accumulate.** A test that asserts exact figures makes its own rows
  (`candidates.test.ts` `freshLane()`); a test that needs a pre-existing row
  creates it rather than assuming a seed ran first.
- `apps/web/test/setup.ts` loads `.env.local` into Vitest. Without it the
  database-backed suites skip silently and report a pass — 627 tests did, for
  weeks.
- **A local database is now an option, and it is the fast path.** A portable
  PostgreSQL 18 (ICU `und-x-icu`, matching prod) runs at `127.0.0.1:5432`; point
  `.env.local` at it and the same suites finish in seconds rather than minutes —
  `test:web` ~15 s and green, `test:db` and `test:service` likewise — because a
  query is sub-millisecond instead of a ~370 ms network round-trip. It is
  per-developer and isolated, so the "one suite at a time" and fixture-collision
  cautions above are the *remote* CI story, not the local loop. The remote stays
  the shared/CI target; swap the two comment blocks at the top of `.env.local` to
  choose. Both remote DBs were migrated to current and `qabandi_test` reset clean
  on 2026-09-28.

## 4. The automation roadmap

The framing: compete with CargoWise on speed-to-quote and on money quietly
leaking, not on feature count. The user wants the whole list done, quickly.

**Shipped and proven against the real services (August 2026):**

- Supplier-bill capture into `core/matching.ts` — the *Read a bill* dialog on
  `/payables`, and bills emailed by a known partner read themselves unattended.
- Enquiry extraction from inbound email into `extraction_proposals`, with the
  review panel on the enquiry page. Accepting is an ordinary write under the
  coordinator's own actor; the three candidate fields resolve by lookup and
  refuse ambiguity.
- The inbound-email webhook consumer — a dead-letter queue since Release One.
- The unbilled-revenue register on `/finance`, with one-click *Draft invoice*.
- Consolidation candidates on `/consolidations` (`core/grouping.ts`, no model).
- The bounce guard on inbound mail, and the `reasoning`-field fallback in the
  model adapter.

**Shipped since (September 2026):**

- Rate procurement — *Request rates* on an enquiry emails the covering agents,
  the model reads each reply (a number in the body, a PDF tariff, a spreadsheet)
  into `rate_requests`, and the enquiry screen ranks them cheapest-first in dinar
  for a one-click buy card; plus the nightly auto-refresh that re-fires an RFQ
  before a buy card lapses (FR-RT-10/11).
- Supplier-invoice variance auto-flag — a bill captured against a job raises an
  internal alert when a line is billed over the accrual tolerance, on the
  extraction write path (FR-FN-09). Over-billing only; caught before finance
  approves, not at month-end.
- Quote covering-note — the model drafts the note; the editor on the draft
  quotation lets a coordinator draft, edit and save it per language; pricing owns
  every figure (FR-EQ-08). Draft-gated; nothing auto-sends.
- **Inbound WhatsApp, through Kapso** — a message to a business number becomes an
  enquiry on the same board as an emailed one, read by the same model and
  acknowledged on the same channel. `whatsapp_numbers` maps each Kapso
  `phone_number_id` to a branch (Settings › WhatsApp numbers), mirroring
  `mailboxes`; `/webhooks/whatsapp` verifies Kapso's `X-Webhook-Signature`; the
  `inbound-whatsapp-webhook` worker shares `ingestMessage` with the email path,
  so the FR-EQ-02 rules are not written twice. The `whatsapp` integration is a
  Kapso driver that ships dark (off by default, email the fallback). Proven
  end-to-end against a live Kapso number. This is the item this file's roadmap
  once listed as *excluded*.
- **The end-to-end auto-pipeline, off by default** — four gated
  `integration_settings` drivers chain the manual pieces into a hands-off
  enquiry→draft-quote run: `enquiryAutoAccept` (apply high-confidence,
  unambiguous extractions), `rateAutoFanout` (RFQ every covering agent on a
  resolved lane), `rateAutoPromote` (award the cheapest reply — `first`/`all`/`wait`
  strategy), `quoteAutoDraft` (price against the house margin into a draft). Each
  ships dark; a person is left only for the ambiguous port/commodity and the send.
  The money-critical halves moved into `@qabandi/db` (`promoteRateReply`,
  `priceEnquiryToQuote`, `resolveProposal`) so the sweep and the buttons write the
  same rows. See `docs/Automation_Opportunities.md §7`.

**Next, in the order agreed:**

1. ~~Quote drafting~~ — **shipped.** The covering note (above) and the auto-draft
   worker (§7): a covered enquiry is priced against the house margin into a draft
   quotation. `rating.ts`/`priceEnquiryToQuote` keep the arithmetic. Drafting is
   the feature; sending is not, and stays human.
2. ~~Assistant tools~~ — **shipped.** `list_unbilled`, `list_quotes_expiring`,
   `get_margin`, `get_customer_credit` and `list_consolidation_candidates` now
   read through `ai/tools.ts`, alongside `search`, `get_job`, `list_jobs`,
   `list_enquiries`, `list_exceptions`, `list_free_time`,
   `list_overdue_invoices` and `get_supplier_variance` — all reads, all under
   the asker's actor — plus `propose_transition`, which offers a confirm button
   and changes nothing. Each new tool reuses the engine the matching screen uses
   (`unbilled.ts`, `jobMargin`, `creditStanding`, `clusterShipments`) so the
   assistant cannot give a second answer to a question the screen answers.
3. Credit control on a schedule, with dunning through the outbox.
4. Document classification on upload — the lowest-stakes model call, and every
   correction is labelled data.
5. Exception triage — free text into a code and a severity.
6. Rate-card column mapping — still the cheapest useful AI feature.
7. ~~The evaluation harness~~ — **shipped (first cut).** `pnpm --filter
   @qabandi/service ai:eval` replays the `ai_invocations` corpus through the pure
   parsers and scores parse-ok, reconcile, self-consistency, field coverage and
   confidence — no model spend, no golden set needed — with `--compare <a> <b>`
   to diff two prompt versions. Covers `invoice_extract` and `enquiry_extract`;
   the label-based pass (agreement with what a coordinator accepted, from
   rejected proposals) is the additive second cut, and a per-field golden set is
   the richer form the doc envisions after that.

**Excluded, by decision:** backfilling historical enquiries (not needed in a dev
environment).

**Blocked:** carrier tracking, on credentials — see §1.
