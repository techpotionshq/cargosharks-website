# The user guide

The manual (HTML and PDF) and the one-minute shorts are built from the sources in this
directory by `tools/guide`. Nothing built is committed: pictures, videos and voice lines live in
a cache outside git, keyed by a hash of everything that went into them, so a rebuild only
re-renders what a change actually touched.

```bash
pnpm guide:build              # manual + every short (only what changed is re-rendered)
pnpm guide:build manual       # the manual alone;  pnpm guide:build manual 08 09  for sections
pnpm guide:build shorts 04    # one short (id or prefix)
pnpm guide:stale              # what a branch makes out of date, without building anything
pnpm guide:voice              # the voiced shorts (Marin, through OpenRouter)
pnpm guide:publish --dry-run  # what would be uploaded to R2
pnpm guide stack up|down [fixtures|seeded]
pnpm guide cache prune --days 30
```

Outputs land in `docs/guide/out/` (gitignored): `manual/en/index.html`, the PDF beside it,
`shorts/<id>.mp4` with `.srt`, `-script.md` and `-check.txt`, and `shorts-voiced/`.

## What is here

| Path | What it is |
|---|---|
| `manual/<locale>/NN-slug.md` | One manual section per file, in file order. English now; Arabic later from the same structure. |
| `shorts/NN-slug.mjs` | One short per file: steps with an id, a label, actions, focus targets and a caption. |
| `captions/<locale>.json` | Every caption (and so every voice line), by key. |
| `story/index.mjs` | The seeded story the action shorts are recorded in. |
| `out/` | Built outputs. Not committed. |

## Writing a manual section

Front matter names what the section describes. `guide:stale` uses it to say when the words may
need a person's eye, even where the section has no picture:

```markdown
---
title: Shipments
routes: [/jobs, /jobs/[id]]
messages: [jobActions.setStatus]
components: [apps/web/src/features/jobs/ui/status-dialog.tsx]
---
```

Three things the build adds to pandoc Markdown:

- **Product labels by key.** Write `[{app:jobActions.setStatus}]{.ui}`, never the label itself.
  The build puts in whatever the product calls the button today, so a rename updates the manual,
  the captions and the voice-over together. `{app:documentActions.issueIn,language=ar}` fills an
  ICU argument. `{brand}` is the branch's company name.
