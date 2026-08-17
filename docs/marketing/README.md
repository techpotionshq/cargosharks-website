# Marketing and documentation set

Everything a buyer reads before signing, and everything a user reads after.

| | |
|---|---|
| **Prepared by** | techpotions |
| **Date** | 17 August 2026 |
| **Status** | First pass. Pricing numbers are placeholders and marked as such. |

---

## The name is a placeholder

Every document in this directory calls the product **Cargolane**. That name is a
token, not a decision. It was chosen to be unclaimed-looking, pronounceable in
Arabic and English, and unambiguous in find-and-replace — it appears nowhere in
the source tree, so renaming the whole set is:

```bash
grep -rl Cargolane docs/marketing | xargs sed -i 's/Cargolane/<NewName>/g'
grep -rn "cargolane\.com" docs/marketing   # domains, review by hand
```

Two other tokens follow the same rule and want the same treatment before
anything goes out:

| Token | Means | Decide before |
|---|---|---|
| `Cargolane` | the product name | anything is sent |
| `cargolane.com` | the marketing domain | website copy ships |
| `[KWD ####]` / `[USD ####]` | an unconfirmed price | pricing sheet is quoted |

**The codebase does not need renaming.** `packages/brand` already makes the
operator a parameter and no component carries a company name, so the product's
own name lives in brand configuration and in these documents — nowhere else.

---

## What is here

### `sales/` — read by someone deciding whether to buy

| File | What it is | Length |
|---|---|---|
| [`one-pager.md`](sales/one-pager.md) | The leave-behind. No jargon. | 2 pages |
| [`deck.md`](sales/deck.md) | Fourteen slides with the words to say over each one. | 20 minutes |
| [`battlecard.md`](sales/battlecard.md) | CargoWise, Logistaas, CARGOES Runner, and doing nothing. Internal. | reference |
| [`pricing.md`](sales/pricing.md) | Editions, implementation, hosting, support. Numbers are placeholders. | 2 pages |
| [`website-copy.md`](sales/website-copy.md) | Homepage, three product pages, FAQ, Arabic direction. | ready to paste |

### `pdf/` — the same thing, ready to send

```bash
node docs/marketing/render.mjs
```

Rebuilds every PDF from the Markdown. **The Markdown is the source; the PDFs are
output.** Never edit a PDF — edit the chapter and re-render, or the two drift and
the one you sent is the one you cannot reproduce.

Needs `pandoc` on `PATH` and Google Chrome installed. pandoc parses; Chrome
paginates, driven through the `playwright-core` the end-to-end run already
brings in, so nothing is downloaded and no dependency is added for a document
build.

Output is A4, with a footer carrying the document name and `Page n of m`. Two
documents replace that caption with a standing warning that survives being
photocopied: the battlecard prints **INTERNAL — do not circulate**, and the
pricing sheet prints **DRAFT — every figure is a placeholder**. Take both off
only when they stop being true.

`User-Manual-Complete.pdf` is the bound manual — every chapter in order, each
starting on a fresh sheet, 42 pages. It is the one to print for a training room;
the individual chapters are for sending one role what they need.

> **Decide whether `pdf/` is committed.** It is generated output, which this
> repository normally ignores (`dist/`, `out/`, `coverage/`). Against that: these
> are deliverables somebody will want to grab without a toolchain. If they should
> not be tracked, add `docs/marketing/pdf/` to `.gitignore`.

### `manual/` — read by someone who has already bought

Organised by role, because that is how somebody arrives at it: they have a job
title and a problem, not a table of contents.

| File | Who reads it |
|---|---|
| [`00-orientation.md`](manual/00-orientation.md) | everyone, once, on day one |
| [`01-coordinator.md`](manual/01-coordinator.md) | the person moving shipments |
| [`02-operations-manager.md`](manual/02-operations-manager.md) | the person the coordinator escalates to |
| [`03-sales.md`](manual/03-sales.md) | the person answering enquiries |
| [`04-finance.md`](manual/04-finance.md) | the person invoicing and chasing |
| [`05-customs-broker.md`](manual/05-customs-broker.md) | the person filing declarations |
| [`06-administrator.md`](manual/06-administrator.md) | the person who owns the deployment |
| [`07-customer-portal.md`](manual/07-customer-portal.md) | **hand this to your customers** |
| [`08-agent-portal.md`](manual/08-agent-portal.md) | **hand this to your agents** |
| [`09-permissions-reference.md`](manual/09-permissions-reference.md) | whoever asks "who can do what" — usually an auditor |

The last two are written to be extracted and sent out under the operator's own
brand. Nothing in them names a supplier.

---

## The rule these documents were written under

**Nothing is claimed that the working tree does not do.** Each manual chapter
ends with a section called *Not in this release*, and the sales documents carry
the same list under a heading a buyer will actually read. This is not modesty.
A forwarder who discovers a missing feature in week three cancels; a forwarder
who was told about it in week zero plans around it and trusts the rest.

Where a document describes something that is scaffolded but not finished —
document rendering, WhatsApp, scheduled reports — it says *in delivery* and
names the release. Where something is not planned at all — Kuwait MicroClear
filing — it says so and says why.

The source of truth for that boundary is three places in the repository, and
they are worth re-reading before every revision of these documents:

- `apps/service/src/workers/index.ts` — the `PENDING` array is the list of jobs
  registered but not yet built
- `apps/service/src/ports/index.ts` — the seven interfaces, each with its real
  first implementation and its named second
- `README.md` §Status — the verified table, schema and test counts

### Figures quoted in these documents, and how to re-check them

Every number below appears in the sales material. They drift as the product
grows, and a number a prospect can disprove costs more than it earned. Re-run
these before any revision goes out.

| Figure | Used in | Verify with |
|---|---|---|
| **1,407 interface strings**, EN and AR in sync | one-pager, deck, website copy | `node -e "const c=o=>Object.values(o).reduce((n,v)=>n+(typeof v==='object'&&v?c(v):1),0);for(const f of ['en','ar'])console.log(f,c(require('./apps/web/messages/'+f+'.json')))"` |
| **75 policies across 57 tables** | one-pager, deck, website copy | `README.md` §Status, re-verified against a live database |
| **Seven roles and the permission matrix** | `manual/09-permissions-reference.md` | `packages/db/src/seed.ts` → `ROLE_PERMISSIONS`, and `packages/core/src/states.ts` → `ADMIN_PERMISSIONS` |
| **Five transport modes** | everywhere | `packages/db/src/schema/enums.ts` → `modeEnum` |
| **Hosting regions offered** | website copy, pricing | Commercial decision — not verifiable in code. Confirm before quoting. |

The market-analysis document quotes **1,514** strings; that figure is now stale.
These documents use the working-tree count.

---

## Before any of this goes to a prospect

Four things, in order, from `docs/Gulf_Market_Analysis.md` §8:

1. **Confirm the Al-Qabandi engagement permits resale.** Everything here is
   void otherwise. (`Q1`, blocking.)
2. **Get Al-Qabandi's written permission to be named** as a reference customer,
   and agree what may be said. The one-pager, the deck and the website copy all
   lean on it. (`Q5`.)
3. **Fill in the pricing placeholders.** A prospect who asks for a number and
   gets a pause has learned something about the vendor.
4. **Have a live deployment to point at.** No amount of documentation
   substitutes; §8.3 of the market analysis is right that credibility is the gap,
   not features.
