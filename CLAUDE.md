@AGENTS.md

# cargosharks.com — working notes

The CargoSharks marketing site and blog, in English and Arabic. Next.js 16,
static export, served by `scripts/preview.mjs` in one container on Coolify.

It used to live in the product repository (majwadalam/cargosharks) as
`apps/landing`, and its history came with it. The product (the freight
platform itself) stays there; this repository holds only the website.

## Commands

```bash
pnpm dev          # http://localhost:3002
pnpm lint         # prettier + oxlint
pnpm typecheck
pnpm test         # vitest: blog rendering, link guards, FAQ guard, emails
pnpm build        # writes out/
pnpm preview      # serves out/ the way production does
```

## Rules carried over

- **Both languages, always.** Every page has an English and an Arabic twin
  (`src/app/(en)` and `src/app/(ar)/ar`). Copy lives in `src/content/copy.ts`
  with `en` and `ar` side by side. CSS uses logical properties (`ms-`/`me-`,
  never `ml-`/`mr-`).
- **The brand is data.** `src/brand/` is vendored from the product's
  `packages/brand`, CargoSharks only. Colours come from `src/app/palette.css`.
- **No email address written out in a page.** `src/components/Email.tsx`
  assembles them in the browser; `test/email.test.ts` enforces it.
- **Product claims come from `scripts/blog/product-facts.md`.** The blog
  generator may say nothing about the product that is not in that file.
- Comments explain why. Commit messages are imperative prose.