- **Screenshots as directives.** `![Caption](shot:/invoices?focus=role=table)`. The page is the
  path; the shot's own options are `viewport` (desktop, phone), `locale`, `who` (operations,
  customer, agent, none), `click`, `fill=sel=>text`, `scroll`, `focus`, `mark=n:sel`, `crop`,
  `hide`, `full`, `pdf`, `wait`, and `stack=seeded&snapshot=<chapter>` for pages only the real
  service can draw. Selectors are Playwright's (role, text, `[data-guide=…]`, CSS), never
  coordinates. Where the product has no stable handle, add a `data-guide` attribute (see the
  dashboard's four numbers) rather than a brittle selector.
- **House blocks** as fenced divs: `::: intro`, `::: steps` (around an ordered list), `::: tip`,
  `::: warn`, `::: note`, `::: phone` (pictures side by side).

## Writing a short

```js
export default {
  id: '04-shipments-and-milestones',
  title: 'Shipments and milestones',
  stack: 'seeded', snapshot: 'booked',      // or stack: 'fixtures'
  routes: ['/jobs', '/jobs/[id]', '/track'],  // the screens it shows (cache and stale deps)
  start: '/jobs',
  steps: [
    {
      id: 'stage',
      label: '{app:jobActions.setStatus}',                       // the pill in the corner
      caption: { key: 'shorts.04-shipments-and-milestones.stage' },
      run: async (r, a, ctx) => { /* r: recorder, a: annotations, ctx.t(key) */ },
      leave: async (r, a) => { /* moves to the next screen, after the hold */ },
    },
  ],
}
```

The rules the runner enforces, so a spec does not have to:

- The intro card (1.5 s) and end card (2 s) are static. Annotations are drawn in screen space
  only after a zoom has settled, and measured twice; `-check.txt` reports any drift.
- The step label and the caption change on the same frame.
- A caption stays up for at least *words ÷ 2.6 + 0.4* seconds (voiced: until its line is
  spoken). A short step is held on its last frame, annotation still drawn, before `leave` moves on.
- `r.cut(fn)` removes page loads and waiting from the video.

## The two stacks

**fixtures** is the web app alone on the pilot fixtures (`QABANDI_PILOT_FIXTURES=1`), with the
demo sign-in for the customer and agent views. No database. The clock is pinned to
`GUIDE_NOW` (default 14 Oct 2026, 09:30 Kuwait) on the server and in the browser, so the data
is the same on every build. Every manual picture and every read-only short uses it.

**seeded** is PostgreSQL, the service and the web app, with local stand-ins for WhatsApp
(`mock-kapso.mjs`), IMAP and the model (`fake-model.mjs`). It replays `story/index.mjs`, keeping
a PostgreSQL snapshot after each chapter, named by a hash of what produced it; a short is
recorded on a fresh copy of its chapter. It needs a local database cluster and a file outside
the repository naming three connection strings:

```bash
GUIDE_SEEDED_ENV=~/guide-db.env pnpm guide:build shorts
# ADMIN_DATABASE_URL=postgres://postgres:…@127.0.0.1:5432/postgres
# MIGRATION_DATABASE_URL=postgres://app_migrator:…@127.0.0.1:5432/x
# DATABASE_URL=postgres://app_user:…@127.0.0.1:5432/x
```

Nothing on either stack reaches anything outside the machine except map tiles.

## The cache

`~/.cache/qabandi-guide` (or `GUIDE_CACHE`). Keys:

| Entry | Keyed by |
|---|---|
| screenshot | the directive, the screen's fingerprint (every file its page and layouts import, plus only the catalogue namespaces those files read), the stack's data, the brand, the shot code |
| recording | the spec file, the fingerprints of the screens it visits, its components, the product labels its callouts quote, the stack's data (fixtures moment or story chapter), the recorder code, the brand |
| segment | the recording, the step's frames, its resolved caption text, its hold, (voiced) its line's length |
| voice line | the words, the voice, the model, the prompt |
| story snapshot | the previous snapshot, the chapter's code, migrations and seeds |

So editing one caption re-renders one segment and one voice line; changing a screen re-shoots
the pictures of that screen and re-records the shorts that visit it, and nothing else.

## Brand

The guide wears the branch's brand: `DEFAULT_BRAND_KEY` in `packages/brand` (Al-Qabandi on
`qabandi`, CargoSharks on `main`). `GUIDE_BRAND` overrides it for a deliberate one-off; the
product's `BRAND` variable is ignored.

## Voice and publishing

`pnpm guide:voice` speaks any caption that has no cached line, with the Marin voice through
OpenRouter (`openai/gpt-audio-mini`), checks each take word for word against the transcript the
model returns (up to five tries), and mixes it over the short's music: ducked from 0.5 to 0.18
under speech, voice at -16 LUFS, cut to the sample. The key is read from `OPENROUTER_API_KEY` or
from the file `GUIDE_AI_ENV` names, only when a line has to be spoken. Earlier takes can seed the
cache: `pnpm guide voice import <dir-with-lines.tsv>`. Per-short music goes in
`GUIDE_MUSIC` (default `<cache>/music/<id>.mp3`); without it a soft pad is synthesised.

`pnpm guide:publish` uploads `out/` to R2 under `guide/<brand>/`, skipping every object whose
ETag already matches. Credentials come from `R2_ENDPOINT`, `R2_ACCESS_KEY_ID`,
`R2_SECRET_ACCESS_KEY` and `R2_BUCKET` (or the file `GUIDE_R2_ENV` names), never from the
repository.

## In CI

The `Guide` workflow runs `pnpm guide:stale` on every pull request and prints the list into the
run's summary. It never fails a pull request; building and publishing stay a person's call.
