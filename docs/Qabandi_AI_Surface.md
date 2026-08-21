# The AI Surface — Where a Model Earns Its Place, and Where It Does Not

**Research note for Release Two · v1.0 · Internal**

| | |
|---|---|
| **Prepared by** | techpotions |
| **Date** | 21 August 2026 |
| **Question asked** | Where can this platform use a language model — email intake, rate cards, document extraction, lane selection, an assistant — what does each one cost us in risk, and in what order should they be built? |
| **Relationship to the code** | Read against SRS §11, which defers AI intake to R2 and says why, and Architecture §10, which admits a port only with a named second implementation. Companion to `Integration_Landscape.md`: that one researches services we connect to, this one researches a capability we would add. |
| **Status** | Research. No code changed. Every file cited was read against the working tree at `4ff52c6`; nothing below assumes a subsystem that does not exist. |

> **The finding in one line:** this codebase is unusually ready for a model and the reason is that nobody built it for one — the draft states, the transition table and `withActor` are already the harness — and the highest-value item is not intake but supplier-invoice extraction, which switches on a matching engine that is written, tested and sitting idle for want of rows.

---

## 1. The three properties that make this cheap

Every argument in this note rests on the same observation, so it goes first.
Three things exist today, were written for reasons that had nothing to do with
artificial intelligence, and turn out to be exactly what a model needs around
it. None of them has to be built, and that is most of the cost of the feature.

`AI-01` **Every write already lands in a draft state a human must release.**
Quotes start `draft`. Invoices start `draft`. A document is invisible to the
customer until `released_at` is stamped. Nothing leaves the building without
passing through `notification_outbox`. A model writing into those states is
not a new risk surface — it is a new author of rows the product already
refuses to act on unsupervised. The usual first question about an AI feature
is *what stops it doing something irreversible*, and here the answer predates
the question.

`AI-02` **The permission model is already a machine-readable tool manifest.**
`packages/core/src/states.ts` declares every legal transition as data —
`{ from, to, requires, label }` — across enquiries, quotes, jobs, customs and
invoices, and `assertTransition` and `assertCan` refuse everything else. An
agent that proposes *enquiry: assigned → rating* is checked by code that
exists, is tested, is bilingual at the label, and does not know or care that a
model asked. `check-permissions.mjs` already fails the build when the
application enforces a permission `core` has not declared, which means the
manifest cannot silently drift away from what is enforced.

`AI-03` **There is no un-actored path to the database.** `withActor` stamps the
acting principal into transaction-local settings that the RLS policies read.
An assistant that runs under the requesting user's actor cannot return a row
that user could not have opened in the interface — the isolation is enforced a
layer below anything a prompt can reach, which is the only place tenancy
should ever be enforced against a component that reads attacker-influenced
text.

Stated the other way round: the expensive part of shipping a model safely is
usually building the review queue, the authority model and the blast-radius
limit. All three are here, and they were paid for by §5 and §7.

---

## 2. What the SRS already decided, and why it still holds

`AI-04` §11 defers *AI intake and automatic replies* to R2 on the grounds that
parsing an emailed booking into structured fields "needs a body of real
Al-Qabandi messages to train and evaluate against. Release One creates that
body. Building it first would be guessing."

That reasoning is correct and this note does not argue with it. It argues
something narrower, in two parts.

**Several items below are not intake and need no corpus.** A rate sheet is its
own ground truth — the columns are visible, the mapping is checkable in the
console, and a wrong guess costs a dropdown. Document type classification is
scored against a seed table an administrator maintains. Neither waits on
anything.

**For the items that do need the corpus, the thing to build first is the
harness, not the model call.** §11's precondition is a body of messages *to
evaluate against*, and an evaluation set is a deliverable in its own right —
it does not appear as a side effect of a year of traffic. §10 of this note
puts it first for that reason.

---

## 3. Where it attaches

Every row is an existing seam. Nothing here proposes a new subsystem; each is
a worker, an adapter, or a proposal row hanging off machinery that already
runs.

