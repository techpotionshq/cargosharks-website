# Getting started

**Read this once, on your first day. Then go to the chapter for your role.**

---

## 1. Signing in

Go to your company's Cargolane address — it is on your own domain, something
like `ops.yourcompany.com`. You will see a sign-in page with your company's logo
on it.

**There is no sign-up form, and this is deliberate.** Accounts are created by
your administrator. If you do not have one, you are asking the wrong person for
software — ask the person who runs your systems.

### If you are an Administrator or work in Finance

You will be asked to set up **two-factor authentication** the first time you sign
in. Install an authenticator app on your phone — Google Authenticator, Microsoft
Authenticator, 1Password or similar — scan the code on screen, and enter the
six-digit number it shows you.

From then on you need your password *and* your phone to sign in.

This is required, not optional, for those two roles. They are the two that can
change who has access and can issue money documents.

### If you have forgotten your password

There is no self-service reset. Ask your administrator — they can reset it, and
they will give you the new one directly rather than emailing it.

---

## 2. Finding your way around

The screen has three parts and they do not move.

**Down the left, the navigation**, in four groups. The groups match how a
forwarding office is actually organised, rather than how the software is built:

| Group | What is in it |
|---|---|
| **Commercial** | Dashboard · Enquiries · Quotations · Customers · Rate cards |
| **Operations** | Shipments · Exceptions · Customs · Documents |
| **Network** | Partners & agents · Ports & places · Reference data · Bulk import |
| **Finance** | Overview · Invoices · Payments |

**You will not see all of it.** The navigation shows what your role permits. A
coordinator does not see the finance group; a customs broker sees a narrow slice.
This is not a limitation on you personally — it is how the separation of duties
works, and every role's exact permissions are listed in
[`09-permissions-reference.md`](09-permissions-reference.md).

**Across the top**, your branch, your name, the language switch, and — if your
role includes it — a link to **Settings**.

**In the middle**, the screen you are on.

---

## 3. Branches

Everything in the system belongs to a branch — a shipment, a customer, an
invoice, a rate card.

**You see the branches you hold a role in, and only those.** If you work in the
Kuwait office you see Kuwait's shipments. If you hold a role in both Kuwait and
Dubai, you see both, and screens that count things count both.

If you ask for something in a branch you do not have a role in, the system says
**not found** — not "access denied". That is intentional: it does not confirm
that the record exists.

**You cannot widen your own access.** Only an administrator can give you a role
in another branch.

---

## 4. Arabic and English

The language switch is at the top of every screen. It changes the entire
interface, including the direction of the layout, and it changes documents and
the customer-facing pages too.

Your choice is remembered. Your colleague's choice is theirs — two people can
use the same system in different languages at the same time, on the same data.

**Your customers get the same choice**, on the tracking page and in the portal,
without an account.

---

## 5. Five things about how this system behaves

These are unusual enough to be worth knowing on day one, because each of them
will otherwise surprise you.

### Nothing is deleted

There is no delete button, anywhere, on anything that matters. Records are
**closed**, **cancelled**, **superseded** or **deactivated** — and they stay
visible.

A quotation you revise does not overwrite the old one; the old one is marked
superseded and remains readable. A document you replace keeps its earlier
version. This is what makes the system usable as evidence six months later, when
somebody asks what you actually sent.

If something is cluttering a list, filter it — do not look for a way to remove
it.

### Everything is recorded

Every change is written to an audit log by the database itself: who, when, what
changed, from which address. It records changes that go around the application
as well as those made through it.

**Nobody can edit or delete an entry** — not your administrator, not your
supplier's support engineers. The permission to do so does not exist on any
account.

This is protection, not surveillance. When something goes wrong on a shipment,
the trail shows what actually happened rather than what everyone remembers.

### Money is exact, and currency-aware

Amounts are held exactly, and rounded per currency at the line. The Kuwaiti dinar
carries three decimal places and the system knows it — it does not round your
dinars as though they were dollars.

Every charge line stores the exchange rate that was used **and the moment it was
taken**. A job quoted in dollars and invoiced in dinars still reconciles months
later, because the rate is recorded rather than recalculated.

### Time is measured against a working calendar

Response deadlines and clearance windows count working days on the calendar
configured for that branch — Sunday to Thursday, with public holidays — not
calendar days. An enquiry that arrives on Thursday afternoon is not overdue on
Saturday morning.

### The system tells you what is wrong first

Lists that show problems — exceptions, overdue enquiries, unpaid invoices — are
ordered **oldest first**, not newest first. The logic is stated on the screens
themselves: *the one nobody has looked at is the one the process missed.*

Resist the urge to sort by newest. The newest problem is the one that is already
being handled.

---

## 6. Things you can see from anywhere

| | |
|---|---|
| **Customer tracking** | Opens the public tracking page — the same page your customer sees. Useful for checking what a customer is actually looking at before you ring them back. |
| **Settings** | Only if your role includes it. Users, branches, the audit log, vendor access and branding. |

---

## 7. If something looks wrong

**A screen says you cannot view it.** Your role does not include that
permission. The message names the permission. Send the name to your
administrator rather than describing the screen.

**A record you expected is not there.** Check the branch filter, and check
whether you hold a role in the branch it belongs to.

**A number looks wrong.** Do not correct it by overwriting something. Open the
record and look at its history — the audit trail will show what changed and when,
and the answer is usually there.

**Something is genuinely broken.** Tell your administrator, with the shipment
reference or invoice number and the time it happened. Both are what makes it
findable.

---

## 8. What is not in this release

Said here once so that nobody spends an afternoon looking for it:

| | |
|---|---|
| **Automatic carrier tracking** | Milestones are entered by your team or posted by your agent. There is no live feed from the shipping line. |
| **Direct customs filing** | Declarations are tracked, not filed. You file where you file today and record the reference here. |
| **WhatsApp and email notifications** | In delivery. Templates exist; the sending channels are being finished. |
| **Scheduled reports by email** | In delivery. Every screen exports today. |
| **Accounting-package integration** | Export today; direct connectors later. |
| **The agent portal** | The route exists and is correctly scoped, but the screens are not built. Do not give an agent a login yet — see [`08-agent-portal.md`](08-agent-portal.md). |

---

**Next:** find your role.

| Role | Chapter |
|---|---|
| Coordinator | [`01-coordinator.md`](01-coordinator.md) |
| Operations Manager | [`02-operations-manager.md`](02-operations-manager.md) |
| Sales | [`03-sales.md`](03-sales.md) |
| Finance | [`04-finance.md`](04-finance.md) |
| Customs Broker | [`05-customs-broker.md`](05-customs-broker.md) |
| Administrator | [`06-administrator.md`](06-administrator.md) |
