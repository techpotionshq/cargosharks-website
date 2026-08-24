# CargoSharks marketing site

One static page. No build step, no framework, no dependencies — open
`index.html` and it works. Everything is inline except the images and one
Google Fonts request (Manrope and IBM Plex Mono).

```bash
python -m http.server 4173   # then http://127.0.0.1:4173/
```

`file://` mostly works too, but serve it if you want the fonts and the sticky
behaviour to match what a visitor gets.

## What is here

```
index.html                 the whole page
cargosharks-logo/          the supplied mark — do not edit, it is the source
pic/photos/                stock photography (Unsplash licence, commercial use, no attribution required)
pic/screens/               real captures of the running product, copied from docs/marketing/assets/screens/
```

## Where the content came from

Nothing on this page was invented for it. The copy is
[`docs/marketing/sales/website-copy.md`](../../docs/marketing/sales/website-copy.md),
the pain points in section 01 are `PP-01…PP-13` from
[`docs/Qabandi_Release_One_SRS.md`](../../docs/Qabandi_Release_One_SRS.md) §3, and the
scope columns in section 07 are §11 of the same document — the deferral table,
the built-beyond-spec list and the still-open list, read straight across.

That matters when the product moves: **when §11 changes, section 07 of this page
is wrong.** It is the only part of the page that goes stale silently.

### The figures quoted, and how to re-check them

| Figure | Where | Verify with |
|---|---|---|
| **2,709 interface strings**, EN and AR in sync | §06, FAQ | `node -e "const c=o=>Object.values(o).reduce((n,v)=>n+(typeof v==='object'&&v?c(v):1),0);for(const f of ['en','ar'])console.log(f,c(require('./apps/web/messages/'+f+'.json')))"` |
| **88 tables, 82 with RLS forced, 197 policies, 80 audit triggers** | §08 | `README.md` §Status — verified against a live PostgreSQL 18.6 |
| **Five transport modes** | hero, §02 | `packages/db/src/schema/enums.ts` → `modeEnum` |
| UAE e-invoicing dates | §07, §09 | SRS §11 — provider due 30 Oct 2026, go-live 1 Jan 2027 |

## Design

The palette is the four colours in `cargosharks-logo/README.txt` and nothing
else, with one addition: an amber used only for the "waiting on something"
status pill, because no brand colour can carry that meaning without also reading
as a link.

| | |
|---|---|
| navy | `#0B2545` |
| blue | `#1F6FEB` |
| light blue | `#79B0FF` |
| white | `#FFFFFF` |

Type is Manrope, because the supplied wordmark is Manrope ExtraBold converted to
outlines — the page and the mark are the same typeface. IBM Plex Mono carries
every label, eyebrow and status pill, which is the product's own convention:
data is set in mono.

Sections 03–05 are sticky siblings that pin and stack over one another; the card
underneath is scaled and dimmed from JavaScript, and the whole effect is
disabled under `prefers-reduced-motion` and below 820px. Those cards run wider
than the rest of the page (1500px against 1200px) and the bilingual section
wider still, because both exist to show a 1440-wide interface and the readable
measure for body copy is the wrong measure for a screenshot.

The three card screenshots (`enquiries`, `jobs`, `finance`) are 1440×900
captures cropped 17% from the left in CSS — exactly the product's sidebar,
identical on every one, so it costs a sixth of the frame to say nothing new.
Past 17% the crop starts eating the first stat tile.

`english.png` and `arabic.png` are separate captures at a shorter viewport, with
the sidebar already cropped out of the file, so the page takes them whole. The
short frame is deliberate: it cuts the map across the middle and puts the
assistant dock — which is `fixed bottom-5 end-5` — just below it. Section 06
lays the two over each other at an offset tuned so the Arabic card's top edge
lands on the bottom of the English stat row; both rows of numbers stay readable
and the Arabic map runs on below. Every offset there is a percentage of the
container's *width*, including the vertical ones, so the two stay registered as
the page narrows.

Retaking those two needs the app running (`QABANDI_PILOT_FIXTURES=1`, no
database) and a browser that is not sandboxed — the lazily-loaded `maplibre-gl`
chunk comes back 403 under the sandbox while curl gets 200 for the same URL, so
the map silently never renders. Locale is the `qabandi_locale` cookie, not a
route segment.

## The "shorter text" button

The header carries a dev toggle that swaps every block with a `data-short`
attribute for a shorter version — 42 of them, across the six-card sections, the
product cards, the pilot steps and the FAQ. It is an authoring aid, not a
feature: it exists so both lengths can be read in place before one is chosen.
The long copy is the source of truth and is held in memory, so toggling is
lossless. **Delete the button and the `data-short` attributes before launch**,
or promote the short copy into the markup and delete the long.

## Before this goes live

1. **The screenshots still carry Al-Qabandi's red brand.** Their *name* is no
   longer visible — the page crops the sidebar out of every capture, which is
   where *AL-QABANDI & PARTNERS* sat — but the red accent throughout the
   interface still clashes with this palette, and the raw files in
   `pic/screens/` are unchanged, so anyone opening them sees the name. Naming
   them as a reference customer needs written permission
   (`docs/marketing/README.md`). Re-capture under a neutral brand —
   `packages/brand` makes the operator a parameter, so this is a configuration
   change, not a redesign.
2. **The contact form has no backend.** It intercepts the submit and tells the
   visitor to email instead. Wire it to something real or replace it with a
   `mailto:` link.
3. **There is no Arabic version of this page**, which is awkward for a page whose
   central claim is that Arabic is not an afterthought. It needs a rewrite by
   someone who sells freight in Arabic, not a translation pass — the same rule
   the product follows.
4. **Compress the images.** `pic/` is roughly 8 MB unoptimised. Resize the
   screenshots to their display width and convert everything to WebP or AVIF
   before this is served to anyone on a phone.
5. **Legal pages.** Privacy policy naming the hosting region and retention
   period, terms of service, data-processing addendum. A prospect's IT reviewer
   looks for these before they look at the product.
6. **`hello@cargosharks.com` and the domain** are placeholders until the domain
   is actually held.
