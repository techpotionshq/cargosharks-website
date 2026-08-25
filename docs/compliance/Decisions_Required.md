# Decisions required

*The 57 `[TO CONFIRM]` markers in the privacy notice, the data-processing
addendum and the terms — grouped, ordered, and with a recommendation against
each where one can honestly be made.*

Generated from the source on **2026-08-25**:

```bash
grep -o '\[TO CONFIRM:[^]]*\]' apps/landing/src/content/pages/{privacy,dpa,terms}.tsx
```

21 in the privacy notice, 16 in the addendum, 20 in the terms.

**Nothing here has been invented.** These are questions with legal, commercial
or financial consequences, and a plausible-sounding answer written by the
engineering side is worse than a blank — a blank gets asked about, and a wrong
answer gets signed.

---

## How to work through this

Four of these unblock most of the rest. Take them in this order:

| # | Decision | Unblocks | Who |
| --- | --- | --- | --- |
| **A** | Which law applies | Almost everything | Counsel |
| **B** | The erasure position | Every retention period | Counsel, then engineering |
| **C** | Who operates the deployment | Every infrastructure obligation | Commercial |
| **D** | Hosting region and provider | Residency, encryption at rest, backups | Commercial + engineering |

Everything after those is filling in blanks.

---

## A. Which law applies *(items 5, 21, 15, 56)*

**The question.** Kuwait's CITRA data-privacy regulation, the UAE PDPL, the
Saudi PDPL, the EU GDPR, or a combination determined by hosting region and by
where each customer is established.

**Why it is first.** It sets the vocabulary (*controller/processor* is a GDPR
frame and does not map cleanly onto CITRA), the mandatory content of the
addendum, the breach clock, the transfer rules and the data-subject rights the
privacy notice must promise.

**Recommendation.** For a Kuwaiti forwarder selling to Gulf customers, draft to
**CITRA as the operative regime and GDPR as the ceiling**. The addendum already
follows the Article 28 pattern, which is the most demanding of the candidates —
drafting to the ceiling means one document rather than four, and it is the
answer an EU-established customer will need anyway. Confirm with local counsel
that nothing in CITRA conflicts.

## B. The erasure position *(items 11, 29, 12)*

**The question.** The system is built on "nothing is deleted" — `DELETE` is
revoked from the application role. What happens when someone asks to be erased?

**Recommendation.** Both, in this order:

1. **Rely on retention obligations where they exist.** Freight and tax records
   carry statutory minimums. Where one applies, erasure is lawfully refused and
   the notice should say so plainly rather than promise something undeliverable.
2. **Build a supervised redaction path for everything else.** Not deletion —
   overwrite the personal fields, keep the row and its references, and record
   the redaction in the audit trail. Roughly a fortnight of work, and it turns
   "we cannot" into "here is how".

Do not answer this by copying a clause. It is the first question for counsel.

## C. Who operates the deployment *(items 39, 47)*

**The question.** Operated by the vendor on the customer's behalf, operated by
the customer, or either — and who holds the cloud account.

**Why it matters here.** It decides who carries the infrastructure obligations
in the terms, who is the processor, who holds the migration credentials, and
who a regulator writes to. NFR-17 says the customer owns everything on final
payment, which points at customer-operated; the fleet tooling
(`tenant:new`, `fleet:migrate`, `fleet:backup`) points at vendor-operated.
**Both are being built. Pick one as the default and price the other.**

## D. Hosting *(items 9, 33, 7, 13)*

Region, provider, encryption at rest, backup destination and retention. Blocks
three entries in the measures annex and is the one item that can hard-stop a
ministry-adjacent tender.

---

## The rest, by theme

### Corporate identity *(4, 22, 38, 19, 35, 57)*
Registered entity name, legal form, commercial registration number, registered
address; whether the contracting entity is the same in every market; the address
for formal notice. **Also: a dedicated `privacy@` address and a working
`security@` address** — `security.txt` is now published and points at one, so it
must exist before that file ships. Mechanical, and blocks the most documents.

### Retention periods *(12, 8, 42, 31, 54)*
Business records, audit entries, application logs, object storage, backups —
each with the legal basis for the period chosen. Blocked on **B**. Note that
anything shorter than forever needs a deletion mechanism that does not exist.

### Breach notification *(30)*
The window in hours and measured from what. **Recommendation: 24 hours from
becoming aware**, which is what enterprise contracts ask for and what the
incident plan is written against. "Without undue delay" alone will not pass.

### Sub-processors *(10, 27)*
Notice period before engaging a new one, the objection mechanism, and what
happens if a customer objects. **Recommendation: 30 days' notice, objection in
writing, and a right to terminate without penalty if unresolved.** That is the
market standard and it is cheap to give.

### The AI surface *(17, 28, 33)*
Transfer mechanism for model requests; whether the verbatim ledger in
`ai_invocations` should be truncated or redacted; whether the surface is offered
at all to customers with residency obligations. **Recommendation: leave it off
by default for those customers and say so in writing.** Unsetting the key
removes it entirely, which is a clean, demonstrable answer.

### Security commitments *(14, 26, 44, 46, 45)*
Which gaps close before launch, with a date against each, and which are accepted
as residual risk in writing. **Two of these are now closed** — two-factor is
enforced and lockout is built (item 44) — and the rest are in
[`Security_Measures.md`](Security_Measures.md) §6. Uptime, RPO and RTO remain.

### Support access *(25, 32)*
Background-check policy for engineers with support access; whether a named list
is given to the customer; audit rights, frequency, notice and who pays. Note
that the technical control here is unusually strong, so this is paperwork
catching up with the build rather than the other way round.

### Fonts *(6)*
Self-host the three families before launch. An hour of work; removes a
third-party disclosure of every visitor's IP address. **Recommendation: do it.**

### The demo *(3)*
Whether the hosted demo is logged or analysed at all, and whether it needs its
own notice. It runs on fixtures with no database, so the honest answer is
probably "not logged", which makes this cheap.

### Commercial terms *(40, 41, 43, 48, 49, 50, 51, 52, 53, 55, 37)*
Fees, pilot terms, exclusions, payment, confidentiality, escrow, warranties,
liability cap, insurance, term and renewal, variation, order of precedence.
Entirely commercial. **Item 52 (liability cap and whether cyber insurance is
carried) is the one a customer's legal team will reach for first.**

### Miscellaneous *(1, 2, 16, 18, 20, 23, 24, 34, 36)*
Data-subject response time and identity verification; how changes are notified;
whether an identity-document number needs collecting at all (the field is
optional in the schema — **recommendation: do not collect it unless a customer
asks**); what happens if an instruction appears unlawful; liability precedence.

---

## What this is worth

Closing the four blockers and the corporate-identity items would take these
three documents from *drafts with holes* to *documents a buyer's legal team can
mark up*. That is the cheapest single step toward passing enterprise
procurement, and it needs a lawyer for perhaps a day and the operator for an
afternoon — not an audit and not a certificate.