| Seam | What already exists | What a model adds | Gate |
|---|---|---|---|
| Inbound email | `workers/inbound-mail.ts` — receipt, attribution, threading, SLA clock, attachments stored | Fills the twelve cargo columns on `enquiries` that are null on every email-born row today | Needs corpus |
| Rate-card import | `core/import.ts` — `autoMap`, `validateImport`, `groupRateCards` | Proposes the column `Mapping` a human would otherwise draw by hand | Ready now |
| Uploaded documents | `assets` and `documents` — typed, versioned, release-gated | Classifies the type; extracts the fields the type implies | Ready now |
| Supplier invoices | `core/matching.ts` — tolerance, variance, over/under verdicts | Turns a PDF into the `supplier_invoice_lines` the engine needs to run at all | Ready now |
| RFQ responses | `rate_requests.response` — jsonb, "as received, before they become a rate card" | Parses the agent's reply into that column, and then into card lines | Needs corpus |
| Operator assistance | Feature queries under `withActor`; transitions under `assertCan` | Natural-language routing to those functions, in both languages | Ready now |
| Partner selection | `partner_coverage`, lane-indexed rate cards, FR-AP-08 metrics | Explains and shortlists; never scores | R2 |

---

## 4. Email intake — the twelve null columns

**FR-EQ-02 · `apps/service/src/workers/inbound-mail.ts`**

The hard half of intake is done, and it is the half nobody enjoys writing. The
worker claims its receipt before it does the work so a crash retries rather
than dropping mail, matches the sender to a customer on an exact contact
address and only then on a domain belonging to exactly one customer, refuses
ambiguity in both directions, threads a reply onto the enquiry or job it
quotes, starts the four-working-hour SLA clock against the branch's calendar,
and sanitises every attachment filename on its way into a storage key.

`AI-05` **What it cannot do is read the mail.** `createEnquiry` inserts a
reference, a branch, a contact, the subject as `notes`, and the two SLA
timestamps. Everything that describes the shipment — `mode`,
`trade_direction`, `origin_id`, `destination_id`, `commodity_id`, `incoterm`,
`ready_on`, `gross_weight_kg`, `volume_cbm`, `pieces`, `dimensions`,
`is_dangerous` — is null, and a coordinator retypes it out of a body sitting
three inches above the form. That retyping is the entire feature, and the
worker's own comment names the shape of what is being retyped: *"RFQ 2x40HC
Shanghai to Shuwaikh"*.

The attachment point is a job enqueued by `handleMessage` **after** the enquiry
is committed, never before. Extraction is an enrichment of a row that already
exists; a model that is slow, rate-limited or wrong must not be able to cost
us an enquiry, because an enquiry that never arrived is a customer who went
elsewhere.

`AI-06` **`core/import.ts` is already the validator for this.** It is a
complete engine for turning untrusted rows into our shape: typed cell parsers,
Arabic-Indic digit normalisation, reference-table lookups through
`ImportLookups`, and an all-or-nothing report with per-row issues. A language
model is just another untrusted row producer. Point an `ImportDescriptor` at
the extraction output and every validation rule, every error message and every
bilingual label comes for free — and the extraction inherits a test suite that
runs in a millisecond against no infrastructure. A model must never emit
`origin_id`; it emits a candidate, and `lookup()` decides whether that
candidate is a location we have.

`AI-07` **The trust boundary moves, and it moves onto attacker-controlled
text.** The worker's header says it plainly: *nothing here trusts the sender*.
Display names, subjects and filenames are all attacker-controlled, and today
none of them is interpreted — they are stored as data and never interpolated.
A model reading that body would be the first component in this system that
*interprets* hostile text, so the boundary has to be drawn where it cannot be
argued with by a cleverly worded email:

- extraction may propose cargo facts, and nothing else;
- it may not select a customer, and may not break an attribution tie;
- it may not set a permission, and may not cause a send.

Attribution stays in `inbound-routing.ts` — pure, deterministic, and refusing
two candidates as firmly as it refuses none. That file's worst failure is one
customer's correspondence appearing in front of another through the portal,
and a confident tie-break is precisely how that failure is produced. Ranking
candidates for a human is fine. Resolving is not.

