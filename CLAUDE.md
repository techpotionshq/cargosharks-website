@AGENTS.md

# cargosharks.com — working notes

The CargoSharks marketing site and blog, in English and Arabic. Next.js 16 with
Payload CMS 3 at `/admin`, PostgreSQL behind it, one container on Coolify.

Marketing pages prerender at build time. The blog, the sitemap, the feed and
`llms.txt` read published posts from Payload at request time and cache them
under the `blog` tag; a publish in the admin revalidates that tag, so a post is
live the moment it is published, with no rebuild and no pull request.

It used to live in the product repository (majwadalam/cargosharks) as
`apps/landing`, and its history came with it. The product (the freight
platform itself) stays there; this repository holds only the website.

## Commands

```bash
pnpm dev          # http://localhost:3002
pnpm lint         # prettier + oxlint
pnpm typecheck
pnpm test         # vitest: blog rendering, link guards, FAQ guard, emails
pnpm build        # .next/standalone, no database needed
pnpm payload migrate:create <name>   # after changing a collection
```

`pnpm dev` and `pnpm start` need `DATABASE_URL` and `PAYLOAD_SECRET`
(`.env.example`). Migrations run when the server starts (`prodMigrations`);
`push` is off, so the schema only ever changes through a migration file in
`src/migrations/`. That directory holds migrations and nothing else: the CLI
runs every file in it.

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
- **The CMS is the source of truth for posts.** `src/cms/collections/` defines
  them; `src/lib/blog.ts` is the only reader. Drafts are never served to the
  public: `draftMode` (via `/preview?slug=`, behind an admin login) is the
  only way to see one.
