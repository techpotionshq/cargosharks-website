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

**Next, in the order agreed:**

1. Quote drafting — the model writes the covering note; `rating.ts` keeps the
   arithmetic. Drafting is the feature; sending is not.
2. Assistant tools — `list_unbilled`, `get_margin`, `get_customer_credit`,
   `list_quotes_expiring`, `list_consolidation_candidates`. The engines exist;
   the assistant cannot see them. (What it *can* see, `ai/tools.ts`: `search`,
   `get_job`, `list_jobs`, `list_enquiries`, `list_exceptions`,
   `list_free_time`, `list_overdue_invoices`, `get_supplier_variance` — all
   reads, all under the asker's actor — plus `propose_transition`, which
   offers a confirm button and changes nothing. None of the five above is
   among them.)
3. Credit control on a schedule, with dunning through the outbox.
4. Document classification on upload — the lowest-stakes model call, and every
   correction is labelled data.
5. Exception triage — free text into a code and a severity.
6. Rate-card column mapping — still the cheapest useful AI feature.
7. **The evaluation harness, before any further model surface.** The AI design
   document puts it first; three surfaces shipped without it — the two
   extractions and the assistant. The corpus is accumulating in
   `ai_invocations` and in rejected proposals meanwhile.

**Excluded, by decision:** WhatsApp inbound (still a dead letter; leave it) and
backfilling historical enquiries (not needed in a dev environment).

**Blocked:** carrier tracking, on credentials — see §1.
