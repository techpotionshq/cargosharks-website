# CargoSharks marketing site

A Next.js app that builds to static files. Nine pages, two languages, no server.

```bash
pnpm dev:landing        # http://localhost:3002
pnpm build:landing      # writes apps/landing/out/
pnpm preview:landing    # serves out/ the way a static host will
```

`out/` is what deploys. Point any static host at that one directory: there is
no Node process to keep alive, no runtime to patch, and nothing in the
repository outside it is exposed.

**Use `preview` rather than `dev` to check anything about paths.** The dev
server rewrites, falls back, and thinks in routes; a static host thinks in
files. `scripts/preview.mjs` does what the host does and nothing else — a
directory gets its `index.html`, an unknown path gets `404.html` with a real 404
status — which is the only way to catch a link that works in development and
dies in production.

## Why a framework at all

The site was nine hand-written HTML files with a shared stylesheet and a shared
script, which was the right shape while it was nine files that mostly said the
same thing. It stopped being the right shape twice over.

**The home page outgrew it.** A scroll-driven sequence with a pinned product
frame, a language switch that flips a real screenshot, and a counter running off
`requestAnimationFrame` is an application, and it had an English copy and an
Arabic copy that were kept in step by hand. They did not stay in step: a
correction landed in `index.html` and not in `ar.html` more than once, and for a
while the two languages made different claims about the same product.

**The other pages drifted from it.** They carried their own header markup, their
own footer, their own nav labels and their own copy of the scroll behaviour, and
every one of those was a thing to remember. The nav said "What it does" while
the page it opened was called "What we do"; the lockup was 26px in one place and
30px in the other; the shell was 1200px here and 1248px there, so the logo
stepped forty pixels sideways on the click through.

None of that is a problem any more, because there is one header, one footer, one
shell and one copy file.

## What is here

```
next.config.ts               static export, no image optimiser, trailing slashes
scripts/postbuild.mjs        copies the two error routes to 404.html / 500.html
scripts/preview.mjs          serves out/ the way a host will
src/app/(en)/                English root layout + / and the six document routes
src/app/(ar)/                Arabic root layout and home page
src/app/globals.css          the stylesheet for the app's own pages
src/app/pages.css            the stylesheet for the imported documents
src/components/              sections, header, footer, the counter
src/components/Calculator.tsx     the free-time calculator, the one thing you operate
src/content/copy.ts          every word of the home page, both languages
src/content/pages/           the five imported documents
src/lib/fonts.ts             Manrope, IBM Plex Mono, IBM Plex Sans Arabic
public/cargosharks-logo/     the supplied mark — do not edit, it is the source
public/pic/screens/          real captures of the running product
public/pic/photos/           stock photography (Unsplash licence, commercial use)
                             three are used, one per dark band: the port behind the
                             hero, the yard behind demurrage, the ship behind the close
```

`public/` holds nothing but assets now. Every page is a route.

| Route | What it is |
|---|---|
| `/` and `/ar/` | the home page, eight blocks, ~9,200px |
| `/what-we-do/` | the product explained standalone, for arrivals from search |
| `/compare/` | how we are different, and who we are not for |
| `/privacy/` `/terms/` `/dpa/` | **unreviewed drafts** — see below |
| `/not-found/` `/server-error/` | copied to `404.html` and `500.html` at build |

The two error routes are named that way because Next silently drops a folder
called `404` from the route table: the build passes, the copy runs, and the file
copied is Next's own built-in 404 onto itself.

## The imported documents

`src/content/pages/*.tsx` were hand-written HTML until the site became an app.
They were converted **mechanically, by a script**, and that was the point:
between them they carry fifty-three `[TO CONFIRM]` markers, a clause-numbering
scheme people quote back in emails, and a great deal of prose that says exactly
what the software does and no more. Retyping that into JSX by hand is the most
expensive way to introduce an error in this repository — a dropped `not` in a
clause is invisible in review and consequential in a way a layout bug never is.

The HTML originals are gone and those files are the source now. **Edit them
there.** They read oddly for React components — plain markup, no props, no
composition — because they are documents, and breaking them up would be the
retyping the conversion avoided.

`src/app/pages.css` is their stylesheet, and it came across the same way. Every
selector in it is scoped under `.doc-page`, which `DocPage.tsx` puts on the
`<main>` around them, so it cannot collide with `globals.css` — both define
`.shell`. Every colour in it is a `--qb-*` token; there were 132 literals and
each was an approximation of a stop `@qabandi/brand` already publishes.

## The two languages

There is no root layout. Each language is a route group with its own — `(en)`
and `(ar)` — so `lang` and `dir` are real attributes on the document rather than
something JavaScript patches on after hydration. `src/components/Document.tsx`
holds everything the two documents share, so neither gets a chance to drift.

Everything Arabic-specific is the `[dir='rtl']` block in `globals.css`: the font
stack, the heading leading, and the label tracking that would otherwise prise
Arabic joins apart. **Add to that block rather than starting a second
stylesheet.** Arabic set *inside* an English document — the 404, the language
switch, the bilingual toggle — takes `.arabic`, and if it is a block, an
`.arabic-block` wrapper around it. That wrapper is not decoration: a `dir="rtl"`
block narrower than its parent resolves its auto margins in its own direction
and pins itself to the far right of the viewport.