**Never overwrite; always propose.** Extraction lands as a proposal carrying a
value, a confidence and the span of source text it came from, so a coordinator
reads *"2 × 20'GP, from line 4"* and accepts or ignores it. A field a human
has already typed is never touched. Acceptance is an ordinary audited write by
that person's actor, which means the audit trail answers *who put this on the
shipment* without inventing a new concept to answer it.

**Arabic is not an edge case here.** Five branch mailboxes across Kuwait,
Qatar and the UAE take enquiries in both languages, frequently mixed inside
one message. That is the strongest argument for a frontier model over a rules
pass or a classical extraction pipeline, and it is also why the evaluation set
has to be bilingual from the first day rather than English with an Arabic
annex added later.

---

## 5. Rate cards — mapping is the feature, parsing is the bonus

**FR-RT-09, FR-RT-10 · `packages/core/src/import.ts`**

The importer already draws the distinction that matters, and the AI work
follows it exactly. Master data comes in *against* a published template — we
dictate the columns, so auto-mapping is a convenience. Rate cards come in
*through* a mapped template — the agent dictates the columns, there are dozens
of agents, and the mapping is the user's decision and must stay overridable.

`AI-08` **The cheapest useful AI feature in this repository is a column-mapping
suggestion.** `autoMap()` matches header names and does well on `Origin` and
`Currency`. It has no chance on `20'DC ALL-IN USD (SUBJ GRI)`, which is
simultaneously a charge type, a basis, a container restriction and a currency,
and which is what an agent tariff actually looks like. A model reads the
header row and three sample rows and emits a `Mapping` — the same
`Readonly<Record<string, number | null>>` the console already accepts, still
overridable, still re-usable, still validated by `validateImport`. The output
type is unchanged, so nothing downstream knows a model was involved, and the
feature can be switched off by not calling it.

The harder half is a card that never was a spreadsheet: a PDF tariff, or rates
as prose in a mail body. Extract to rows, run them through the same validator,
and hand them to `groupRateCards()`, which already folds flat rows into cards
and lines by `rateCardKey`. The pipeline exists; only the front of it is new.

`AI-09` **The database refuses a bad validity range on its own.** `rate_cards`
carries a `daterange` with `unique (direction, partner_id, customer_id, mode,
origin_id, destination_id, validity without overlaps)`. A model that misreads
*"valid till end March"* into an overlapping window does not produce a quietly
wrong quote weeks later; it produces an insert that fails. The exclusion
constraint was written to make ambiguous pricing unrepresentable rather than
merely unlikely, and it does that job against a model exactly as well as
against a person.

FR-RT-10 has a landing zone waiting. `rate_requests.response` is jsonb and
commented as "the quoted lines as received, before they become a rate card" —
which is precisely where a parsed agent reply belongs. The raw quote is
preserved as received, the structured reading sits beside it, and promotion to
a real rate card stays a deliberate act by somebody who can be named.

---

## 6. Document extraction, in order of what it is worth

Uploaded documents are already typed, versioned and release-gated, and
`generated_from` already distinguishes a file the system produced from a scan
a coordinator uploaded. Extraction enriches a row that exists; it is never a
precondition for storing the file.

`AI-10` **Supplier invoices are the largest return, and it is not close.**
`core/matching.ts` is built, argued and tested. It compares quoted against
accrued against billed, applies a two-limit tolerance so a rounding difference
on a 2 KWD documentation fee does not flag while a 400 KWD drift on an ocean
freight does, refuses to match a supplier line above what was billed, and
deliberately *permits* matching above the accrual because that overage is the
finding the module exists to surface.

It runs on rows that somebody types in by hand today. The most common argument
in a forwarder's week is the agent billing something other than what they
quoted, and the engine that settles it is idle until the lines exist.
Extraction here does not add a capability — it switches on one that is already
written and already paid for. The model extracts operands only; every
subtraction, tolerance test and verdict stays in `compareToAccrual`, on
`Decimal`, because KWD carries three decimals and a model doing arithmetic is
a model producing a plausible number.

