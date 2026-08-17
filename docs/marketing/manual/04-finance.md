# Finance

**Invoicing, receipts and receivables. Yours alone, and deliberately so.**

> Read [`00-orientation.md`](00-orientation.md) first.

---

## What you hold, and why nobody else does

| Yours alone | Also yours |
|---|---|
| Approve an invoice | Record duty paid on a customs declaration |
| **Issue** an invoice | Read every shipment |
| Void an invoice | Read and export the dashboards |
| Raise a credit note | |
| Record a receipt | |

**Only Finance may issue, void or credit.** An operations manager who could
issue invoices is the classic separation-of-duties failure, and it is the first
one an auditor asks about. It is enforced by the system, not by an instruction —
which is the answer you can give when asked.

You **cannot** book or update shipments, change rate cards, or send quotations.
If an invoice is wrong because the job is wrong, the job gets fixed by operations
and the invoice gets credited by you. Neither of you fixes the other's record.

---

## The receivables screen

**Finance → Overview.** The subtitle is the whole job: *what you are owed, how
late it is, and who to ring about it.*

| | What it means |
|---|---|
| **Owed to you** | Across every open invoice |
| **Overdue** | Past the due date |
| **Received** | What has come in |
| **Unallocated receipts** | **Money in the bank not yet matched to an invoice** |

### Unallocated receipts are the one to clear first

The screen warns about them explicitly, and the reason is worth stating: *until
a receipt is matched, the customer still shows as owing money they have already
paid.*

Every consequence of that is bad. You chase a customer who has paid. Their credit
limit blocks a booking they are entitled to. Your ageing report overstates the
debt and your management makes decisions on it.

**Clear them daily.** It is ten minutes and it is the highest-value ten minutes
in this chapter.

### Ageing

Everything unpaid, grouped by how late it is: not due yet, 1–30, 31–60, 61–90,
over 90. The screen offers a piece of judgement with it — *anything beyond 60
days is usually a phone call, not a reminder* — and it is right.

### Who owes the most

Largest balance first, not oldest. **Chase the biggest exposure before the oldest
debt.** A four-month-old invoice for a small amount is an irritation; a
six-week-old invoice for a large one is a risk.

Use the ageing view to decide *how* to chase and this view to decide *whom*.

---

## Invoicing

### The states, and what each one commits

| State | What it means | Reversible? |
|---|---|---|
| **Draft** | Being built. No number yet. Charges can be added and changed. | Yes |
| **Approved** | Reviewed and ready. Still no number, still editable. | Yes — back to draft |
| **Issued** | **It takes the next number in the branch's series.** | **No** |
| **Part paid** / **Paid** | Receipts matched against it | — |
| **Void** | Cancelled. The number stays used. | No |
| **Credited** | A credit note replaces it | No |

**Issuing cannot be undone.** The system says so before you do it. An issued
invoice can only be corrected by a credit note — and that is the point, because
an invoice that can be silently edited after the customer has it is not a
document either of you can rely on.

**Voiding keeps the number.** The series has no gap. An invoice series with a
missing number is a question at every audit, and the answer *"we deleted it"* is
never a good one.

### Building it

Add charges while it is a draft. Each line carries:

- **Description** — what the customer will actually read
- **Charge type** — groups the line on the printed invoice
- **Quantity, unit price**
- **Taxable** — tax is added at this invoice's rate where the line is taxable

Totals recalculate from the lines. There is no total you type over.

### Tax treatment

Set per invoice: **standard rate**, **zero rated**, **exempt**, **out of scope**,
**reverse charge**.

This is not decoration — it is what makes an invoice raised by your UAE entity
and one raised by your Kuwait entity both correct at the same time. Set it from
the entity and the transaction, not from habit.

### Document language

Each invoice carries its own language, English or Arabic. Set it to what the
customer wants to receive, not to what you are reading the screen in.

### Currency

Every charge line stores **its own exchange rate and the moment it was taken**.
A job quoted in dollars and invoiced in dinars reconciles months later because
the rate is recorded rather than recalculated.

**Amounts round per currency at the line.** KWD carries three decimal places and
the system knows it. You do not need to correct dinar amounts for rounding, and
you should not try.

---

## Receipts

**Finance → Payments.** What came in, and how much of each has been matched.

Record: the date received, the customer, their reference, the method — bank
transfer, cheque, cash, card or offset — and the amount.

**Then allocate it.** A receipt can be matched across several invoices, and part
of a receipt can sit unallocated if the customer has overpaid or paid on account.
The register shows what is matched and what is not, and the overview screen
counts the unmatched ones at the top.

**Recorded by** is captured automatically. So is the time. Neither can be
changed afterwards.

---

## Duty

You can record duty paid on a customs declaration. So can the customs broker and
the operations manager; a coordinator cannot.

The declaration shows the duty assessed. Recording payment moves the declaration
forward toward release, and it is usually what somebody is waiting on — a
container sitting for a payment nobody recorded is demurrage accruing on your own
delay.

---

## Charges that appear without anyone entering them

**Free-time clocks write their own charge lines.** Demurrage, detention and
storage accrue against the carrier's free days and post automatically, against
the right counterparty at the right per-diem rate.

Two consequences for you:

1. **Do not enter these by hand.** You will duplicate them.
2. **They arrive after delivery.** A job closed the day it was delivered may
   close before its last accrued charge lands. This is why the operations manager
   is told to check job costs before closing, and it is worth being the person
   who reminds them.

---

## Export

Financial data exports whole, in a form your accountant can use.

**There is no direct connector to an accounting package in this release.** Export
and import is the path today. If your accountant needs a specific layout, say so
— the export is configurable and it is a smaller job than it sounds.

---

## Your week

| When | What |
|---|---|
| **Daily** | Unallocated receipts. Clear every one. |
| **Daily** | New receipts recorded and matched |
| **Weekly** | Overdue — the 61–90 and 90+ buckets, by phone |
| **Weekly** | Who owes the most — largest exposure first |
| **On completion** | Invoice the jobs operations has completed |
| **Before closing a job** | Check the free-time charges have landed |
| **Monthly** | Export for the accountant; reconcile the receipt account |
| **Monthly** | Check the invoice number series has no gaps — voids should keep theirs |

---

## Four things not to do

**Do not edit an issued invoice by any route.** There is no route, and looking
for one means the credit note is the answer.

**Do not delete a receipt to correct it.** Nothing is deleted here. Correct the
allocation.

**Do not leave money unallocated over a weekend.** Everything downstream of it is
wrong until you do, including how your colleagues treat that customer.

**Do not close the month with unmatched receipts on the register.** The ageing
report is wrong by exactly that amount, and somebody will act on it.