Only the home page has an Arabic twin. The six document routes do not, which is
why none of them declares an `hreflang` alternate; their language switch points
at `/ar/`, because that is the only Arabic entry point there is, and no Arabic
entry point at all is the worse answer on the site whose argument is that Arabic
is not an afterthought.

The Arabic captures in `pic/screens/*-ar.webp` are separate files, not the
English ones mirrored. The sidebar crop is a logical property, so on an RTL
document it takes its bite out of the right edge — which is where the sidebar is
only in an RTL capture.

## Design

**Two measures, concentric.** `.shell` is `75rem` with a
`clamp(20px, 5vw, 56px)` gutter and it carries every word on the site — it is
shared with the five imported documents and with the header, which is what stops
the lockup stepping sideways on a click-through. `.shell-wide` is `84rem` on the
same centre and the same gutter, and it carries nothing but product frames: a
1440-wide capture rendered into a 1200-wide text column has its sidebar labels at
about nine pixels, which defeats the only reason a screenshot is on the page.
Anything wider than `.shell` is bleeding out of it deliberately.

The home page is eight blocks and about 9,200px. It was eleven sections and
14,086px two rewrites ago. What was cut then is still gone — the pain points,
the six-state loop, the scope table and the ownership argument are
`/what-we-do/`, and the comparison is `/compare/`.

**Centred, and that is a layout decision with a reason.** Every block used to be
a five-column copy rail beside a seven-column picture. At 1440 that gives the
copy about 460px — a nine-word headline over three lines — and the product about
700px, which is backwards: the text needed a third of the width it was given and
the screenshot needed all of it. One centred column with the frames running wider
lets the product be the largest thing on the page, which is the one argument a
competitor cannot copy in an afternoon.

### The page is light, and here is what that ruled out

The second version of this page was near-black navy end to end, with a blue
radial glow behind the headline, a glass pill above it carrying a pulsing green
dot, `font-extrabold` display type at `-0.04em`, fully-rounded buttons, a
screenshot in a browser frame with a second glow behind it, a five-figure stat
bar, and a grid of `rounded-2xl` cards each with a Phosphor glyph in a
rounded-square chip. Every one of those is a real technique. All of them
together are the default output of the tools that generate landing pages, and it
read that way — which is fatal for a page whose argument is that the software
was built by people who have seen a demurrage invoice.

It was rebuilt against four sites in or near this market: **CargoWise**,
**tentrucks**, **Terminal** and **Stripe**. The overlap between them turned out
to be specific and almost entirely about restraint:

| They do | We now do | We used to do |
|---|---|---|
| Light ground, dark bands as punctuation | paper, three dark bands | near-black throughout |
| Display weight ~400–500 | `font-medium`, `-0.02em` | `font-extrabold`, `-0.04em` |
| Photography carries the colour | three full-bleed photographs | a `radial-gradient` glow |
| Hairline-divided cells | `gap-px` over `bg-line` | floating `rounded-2xl` cards |
| Small radii, mono micro-labels | `rounded-lg`, `.tracked` | pill buttons, sentence case |
| One oddly specific live number | the accruing figure, in a caption | a stat bar of five |
| Something the reader operates | the free-time calculator | — |

Not one of those is fashion. A light page with a saturated photograph on it has
somewhere for the eye to rest; a dark page with a glow behind every heading does
not.

**Corners are rounded, and the frames all share one radius.** An earlier pass
gave the dark panels and product frames a clipped corner — a filing-tab shape,
on the reasoning that it was a form a forwarder handles all day and that
`rounded-2xl` is the framework's default and therefore everybody's. It read as
an affectation on a photograph of a real product, which is the more expensive
kind of wrong: a shape nobody can name is a shape that distracts. The frames are
`rounded-2xl` with a hairline border, and the shape language the site owns is the
hairline grid instead.

**The calculator is the centrepiece and it does not claim a saving.** Every
calculator in this category ends with "you would save 23% with us" — a figure
nobody can check and which this product has no pilot data to support. This one
returns the reader's own exposure and then says in as many words that CargoSharks
does not make the number smaller; what it does is make it arrive on the day the
clock starts rather than six weeks later on a supplier invoice. That is a claim
about the code and it is true, which is the rule `docs/marketing/README.md` sets
for the whole document set.

**Colour lives in `src/app/palette.css`, and only there.** This site used to
derive every value from `@qabandi/brand`'s `--qb-*` ramps, so that an operator
re-skinning the product would not find the marketing page in somebody else's
blue. That is still the rule in `apps/web` and the PDF renderer and it is still
enforced there. It was the wrong rule here: every colour ended up two or three
`color-mix()` calls deep, so "make the header brighter" meant reasoning about
what `neutral-50` mixed 35% into white then 78% into transparent lands at, and
the answer kept being mid-grey. A palette you cannot see is a palette you cannot
tune.