`AI-11` **Document type classification is the cheapest thing on this list.**
Pick `document_type_id` on upload instead of asking. `document_types` is a
seed table an administrator edits, so the label set is configuration and the
classifier reads it at call time rather than hard-coding a list. A wrong guess
costs one dropdown correction, the correction is audited, and the corrections
accumulate into the evaluation set for everything else in this section.

`AI-12` **Bills of lading and air waybills: verify, do not trust.** Container
and equipment references, vessel and voyage, gross and chargeable weight and
piece counts feed `job_cargo` and milestone capture while carrier feeds remain
an R2 commercial decision. Container numbers carry an ISO 6346 check digit, so
a pure function in `core` can reject a hallucinated `MRKU1234567` outright.
The rule generalises: wherever a format verifies itself, verify it and discard
the model's confidence score, which is an opinion where arithmetic is
available.

`AI-13` **Customs paperwork is suggest-only, and the line does not move.**
Arabic declarations, delivery orders and duty assessments are where generic
OCR is weakest and a vision model is markedly stronger — and they are also
where a wrong reading has legal consequence. Extract references, dates and
stage transitions for a coordinator to confirm; propose an HS code with its
reasoning and the `duty_rates` row it implies. File nothing. R1 captures
declaration references and does not file them, and a model does not change
that boundary — SRS §11 defers direct single-window filing on access grounds,
not on capability grounds.

**Idempotency is already in the schema.** `assets.checksum` means every
extraction can be cached by content hash: the same scan re-uploaded against a
second job costs nothing, and a prompt revision can be replayed across the
whole corpus by hash to see exactly what changed. `assets.meta` is jsonb and
currently unused, which is where the pointer to an extraction belongs.

---

## 7. The assistant

**FR-ID-03 · `packages/core/src/states.ts`, `apps/web/src/features/`**

What makes a good product assistant feel like software rather than a chatbot is
that it has no private idea of what is true: it reads through the same queries
the interface reads through, writes through the same mutations, and can be
handed work like a colleague. All three have a precise counterpart here.

`AI-14` **Reading is tools over existing queries, never generated SQL.** Every
feature slice exposes typed query functions that run inside `withActor`.
Expose those as the assistant's tools and RLS scopes the answer to the asker
automatically — a Doha coordinator asking *which jobs are stuck in clearance
past five days* gets Doha's jobs because the policy says so, not because the
prompt was careful. Generated SQL steps outside the typed layer and outside
the branch policies in the same move, to buy flexibility nobody has asked for.

`AI-15` **Writing is the transition table, unchanged.** `states.ts` is a tool
schema that already exists, is already enforced, and is already covered by a
lint check. An agent proposing an illegal transition is refused by the same
code that refuses a button, and the refusal is a `DomainError` with a code
rather than a model changing its mind.

`AI-16` **Authority is a principal with a role, not a code path.**
`PrincipalType` already includes `system`, and `SYSTEM_PRINCIPAL_ID` exists so
that nightly accruals are attributable rather than anonymous. An assistant
acting on its own — triaging exceptions, drafting a status reply — should be
its own principal with its own row in `roles` and its own `role_permissions`.
Then *what the AI is allowed to do* is configuration an administrator edits
without a release, which is the rule the platform already applies to charge
types and milestone templates (FR-AD-03). `exceptions.owner_id` references
`principals`, so it can be assigned an exception today with no migration.

**Two actors, and never the other way round.** Background extraction runs as
`systemActor`, because it is background work and should be attributable as
such. Anything answering a person runs as *that person's* actor, so the
assistant cannot become a hole in tenancy. The failure mode to design against
is a convenience wrapper that reaches for the system actor "just to look
something up"; the cleanest defence is that the assistant is handed a `Tx`
rather than being able to open one.

**A naming collision worth settling before anything is written.**
`apps/web/src/app/(agent)` is the overseas *agent* portal — a freight partner,
a human company, with a layout and a login. Whatever the AI surface is called,
it must not be called that. *Assistant* is free and unambiguous in this
domain.

