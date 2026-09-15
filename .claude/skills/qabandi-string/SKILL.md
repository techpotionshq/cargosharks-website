---
name: qabandi-string
description: Add, change or remove any user-facing text in the Qabandi product — screen labels, button text, hints, error messages, email copy, PDF strings. Use BEFORE editing apps/web/messages/en.json or ar.json by hand. Triggers on "change the label", "reword", "add a button", "fix the wording", "the screen says", or any new user-visible string.
---

# Writing user-facing text

Every user-facing string needs `en` and `ar`. Write both in one step:

```bash
pnpm q msg set <key> --en "English text" --ar "النص العربي"
pnpm q msg "<existing text>"    # find the key first, and see where it is used
pnpm q msg rm <key>             # refuses while code still reads it
```

**Do not hand-edit `en.json` and then `ar.json`.** Two edits is how a key reaches
production in English only, and that failure is worse than a missing string: half a
screen silently falls back to the other language and looks deliberate. `q msg set`
writes both files, in Prettier's exact format, then runs `check-messages`.

## Changing text that already exists

Start from what the person quoted, not from the code:

```bash
pnpm q msg "Awaiting approval"
```

That gives the key, both languages, and every `file:line` that reads it — including
the files that bind their namespace inside a `Promise.all` destructure, which is most
of the dialogs. Change it with `q msg set` on the key it found.

If a key reports no static call site, that does not mean it is dead. Enum-backed
groups are read as `t(`statuses.${row.status}`)` and resolve at run time from a
database enum; `check-messages` covers those by checking the group against the enum.
`q msg <key>` says which case a given key is in.

## Simplified Technical English — the English side

ASD-STE100 applies to every user-facing string in this product: UI, errors, emails,
generated documents and assistant prose. It is not a style preference; operators read
these screens in a second language under time pressure.

- One idea per sentence. Under 20 words.
- Active voice. Present tense. "The system refused the payment", not "the payment
  was refused".
- One word per meaning, one meaning per word. If the product says *job* elsewhere,
  never say *shipment* here.
- No synonyms for a term already in the glossary — freight terms are the glossary:
  job, enquiry, quote, consolidation, house, master, demurrage, detention.
- Say what to do, not what went wrong alone. "Add a rate card before you quote"
  beats "No rate card found".
- No idiom, no humour, no filler ("please", "simply", "just").

## The Arabic side

- Arabic is a real translation, not a transliteration of the English clause order.
- Freight terms follow the ones already in `ar.json` — check with `q msg` before
  inventing one. Consistency with the existing catalogue outranks a better word.
- Plural forms use ICU `plural` with the Arabic categories the catalogue already
  uses: `zero`, `one`, `two`, `few`, `many`, `other`. English needs only `one` and
  `other`; do not copy that shape into Arabic.
- If you cannot write the Arabic confidently, say so and ask — do not ship an
  English string in the Arabic slot, and do not machine-guess a freight term.

## Layout follows the language

CSS logical properties only: `ms-`/`me-`, `ps-`/`pe-`, `start`/`end` — never
`ml-`/`mr-`/`left`/`right`. `pnpm lint` enforces it. A hard-coded side is invisible
in English and breaks every Arabic screen.
