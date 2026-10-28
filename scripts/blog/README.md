# Blog pipeline

Posts live in Payload (`/admin`), in PostgreSQL. Every Sunday the week's
topics are queued at once; a model drafts one post a day from them; a
person reads it, edits it if needed, and presses Publish. Publishing is the
whole release: the blog, the sitemap, the feed and `llms.txt` revalidate on
the spot, Slack gets the links, and IndexNow gets the URLs.

```
Coolify, Sunday → node scripts/cron.mjs topics → POST /cron/topics/ → 12 topics → Slack list
Coolify, daily  → node scripts/cron.mjs → POST /cron/blog/ (Bearer CRON_SECRET)
/cron/blog      → oldest ready topic (queue empty? propose 3 as a fallback)
                → generate.mjs drafts EN + AR, a Pexels cover → a draft in Posts → Slack: Preview / Edit
You             → /admin: read, edit, Publish
Publish         → revalidateTag('blog') → live, no rebuild → Slack + IndexNow
```

## Files

| File                               | What it is                                                                           |
| ---------------------------------- | ------------------------------------------------------------------------------------ |
| `product-facts.md`                 | The only product claims a post may make, and the paths it may link. Keep it current. |
| `generate.mjs`                     | Drafts one post in English, then Arabic, plus a cover. Checks every internal link.   |
| `ideate.mjs`                       | Proposes topics from Google autocomplete (English and Arabic, Gulf) and SearXNG.     |
| `lib.mjs`                          | OpenRouter, SearXNG and the link helpers the scripts share.                          |
| `../cron.mjs`                      | What the Coolify scheduled task runs. Calls the route below on this container.       |
| `../../src/app/cron/blog/route.ts` | Picks a topic, drafts, writes the draft and its cover into Payload.                  |
| `../../src/cms/collections/`       | Posts, Topics, Media, Users.                                                         |

## Steering, all in /admin

- **Add a topic** in Topics with status `ready`. The oldest ready topic is
  drafted first.
- **Veto one** by setting it to `rejected`.
- **Reject a draft** by leaving it unpublished. Its topic is already marked
  `written`, so it does not come back; set the topic back to `ready` to try
  again.
- **Comparison, alternatives and use-case topics need an `expertNote`**:
  first-hand detail from the team. Without one they are skipped, because a
  model must not invent it.
- **Covers are stock photographs from Pexels**, chosen from a search the
  model writes for the post, never one already used on the site, and credited
  under the cover. Swap one by uploading a different image to the post's
  Cover field.
- **Preview** from the post's Preview button, or the Slack message's link.
  It needs an admin login; the public never sees a draft.

## Running it by hand

```bash
curl -X POST -H "Authorization: Bearer $CRON_SECRET" https://cargosharks.com/cron/blog/
# or, inside the container:
node scripts/cron.mjs
```

## Setup, once, on Coolify

1. A PostgreSQL resource with a database for the CMS.
2. On the website application, **Environment Variables**: `DATABASE_URL`,
   `PAYLOAD_SECRET` (random, 32+ bytes), `CRON_SECRET` (random),
   `SITE_URL=https://cargosharks.com`, `OPENROUTER_API_KEY`, `PEXELS_API_KEY`
   (cover photos), and optionally
   `SLACK_BOT_TOKEN`, `SLACK_BLOG_CHANNEL`, `SEARXNG_URL`, `OPENROUTER_MODEL`.
3. **Storages**: a volume mounted at `/app/media`, or uploads vanish on deploy.
4. **Scheduled Tasks**: `node scripts/cron.mjs topics` on Sundays at
   `0 2 * * 0`, and `node scripts/cron.mjs` daily at `0 3 * * *` (05:00 and
   06:00 in Kuwait when the server is on UTC). `BLOG_TOPICS_PER_WEEK` changes
   the weekly count (12).
5. Deploy, open `/admin`, create the first user. The seed migration loads the
   existing posts and the topic backlog on first start.

## Things to know

- Cross-posting (dev.to, LinkedIn) is deliberately not wired up. If it is
  added later, posts need a canonical URL set to the cargosharks.com page.