**Where it belongs in the interface.** Not a floating bubble. A command
palette over the existing nav, an inline draft action on the enquiry and
exception screens, and a review queue where proposals accumulate — the last of
which is the same shape as the exceptions register that already exists, and
should probably reuse it.

---

## 8. Lanes and partners — where the honest answer is arithmetic

**FR-AP-08 · `partner_coverage`, `rate_cards`, `job_milestones`**

*Who should I send this RFQ to for Jebel Ali → Shuwaikh LCL?* is a real
question with a real index behind it: `partner_coverage` is keyed on mode,
origin and destination with a transit time and a country-level fallback, and
`rate_cards` carries the composite lane index §12's two-second coverage budget
depends on.

`AI-17` **A model must not become the shortcut around a score we have not
earned.** SRS §11 defers weighted agent scoring because a score combining
price, punctuality, responsiveness and claims needs a period of real data
before its weights mean anything, and R1 is busy measuring the inputs. That
reasoning survives contact with a language model completely unchanged.
Response rate, average response time, on-time milestone rate and jobs awarded
are arithmetic over recorded facts. Keep them arithmetic. A fluent paragraph
that ranks three agents without a number behind it is worse than no ranking,
because it is a guess wearing the tone of an answer.

What a model does add here is language, in two places worth building:

- **Explaining the shortlist.** The ranking stays deterministic; the sentence
  under it — *"three of your last four Jebel Ali consolidations went via this
  agent, average transit nine days against a quoted seven"* — is generated,
  cites the job references it drew on, and is written in both languages.
- **Retrieval over our own closed jobs.** *How have we routed out-of-gauge
  from Antwerp before?* is answerable from `jobs`, `job_milestones` and
  `charge_lines`, and only from those. Grounded in the tenant's own history
  under RLS and citing references, it is genuinely useful; answered from a
  model's world knowledge it is a liability with a confident tone.

`AI-18` **ETA and dwell prediction is statistics, not a language model.**
`job_milestones` against `milestone_templates`, and `free_time_clocks` against
actual release dates, give the distributions needed to predict demurrage
exposure before it is owed. That is worth building and it is a regression, not
a prompt. Saying so is part of the recommendation: the value of naming the
non-AI answer is that it stops the AI budget being spent on it.

---

## 9. Fitting the house rules

The platform's rules are not obstacles to route around. Each one has a
specific implication for how a model is wired in, and the implications are
mostly improvements.

| Rule | What it forces |
|---|---|
| **No abstraction without a named second implementation** | A ninth port, only because it earns the rule. First implementation: a frontier vision-and-text model. Named second: a regionally hosted model, because GCC data residency is a live commercial question for a client whose customs paperwork is the payload. A third, deterministic driver mirrors `QABANDI_PILOT_FIXTURES=1` — fixed responses, no network — so `test:core` stays at 1.4s and the pilot demo runs on a plane. |
| **`core` imports nothing** | No model call in `core`, ever. But the extraction schemas, the reference resolvers, the confidence policy and the "does this proposal contradict a human-entered value" check are pure functions and belong there, which is what keeps the interesting logic inside the fast suite. |
| **Money is decimal** | Models emit strings, which is fine — parse to `Decimal` at the boundary and never let one add. `calcCharge`, `priceLines`, `summariseMargin` and `compareToAccrual` already do the arithmetic and already respect three-decimal KWD. |
| **Nothing is deleted** | A rejected proposal is `closed_at`, not gone. That is not bookkeeping piety: rejections are the highest-signal evaluation data this system will ever produce, and deleting them throws away the only record of where the model is wrong. |
| **Both languages, always** | Every generated string needs `en` and `ar`, and `check-messages.mjs` will say so. Generate in the target language rather than translating, and hold generated Arabic to the same logical-property discipline in the UI as any other string. |
| **Configuration is rows, not code** | Thresholds, per-document-type confidence floors and which surfaces are enabled belong in seed rows an administrator edits, following `notification_templates`. Prompts are the exception — see `AI-20`. |
| **Jobs enqueue inside the transaction** | Extraction is enqueued in the same transaction as the row it enriches, so a model call never exists for a write that rolled back. pg-boss already gives retries with backoff and keeps failures for a month, which is the right default for a call that leaves the building. |

