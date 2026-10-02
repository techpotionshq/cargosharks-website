# Record of processing activities

*What personal data this system holds, why, on whose instruction, and for how
long.*

Last reviewed: **2026-10-02**. Derived from the schema, not from memory — the
tables named in each row are real and greppable with `pnpm q table <name>`.

Two roles, and the distinction runs through everything below:

- **Processor** — for everything inside a customer's deployment. The freight
  operator decides what goes in and why; we hold it on their instruction.
- **Controller** — for our own sales correspondence, and for the accounts of
  the operator's staff insofar as we administer them.

**The applicable law is not settled** (`Decisions_Required.md`, items 5 and 21).
This record follows the GDPR Article 30 shape because it is the most demanding
of the candidates; if Kuwait's CITRA regulation alone applies, the mandatory
content is different and this file changes shape rather than substance.

**Retention is unset throughout.** Every "Retention" cell below says so. That
is the single largest gap in this record and it is a legal decision, not an
engineering one — see the note at the foot.

---

## 1. Operating the freight platform *(role: processor)*

| | |
| --- | --- |
| **Purpose** | Running a freight forwarder's operations: enquiries, quotes, shipments, customs, invoicing, settlement |
| **Categories of people** | The operator's staff; customer contacts; overseas agent contacts; consignee and shipper contacts named on shipments; drivers and recipients who sign for delivery |
| **Categories of data** | Names (English and Arabic), email addresses, telephone numbers, job titles, employer, branch, role and permissions; correspondence; signatures and proof-of-delivery photographs; geolocation captured at delivery; identity-document numbers where the operator chooses to collect them |
| **Special categories** | None intended. Proof-of-delivery photographs can incidentally contain images of people |
| **Lawful basis** | The controller's — the operator's contract with its customers, and its legitimate interest in operating its business |
| **Recipients** | The operator's own staff, scoped by branch; the customer contact for their own shipments; the agent contact for jobs their partner is named on |
| **Transfers** | Determined by the hosting region, which is not chosen |
| **Retention** | **Not set.** Freight records carry statutory retention obligations that will drive this |
| **Where** | `principals`, `customer_contacts`, `partner_contacts`, `jobs`, `shipments`, `pod_*`, `documents`, `messages` |
| **Measures** | [`Security_Measures.md`](Security_Measures.md) |

## 2. Identity and access *(role: joint — see note)*

| | |
| --- | --- |
| **Purpose** | Authenticating staff and contacts; enforcing branch scoping and permissions |
| **Categories of people** | Anyone with a sign-in |
| **Categories of data** | Email, name, password hash, TOTP secret and backup codes, session tokens, IP address, user agent, failed sign-in counts and lock expiry |
| **Lawful basis** | Necessary for the contract, and legitimate interest in securing the system |
| **Retention** | Sessions expire at twelve hours. Credentials last as long as the account. **Deactivation is `is_active = false`, never deletion** |
| **Where** | `auth_user`, `auth_session`, `auth_account`, `auth_two_factor`, `principals`, `principal_branch_roles` |
| **Note** | The `auth_*` tables sit outside row-level security and outside the audit trigger by design: an audit trigger over credential rows would copy secrets into the log. `principals` and `principal_branch_roles` are under both, and writing a grant needs `admin.users.write` in that branch. An invited person's login is created with their principal and they set the first password from a one-hour emailed link; nobody else ever knows it |

## 3. Audit trail *(role: processor)*

| | |
| --- | --- |
| **Purpose** | Accountability. Who changed what, when |
| **Categories of data** | Principal id, table, row id, operation, timestamp, client IP address, before/after values — which will include personal data wherever the audited row did |
| **Lawful basis** | Legal obligation and legitimate interest; an audit trail is itself a security measure |
| **Retention** | **Not set.** NFR-10 requires a minimum of twelve months, searchable and exportable. The search and the CSV export are built (`Security_Measures.md` §6); the retention period is not |
| **Where** | `audit_log`, written by 85 triggers |
| **Note** | Insert-only. `DELETE` is revoked. This is the table that collides hardest with erasure rights |

## 4. Vendor support access *(role: processor)*

| | |
| --- | --- |
| **Purpose** | Letting a support engineer answer "the invoice total is wrong on KWI-1042" |
| **Categories of data** | Whatever the grant admits, plus a record of the engineer, the grant, the reason and each access |
| **Lawful basis** | The support contract; the customer grants each access explicitly |
| **Retention** | **Not set** |
| **Where** | `support_grants`, `support_access_log` |
| **Note** | Granted by the customer, time-boxed, revocable, read-only unless the customer grants write scope, and logged per transaction. A banner shows the customer while a session is open |

## 5. Inbound enquiry mail *(role: processor)*

| | |
| --- | --- |
| **Purpose** | Turning emailed and WhatsApp enquiries into structured records — and, where a branch switches the intake agent on, answering the sender: at most one confirmation and a capped number of clarifications per enquiry |
| **Categories of data** | Sender address or phone number, message body, attachments — uncontrolled, because anyone may write in |
| **Lawful basis** | The controller's legitimate interest in answering enquiries |
| **Retention** | **Not set** |
| **Where** | `mailboxes`, `whatsapp_numbers`, `messages`, `message_attachments`, `intake_conversations`, `intake_turns` |
| **Note** | The mailbox is on the open internet. Mailbox passwords are sealed with AES-256-GCM under a key held outside the database. The intake agent ships off per branch; when on, its replies are stored as outbound messages and every decision — including a decision not to reply — is recorded in `intake_turns` |

## 6. The AI surface *(role: processor)*

| | |
| --- | --- |
| **Purpose** | Extracting structure from enquiries and documents; answering operator questions |
| **Categories of data** | Enquiry and document text, which may contain any of the above. The intake agent sends every customer message in a conversation, and any PDF or image attached to the new ones, in one request per turn |
| **Recipient** | OpenRouter, and the model provider it routes to |
| **Transfers** | Outside the Gulf. **The mechanism is not settled** — item 17 |
| **Retention** | `ai_invocations` stores the verbatim request and response. **Not set**, and whether it should be truncated or redacted is item 28 |
| **Turn it off** | Unset the key. The surface disappears from the navigation. This is the recommended answer for a customer with residency obligations |

## 7. Marketing and sales *(role: controller — ours)*

| | |
| --- | --- |
| **Purpose** | Answering enquiries from the public site; demonstrating the product |
| **Categories of data** | Name, company, email, message |
| **Retention** | **Not set** — item 8 |
| **Note** | The hosted demo runs on fixtures with no database. Whether it is logged or analysed at all is item 3 |

---

## The retention problem, stated plainly

Every row above says "not set", and that is one decision rather than eight.

The system is built on "nothing is deleted" — `DELETE` is revoked from the
application role, and supersession rather than deletion is the pattern
throughout. That is excellent for audit and integrity, and it is in direct
tension with a right to erasure.

The resolution is a legal decision that then becomes an engineering one, and it
has to happen in that order. Broadly:

1. **Rely on a retention obligation.** Freight and tax records carry statutory
   minimums; where they apply, erasure is lawfully refused. This covers most of
   the operational data and none of the marketing data.
2. **Build a supervised redaction path.** Not deletion — redaction: overwrite
   the personal fields, keep the row, record the redaction in the audit trail.
   This is buildable and is roughly a fortnight.
3. **Both**, which is the likely answer: refuse where a retention obligation
   applies, redact where none does.

Until this is decided, no retention period below can be written down honestly,
and the privacy notice cannot answer the question a data subject is most likely
to ask. It is the first question for counsel — items 11 and 29.