`scripts/check-brand.mjs` allows that one file by name — not the app — so a hex
in a component still fails the build. The trade is written at the top of
`palette.css`: if the product is ever re-skinned, that file is the work.

Typefaces did *not* move. They are still `@qabandi/brand`, because the supplied
wordmark is Manrope ExtraBold converted to outlines and `apps/web` sets Arabic
in the same IBM Plex Sans Arabic — a palette is a look, a typeface here is a
fact about an asset that ships.

Type is Manrope, because the supplied wordmark is Manrope ExtraBold converted to
outlines. IBM Plex Mono carries every label, eyebrow, figure and status pill,
which is the product's own convention: data is set in mono.

The wordmark is the **supplied lockup**, as an image, not the name set live. It
was live text for a while, on the reasoning that the outlines are Manrope
anyway — but the artwork sets the name lowercase and in two colours while
`brand.identity.nameEn` is `CargoSharks`, so the home page was showing a
different logo from the pages linked off it and from the file the operator
prints on their letterhead. A wordmark is artwork, not a string.

Icons are [Phosphor](https://phosphoricons.com), imported from
`@phosphor-icons/react/dist/ssr` so they render on the server, and there are
seven of them on the home page. They are used where they carry meaning — the
three desks, the three demo roles, the demurrage clock — and nowhere else; the
nine bullets under the desks have a rule rather than a glyph each, because a
column of decorative icons is the thing that makes a page look generated.

**There are no animations beyond motion.** There were two Lottie files,
generated from the logo geometry and a sine wave, and they were decoration
standing where an argument should be: at the opacity that kept them from
competing with the figures they sat behind, they read as smudges. `motion`
drives the scroll parallax, the stage cross-fade and the language pill, and
nothing else moves.

## Where the content came from

Nothing was invented. The home page copy is
[`docs/marketing/sales/website-copy.md`](../../docs/marketing/sales/website-copy.md),
and the Arabic is carried over from the previous site's `ar.html`, which took
its vocabulary from `apps/web/messages/ar.json` so that a prospect reads
«بوليصة الشحن الفرعية» here and sees the same string on the document the demo
issues.

### The figures quoted, and how to re-check them

| Figure | Where | Verify with |
|---|---|---|
| **2,701 interface strings**, EN and AR in sync | proof strip | `node -e "const c=o=>Object.values(o).reduce((n,v)=>n+(typeof v==='object'&&v?c(v):1),0);for(const f of ['en','ar'])console.log(f,c(require('./apps/web/messages/'+f+'.json')))"` |
| **197 row-level policies, 80 audit triggers** | proof strip | `README.md` §Status — verified against a live PostgreSQL 18.6 |
| **Five transport modes** | hero, proof strip, `/what-we-do/` §03 | `packages/db/src/schema/enums.ts` → `modeEnum` |
| **Three decimals on every dinar** | proof strip | `CLAUDE.md` §Non-negotiables; `packages/core` money tests |
| Every divisor, increment and minimum | `/what-we-do/` §03 | `packages/core/src/chargeable.ts` — they are seed rows, not numbers written for a website |

## Before this goes live

1. **A demo has to be deployed at the address the page links to.** Both
   languages send their first call to action to `https://demo.cargosharks.com`,
   and the demo block prints three sign-ins and a password. Nothing is standing
   there yet. What to deploy is in
   [`docs/Deployment_Coolify.md`](../../docs/Deployment_Coolify.md) §7 — the
   release image with `QABANDI_PILOT_FIXTURES=1`, `QABANDI_DEMO_LOGIN=1` and
   **no** `DATABASE_URL`. Until it exists the page's strongest claim is a broken
   link, which is worse than not making it.
2. **The three legal pages are unreviewed drafts and say so three times each,**
   and carry `robots: noindex` until they are not. They were written from the
   codebase — the schema, the migrations, the integration adapters — which makes
   them accurate about mechanism and deliberately incomplete about law. **They
   must not go live in this state.** Every open decision is marked
   `[TO CONFIRM: …]`: 17 in the privacy policy, 21 in the terms, 15 in the
   addendum. Two are for counsel first: there is no erasure mechanism anywhere
   in the product, and destroying data at the end of an engagement is an
   infrastructure act rather than a function inside the software. Both are
   written down rather than smoothed over (`/privacy/` §09, `/dpa/` §11 and §14).

   No certification is claimed on any page — no SOC 2, no ISO 27001, no "GDPR
   compliant". Keep it that way until one exists.
3. **The Arabic has not been read by a native reviewer.** It was written, not
   translated. What a reviewer still has to settle: «مُشغِّل» for a database
   *trigger* is a coinage the deck invented and `ar.json` does not fix,
   «الترسية» for *award* is Gulf tender vocabulary, and «ماذا نفعل» and
   «كيف نقارن» in the navigation are new here.
4. **`hello@cargosharks.com` and the domain** are placeholders until the domain
   is held. So is `demo.cargosharks.com`. The three demo addresses are
   `.example`, which RFC 2606 reserves and nobody can register — deliberately,
   because a credential printed on a public page should not resolve to a mailbox
   anyone could be persuaded to send something to.