`AI-19` **One new table, and it pays for itself three times.** An
`ai_invocations` ledger — surface, model, prompt version, input hash, token
counts, cost, latency, the raw response, and what the human did next. It is
the audit trail an immutable system requires, the cost control the client will
ask for by month two, and the evaluation corpus and regression suite for every
prompt change after that. It needs a hand-written RLS policy like every other
table, and `pgTable` imported from `./table` so the coverage tests can see it.

`AI-20` **Prompts stay in the repository, and this is the one place the
configuration rule should not be extended.** Everything else in this platform
is better as a row an administrator can edit. A prompt is worse, because an
evaluation result that does not describe the prompt running in production
describes nothing — and a prompt is code with a test suite, not a setting. The
*thresholds* around it are rows; the text is versioned where the tests are.

---

## 10. Build order

Genuinely ordered. Each step is cheaper or safer because the one before it
exists.

1. **The evaluation harness, before any model call.** A golden set of real
   messages and scans with expected structured output, scored per field, run
   as a script in the same family as the six invariant checks. Without it
   every prompt change is a guess and nobody can say whether last week's edit
   helped. This is the concrete form of §11's "R1 creates that body" — and it
   is worth confirming now that the raw MIME of inbound mail is retained,
   since `InboundMessage` hands the worker flattened text and the corpus wants
   the original.
2. **Rate-card column mapping.** Output type unchanged, validation unchanged,
   human still confirms. Days of work, immediate relief on the FR-RT-09 path
   that every agent onboarding runs through, and no corpus required because
   the sheet is its own ground truth.
3. **Document type classification on upload.** Lowest stakes in the system,
   and every correction an operator makes is labelled data for step four.
4. **Supplier invoice extraction.** The largest business return, because it
   switches on a matching engine that is already written, already tested and
   currently idle for want of rows.
5. **Email intake enrichment.** Once the corpus is real and bilingual, and
   once steps two through four have established the propose-and-accept pattern
   in the interface. This is §11's item, arriving when its stated
   precondition has actually been met rather than assumed.
6. **The assistant.** Read-only tools first, answering under the asker's
   actor. Transitions only after the read side has run long enough to show
   what people actually ask for, which is not knowable in advance and is
   cheap to observe.

---

## 11. What not to build

- **Automatic replies to customers.** Drafting is the feature; sending is not.
  The outbox exists, quiet hours exist, delivery states exist — a draft in
  `notification_outbox` that a coordinator releases keeps every one of those
  guarantees and costs one click.
- **A model anywhere in the attribution decision.** `inbound-routing.ts`
  refuses ambiguity deliberately, and its worst failure is exactly what a
  confident tie-break produces.
- **Text-to-SQL.** It steps outside the typed query layer and the branch
  policies simultaneously, to buy flexibility a tool list over existing
  queries already provides.
- **An agent scoring model.** §11 deferred this for a reason a language model
  does not repeal. Measure the inputs, do the arithmetic, generate the
  explanation.
- **Prompts as administrator-editable rows.** See `AI-20`.

---

## 12. Open questions

Everything below changes this note if the answer surprises us.

- **Does the raw MIME survive?** `InboundMessage` carries flattened text by
  design. If the original is not retained somewhere, the corpus §11 counts on
  is being discarded daily, and that is a one-line fix now and an unrecoverable
  gap later.
- **Where may the payload go?** Customs declarations and commercial invoices
  in a third-party model's request body is a client decision, not ours. It
  determines whether the second implementation in `AI-19` is a nicety or the
  primary.
- **What does the client want automated first?** This note ranks by
  engineering return. Al-Qabandi may rank by whichever task the coordinators
  complain about loudest, and that is a legitimate reordering — the half-day
  operations session is the place to ask.
- **What is an acceptable error rate, per surface?** A misclassified document
  type is a dropdown. A misread duty figure is a dispute. The thresholds in
  `AI-19` are rows precisely so this answer can change without a release, but
  somebody has to give the first values.
