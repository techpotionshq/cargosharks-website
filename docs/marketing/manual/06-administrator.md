# Administrator

**You own the deployment. This chapter is what only you can do, and the four
things that will hurt if you do them carelessly.**

> Read [**Getting started**](00-orientation.md) first. You hold every permission
> in the system, including any added by a future release — so every other
> chapter in this manual also describes something you can do.

---

## Settings

**Settings** sits apart from the operations navigation and has its own frame.
The reason is stated in the product: *nothing here moves a shipment.* These
screens configure the operator — who may sign in, what a branch invoices as, what
the product is called.

| Screen | What it is for |
|---|---|
| **Users & roles** | Who can sign in, and what they hold in each branch |
| **Branches** | Currency, invoice series, working calendar, trading conditions, chart of accounts, per entity |
| **Audit log** | Every write, by whom, from where |
| **Vendor access** | What your supplier's support can see, and for how long |
| **Notification wording** | What the product says when it writes to somebody — shared with the operations manager, see the [**Operations Manager**](02-operations-manager.md#notification-wording) chapter |
| **API keys** | Read-only keys a customer's systems pull their shipments with, and the webhooks that push events to them |
| **Mailboxes** | The addresses the system reads for incoming enquiries, per branch |
| **Integrations** | The relay that sends the mail, the carrier registrations, the file store, the model key, and the provider that will transmit invoices |
| **Brand** | Colours, name and mark, and the setting behind each |

They appear in that order, and **Settings** opens on the first one your role can
see.

**Reference data deliberately stayed in operations.** Ports, charge types,
milestone templates and exception codes are daily operational work, and putting
them behind an administrative wall is how a system grows a free-text "Other"
field that swallows the data it was meant to structure. Your operations manager
owns them — see the [**Operations Manager**](02-operations-manager.md#reference-data--and-why-it-is-yours) chapter.

---

## Users and roles

### Adding someone

**The product is invitation-only. There is no sign-up form**, so there is nothing
to bootstrap from and nothing for a stranger to find.

**Settings → Users & roles** lists everyone: name, email, their branch and role
badges, whether they have a sign-in, when they were last seen, and whether they
are active. **Invite someone** creates a person — both names, email, phone,
language, role, and the branches they work in, ticked one by one. You can only
grant branches you hold yourself; `admin.users.write` in one branch is not a
route to every branch.

**The dialog deliberately has no password field**, and it does not create a
sign-in. An administrator who can type a colleague's password can sign in as
them, and the audit log would say it was the colleague. The credential is
created on the server itself — by whoever operates your deployment — against
the same email, and the two records are linked.

Provisioning creates everything an account needs in one step, including **a
role per branch**. Without a branch role the account signs in and sees
nothing — which is the most common way a new user's first day goes wrong. By
default the role is granted in every active branch; it can be scoped to one.

The generated password is shown once, to whoever provisions the account. Give
it to the person directly. Do not email it.

### Suspending someone

**Suspend**, on their row. It takes their access away on their next request;
everything they wrote stays exactly as it is, and their name keeps appearing on
the records they created. Nothing is deleted — the account stays on the list,
marked inactive, and **Restore** gives it back with the same branches and roles.

### Resetting a password

Two paths. **Forgotten your password?** on the sign-in page sends the person a
link that expires in an hour — it needs *Outbound mail* configured under
**Settings → Integrations**, and a deployment without it logs the failure rather
than appearing to work. Or have the account re-provisioned on the server for the existing email: that
resets the password and changes nothing else, and it is the path when mail is
not yet configured.

### Roles are per branch

The same person can be a **coordinator in Kuwait and read-only in Dubai**. That
is the intended shape, not a workaround — a person who covers another office
during a holiday gets read access there and keeps their own role at home.

Every screen counts and shows only the branches a person holds a role in. There
is no "all branches" toggle, and there should not be.

### Two-factor

**Administrator and Finance must enrol.** They are the two roles that can change
who has access and can issue money documents. Nobody can opt out, including you.
The requirement is a flag on the role, not on the person: the **Roles** table on
this screen shows *Two-factor: Required* against those two, with the number of
permissions each role holds, and a person's badge carries the same mark.

### Choosing a role

Seven roles, described in full in [**Who can do what**](09-permissions-reference.md).
Three rules of thumb:

**Grant the narrowest role that lets someone do their job.** The customs broker
role exists precisely so that a broker does not need a coordinator's access.

**Do not put an operations person in the Finance role because they "help with
invoices".** The separation between issuing invoices and running operations is
the one an auditor asks about first, and it is enforced rather than advised.

**Read-only is a real answer.** For an owner who wants to look, a new joiner in
their first fortnight, or an accountant who needs to see and not touch.

---

## Branches

Each branch carries **its own base currency, its own invoice series and its own
working calendar**. **Add branch** and **Edit branch** on **Settings → Branches**:

| | Why it matters |
|---|---|
| **Code** | Short, and it prefixes every reference this branch creates |
| **Currency** | What the entity reports and invoices in |
| **Legal name**, in both languages | The Arabic one is required — it appears on Arabic invoices |
| **Invoice prefix** | Numbering is per branch, and gaps are questions at audit. Voided invoices keep their number for exactly this reason. Defaults to the branch code, and **cannot be changed once invoices have been issued**. |
| **House B/L series** | Numbers the house bills the branch issues. Leave blank to number them by hand. |
| **Working calendar** | **Every SLA clock and ageing rule counts against this.** Kuwait, Qatar and the UAE share neither a weekend nor a holiday list. |
| **Time zone**, **tax registration** | Per entity — Kuwait and Dubai are not the same hour |
| **Trading conditions** and **Not included** | Printed at the foot of, and beside the charges on, every quotation this entity issues — in both languages. Each entity trades under its own law; Kuwait and Dubai do not share a footer. |
| **Sends from** | Who notifications from this entity come from. Blank uses the deployment's own address. |
| **Quiet hours** | No customer notification leaves between these hours, in the branch's local time. Internal alerts are never held. |
| **Chart of accounts** | Receivables, payables, bank, output tax, FX variance, rounding — where this entity posts. Leave blank until you have the codes; the accounting export names what is missing. |

**Load next year's public holidays before January.** If you do not, every
deadline over the break is wrong, in the same direction, for every branch — and
nobody notices until a customer does.

---

## The audit log

Every write, recorded **by the database itself** rather than by the application —
so a change that goes around the application is still recorded. When, what
operation, which table, who, which branch, which record, from which address.

**Nobody can edit or delete an entry.** Update and delete are revoked from every
role in the system, including yours and including your supplier's. This is not a
policy; it is a permission that does not exist.

Read it when a figure is disputed or a change needs attributing. That is what it
is for, and it is worth telling your team it exists — not as a threat, but
because a team that knows changes are attributable argues less about what
happened.

---

## Vendor access — the one to understand properly

**Support cannot see your data by default.** There is no standing access, no
support account with a permanent key, and no back door.

When your supplier needs to look at something, **you grant it**, from
**Settings → Vendor access**:

| Field | What to put |
|---|---|
| **Engineer** | The named person. Not a team. |
| **Ticket or reason** | e.g. `SUP-1042 — invoice total disputed on KWI-2026-01041`. Recorded against every session opened under the grant. |
| **Expires after** | A number of hours. Choose the smallest that is plausible. |
| **Access** | Read only, or read and write |
| **Branches** | Leave blank for the branches you hold. **Choosing fewer is always safer.** |

**Read-and-write requires typing `GRANT WRITE` to confirm.** The friction is
deliberate. Most support work is diagnosis and needs read access only — ask what
they intend to change before you grant write, and if the answer is "nothing yet",
grant read.

While a grant is live, **a banner sits at the top of every page** of your system
saying so, for everyone. Nobody is unaware that an outsider is in.

You can **revoke it in one click**, at any time, without explanation.

Every grant and every session opened under it is recorded permanently, and *that
record cannot be edited or deleted by anyone, including your supplier*. So the
question "what did they look at" always has an answer.

**Habits worth keeping:**

- Grant hours, not days
- Grant read unless write has been justified in words you understood
- Grant the branch in question, not all of them
- Revoke when the call ends rather than waiting for expiry
- Read the vendor-access screen once a month even when nothing is open

---

## Mailboxes

**Settings → Mailboxes.** The addresses this system reads. Mail arriving in one
becomes an enquiry for that branch, or joins the thread of the enquiry or job it
quotes by reference. The service checks every connected mailbox once a minute,
and a new enquiry is on the board within that.

**Connect a mailbox**: the branch whose enquiries arrive there, the address,
the incoming-mail server and port, TLS, the password, the folder (usually the
inbox), and optionally a folder to move handled mail to — leave it blank and mail is marked
read where it is. The password is stored encrypted and is never shown again;
when editing, leave it blank to keep the one stored.

**This is your key, not the operations manager's**, and the reason is stated in
the matrix: a charge type is a business rule, and this row is the password to a
mailbox that in an office this size is usually somebody's whole account.

Each row shows when it was last checked and when mail last arrived. A mailbox
marked **Not reading** collects no enquiries — check the password first, because
most failures here are a credential that changed. **Stop reading** pauses one
without losing anything; **Start reading** resumes, and anything unread that
accumulated in the meantime arrives as enquiries.

**Before connecting a real mailbox:** the deployment needs its mailbox
encryption key configured — done once, by whoever operates the deployment — or
the form cannot be saved; it says so. And you hold no branch you cannot connect a mailbox for; an administrator with no
branch role is told to get one first.

---

## Integrations

**Settings → Integrations.** The accounts this deployment reaches the outside
world with. A credential saved here takes effect within a minute, with no
release, and takes precedence over the deployment's own configuration —
**Stop using these settings** falls back to that configuration without losing
what was typed, which is how a change is rolled back.

Credentials are sealed on the way in and never shown again; leave a field blank
to keep the one stored. The first option in each mode list is the one that
costs nothing and asks nobody.

| Group | Card | What it does |
|---|---|---|
| **Platform** | **Outbound mail** | The relay every notification leaves through. Without it nothing reaches a customer and nobody can be sent a password reset. *Sending*, or *Written to the log, not sent*. |
| | **Object storage** | Where every stored document lives — issued bills, invoices, scans. Without it documents render but cannot be kept. |
| | **Inbound mail webhook** | The shared secret a mail provider signs its forwarding webhook with. Separate from the mailboxes above. |
| **Carriers** | **Container tracking** | *Typed by an operator*, or *Carrier-direct (free)*. The driver only; the credentials live on the three carrier cards. |
| | **Maersk**, **Hapag-Lloyd**, **CMA CGM** | One self-serve registration each, at the carrier's own developer portal. Each card says which carrier codes it covers and what is still needed before it can be switched on. |
| | **Carrier poll budget** | How often the poll asks and how many shipments each run covers. The card works out calls per hour, which has to stay under the carrier's cap. |
| **Finance** | **Exchange rates** | *Typed by hand*, or *Daily from a feed*. Nothing prices from the feed — a charge line keeps the rate it was struck at. |
| | **E-invoice transmission** | The accredited provider that files an invoice with the tax authority. *Not transmitted* until somebody has bought one. |
| **Document extraction** | **Document extraction** | The model key. It switches on the assistant, reading enquiries off emails, and reading supplier bills from scans — billed per document, with a monthly ceiling set here. An unread bill is simply one that gets typed. |

A card marked **Not working** is one the service could not resolve on its last
run; the reason is on the card, and correcting it here takes effect within a
minute.

**Carrier tracking is built but off until you register.** With the driver on
*Carrier-direct* and a carrier's credentials entered, container milestones on
that carrier's shipments arrive from the carrier's own events. Until then,
every milestone is typed — and a WhatsApp Business card on this screen
notwithstanding, WhatsApp is not a channel in this release.

---

## API keys

**Settings → API keys.** Read-only keys a customer's own systems use to pull
their shipments, milestones and released documents from the read API, without
a login.

**Issue a key** — a name (*their ERP, their portal…*), the customer it reads
for, the branch, and an optional expiry. **The key is shown once and is not
stored.** If it is lost, revoke it and issue another. Each row shows when it was
last used; **Revoke** ends it, and keys are revoked, never deleted, so *when
did it stop working* always has an answer.

**Webhooks** are the other direction: where the system posts an event the
moment it happens, so a customer's system does not have to poll. **Subscribe**
with a secure (https) address and, optionally, the events wanted — empty means
everything. Each delivery is signed with a secret shown once at subscription;
give it to whoever receives the events, because they verify the signature with
it. Each endpoint shows its last delivery and how many are failing, and can be turned off without being removed.

---

## Brand

**Settings → Brand** shows every colour, name and mark the product resolves at
runtime — and the named setting behind each one.

The whole product is re-skinned by changing a handful of deployment settings —
a name, a monogram, two hues, a corner radius. No rebuild, no code change.

Both themes, every tonal ramp, every semantic colour and the chart series derive
from those few values. The screen renders the resolved values so the claim is
inspectable rather than asserted.

**Two things deliberately do not follow your brand, and should not be made to:**

**Status colours.** Positive, caution, critical, info and muted are reserved for
state. A board where "held" is calm because it matched a corporate palette is
worse than useless. If your brand hue lands within about 15° of one of them, it
will read as that status — move the brand hue, not the status colour.

**Chart series.** Four slots, assigned in order and never cycled. All four are
validated for lightness, contrast against both surfaces, and separation under the
two common forms of colour blindness, in both light and dark themes. Changing one
means re-running that validation.

---

## Bulk import

**Network → Bulk import.** Bringing existing data in from a spreadsheet, checked
row by row before anything is written.

### What can be imported

| | Notes |
|---|---|
| **Customers** | Both names, code, terms |
| **Customer contacts** | Attached to customers by code |
| **Agents and hauliers** | The partner register |
| **Ports and places** | |
| **Rate cards** | Buy — an agent tariff, needs the partner — or sell |
| **Open jobs** | For a mid-year cutover |
| **Open receivables** | For a mid-year cutover |

### How it works

1. **Choose what to import**, and the branch. Every row is created against that
   branch.
2. **Download the template** if you want the columns in the right order.
3. **Choose the file.** CSV or tab-separated, saved from Excel. The first row
   must be the headings.
4. **Check the file.** Columns are matched to your headings automatically; correct
   anything your agent named differently. Unmatched columns are listed as ignored
   so nothing is silently dropped.
5. **Read the result.** Rows read, rows accepted, and every problem with its line
   number. You can download the problem list.
6. **Import**, only if everything passed.

### The rule that matters

**A file with any errors imports nothing.** Not the good rows — nothing.

That is deliberate and it is worth defending when somebody asks for a
partial-import option. A half-imported customer list is worse than no import,
because nobody can tell which half is in, and the second attempt creates
duplicates of the first.

**Rate cards will be rejected for overlapping an existing card on the same lane.**
That is the protection working — two overlapping cards on one lane are
unrepresentable in this system, by design. Fix the validity dates on one of them.

### Doing a real migration

**Order matters**, because later files refer to earlier ones:

1. Ports and places
2. Agents and hauliers
3. Customers
4. Customer contacts
5. Rate cards — sell first, then buy per partner
6. Open jobs
7. Open receivables

**Import into one branch first and look at the result** before running the rest.
Ten minutes of checking here saves a day of unpicking, and there is no undo — the
correction path is editing records, not re-running the file.

---

## Operating the deployment

If your supplier operates the deployment, this section is theirs. If you operate
it yourself, this is the whole of the job. Each task is a single step in the
operator runbook that comes with the deployment.

| Task | What it does |
|---|---|
| **Apply updates** | Bring the deployment to the current release. Forward-only. |
| **Refresh reference data** | The delivered reference rows and the role and permission matrix |
| **Provision an account** | Create an account that can sign in |
| **Fleet status** | What version each deployment is on, and whether it is reachable |
| **Fleet update** | Update every deployment, one at a time, with a report |
| **Back up** | Take a full copy of every deployment |
| **Restore drill** | Back up, restore into a scratch copy, verify, discard |

**The restore drill is the one to schedule.** A backup nobody has restored is
a hypothesis. The drill restores into a scratch copy and checks the *content*,
not merely that the process finished — including that the security policies
survived, because a restore that drops them produces a system that looks
perfect and enforces nothing.

**Backups must be taken with the administrative connection.** The application's
own account cannot read outside its branches, so a backup taken as the
application is silently partial — the most dangerous artefact in this whole
area, because it looks like a backup.

---

## What only you can break

**Granting the wrong role.** Every other mistake in this manual is recoverable
from the audit log. This one is somebody seeing what they should not, and it is
not visible until it matters. Grant the narrowest role.

**Granting standing vendor write access.** Hours, not days. Read, not write,
unless justified.

**Forgetting the working calendar.** Every SLA in the system counts against it.
A missing holiday list is every deadline wrong in the same direction, silently.

**An unverified backup.** Run the restore drill on a schedule. Do not assume the
dump is good because the command exited zero.

---

## What is not in this release

| | |
|---|---|
| **A sign-in created from a screen** | *Invite someone* creates the person and their branch roles; the credential is still created on the server, against the same email. |
| **Self-service password reset without mail** | *Forgotten your password?* works once *Outbound mail* is configured. Until then, re-provisioning on the server is the reset path. |
| **Editing the role matrix from the interface** | The matrix is editable without a software release, but not from a screen today. The *Roles* table on Users & roles shows it. |
| **WhatsApp notifications** | Not in this release. Email is the channel, once *Outbound mail* is configured. |
| **Carrier tracking without registering** | The feeds are carrier-direct and need each carrier's own credentials under *Integrations*. Until they are entered, milestones are typed. |
| **Scheduled reports** | In delivery. Every screen exports today. |
