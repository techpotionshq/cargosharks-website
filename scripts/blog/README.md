# Blog pipeline

A blog automation for a static site. There is no CMS, so there is no draft
button: a draft is a pull request, and merging it is publishing.

```
Coolify, daily    → trigger.mjs → GitHub API: run workflow "Blog" (task=auto)
blog.yml          → backlog low? blog:ideate → PR "Blog topics: …"     (label blog-topics)
                  → blog:generate → EN + AR post + cover → landing build → PR "Blog draft: …" (label blog-draft)
                  → Slack: link to the PR
You               → review the PR, edit if needed, merge
main              → Coolify rebuilds the landing site; the post is live
blog-indexnow.yml → waits for the URLs to answer 200, submits them to IndexNow
```

## Files

| File                         | What it is                                                                           |
| ---------------------------- | ------------------------------------------------------------------------------------ |
| `topics.json`                | The backlog. Drafting takes the first `ready` topic, top to bottom.                  |
| `product-facts.md`           | The only product claims a post may make, and the paths it may link. Keep it current. |
| `generate.mjs`               | Drafts one post in English, then Arabic, plus a cover. Checks every internal link.   |
| `ideate.mjs`                 | Refills the backlog from Google autocomplete (English and Arabic, Gulf) and SearXNG. |
| `indexnow.mjs`               | Submits live post URLs to IndexNow. The key is `public/<key>.txt`.                   |
| `trigger.mjs`                | The daily cron: starts `blog.yml` through the GitHub API. Run by Coolify.            |
| `lib.mjs`                    | OpenRouter, SearXNG and the backlog helpers the scripts share.                       |
| `../../content/blog/<slug>/` | A post: `post.json`, `en.md`, `ar.md`. Read and validated by `src/lib/blog.ts`.      |

## Running it by hand

```bash
cd apps/landing
OPENROUTER_API_KEY=… pnpm blog:generate               # next ready topic
OPENROUTER_API_KEY=… pnpm blog:generate -- --dry      # print, write nothing
OPENROUTER_API_KEY=… pnpm blog:ideate -- --dry
pnpm blog:ideate -- --signals                         # the inputs only, no key needed
node scripts/blog/trigger.mjs --dry                   # the request the cron sends
```

Or from the repository's Actions tab: **Blog → Run workflow**, with `task` to
run only one half.

## Steering

- **Add a topic** by appending to `topics.json` with `"status": "ready"`.
  Put it higher in the list to have it drafted sooner.
- **Veto one** by setting `"status": "rejected"`.
- **Reject a draft** by closing its PR without merging. Its topic is then
  skipped for good, so it does not come back the next morning. To try the
  topic again, give it a new `id` in `topics.json`.
- **Comparison, alternatives and use-case topics need an `expertNote`**:
  first-hand detail from the team (what customers asked, what broke, real
  numbers). Without one they are skipped, because a model must not invent it.
  Ideation never proposes them.
- **`publishedAt` is today or earlier.** A future date fails the build rather
  than holding the post back: the site rebuilds only on a push to `main`, so
  nothing would publish it on the day.

## Setup, once

**GitHub**, in the repository's Settings:

1. Secrets and variables, Actions, **Secrets**: `OPENROUTER_API_KEY`
   (required), `SLACK_BOT_TOKEN` (optional: a bot with `chat:write`, invited
   to the channel). Both can be set by any collaborator with write access,
   with `gh secret set <NAME> --repo majwadalam/cargosharks`.
2. Same page, **Variables** (all optional): `SLACK_BLOG_CHANNEL` (default
   `#blog-automation`), `SEARXNG_URL`, `OPENROUTER_MODEL`.
3. Actions, General, Workflow permissions: tick **Allow GitHub Actions to
   create and approve pull requests**. Admin only.

**The daily trigger token.** A fine-grained personal access token, created by
the repository's owner (a fine-grained token only reaches repositories its
owner owns): Settings → Developer settings → Fine-grained tokens. Repository
access: only `cargosharks`. Permissions: **Actions: Read and write**, nothing
else.

**Coolify**, on the `cargosharks` application (the one that runs `landing`):

1. **Environment Variables**: `BLOG_DISPATCH_TOKEN` = the token above. Add
   `SLACK_BOT_TOKEN` (and `SLACK_BLOG_CHANNEL` if not `#blog-automation`) to
   be told in Slack when the trigger fails. Coolify hands the application's
   variables to every container in the stack; `landing` reads only these.
2. **Redeploy**, so the `landing` image carries `scripts/trigger.mjs`.
3. **Scheduled Tasks → Add**:

   | Field     | Value                      |
   | --------- | -------------------------- |
   | Name      | `blog trigger`             |
   | Command   | `node scripts/trigger.mjs` |
   | Frequency | `0 3 * * *`                |
   | Container | `landing`                  |

   `0 3 * * *` is 03:00 UTC, 06:00 in Kuwait, assuming the server's timezone
   in Coolify is UTC (Servers → General). Adjust the hour if it is not.

4. Run the task once from Coolify. `trigger: Blog run started` in its log,
   and a new run under the repository's Actions tab, means it works.

What the trigger alerts on and what the workflow alerts on are different
failures. The trigger only knows whether the run _started_: GitHub answers
`204` at once, and anything else exits non-zero, shows as failed in Coolify
and posts to Slack. Whether the run drafted anything, found nothing to draft,
or failed is posted to Slack by the workflow's own **Tell Slack** step.

## Things to know

- Pull requests opened by the workflow do not start CI on their own; that is
  how GitHub treats `GITHUB_TOKEN`. The workflow builds the landing site
  itself, which is the check that matters for a post.
- Two draft PRs open at once both edit `topics.json`, on different lines, so
  they merge cleanly in either order.
- Cross-posting (dev.to, LinkedIn) is deliberately not wired up. If it is
  added later, posts need `canonicalUrl` set to the cargosharks.com page.
