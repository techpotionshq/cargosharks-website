/**
 * Start the Blog workflow on GitHub. The daily cron, run by Coolify.
 *
 * A Coolify scheduled task on the cargosharks deployment runs this once a day
 * inside the `landing` container (the Dockerfile copies it there next to
 * `preview.mjs`): `node scripts/trigger.mjs`, `0 3 * * *`, which is 06:00 in
 * Kuwait. The schedule lives in the repository so the whole pipeline can be
 * rebuilt from it, and depends on nothing the deployment does not already
 * run. Setup is in this folder's README.
 *
 * GitHub answers a `workflow_dispatch` with `204` and no body: the run has
 * been queued, nothing more. Whether it drafted a post, found nothing to draft
 * or failed is posted to Slack by the workflow itself. This script only has to
 * say whether the run *started*, so anything but a `204` exits non-zero and
 * shows as a failed run in Coolify, with a Slack message when a bot token is
 * set.
 *
 * Environment:
 *   BLOG_DISPATCH_TOKEN  required. A fine-grained token on majwadalam/cargosharks
 *                        with Actions: Read and write, and nothing else.
 *   SLACK_BOT_TOKEN      optional. The bot the workflow already posts with.
 *   SLACK_BLOG_CHANNEL   optional, default #blog-automation.
 *
 * `--dry` prints the request instead of sending it.
 *
 * Node's own `fetch` and nothing else: the landing image has no node_modules.
 */

const REPO = 'majwadalam/cargosharks'
const WORKFLOW = 'blog.yml'
const URL = `https://api.github.com/repos/${REPO}/actions/workflows/${WORKFLOW}/dispatches`
const BODY = { ref: 'main', inputs: { task: 'auto' } }

const token = process.env.BLOG_DISPATCH_TOKEN
const dry = process.argv.includes('--dry')

async function slack(text) {
  const bot = process.env.SLACK_BOT_TOKEN
  if (!bot) return
  try {
    const res = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${bot}`,
        'content-type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify({
        channel: process.env.SLACK_BLOG_CHANNEL || '#blog-automation',
        text,
        unfurl_links: false,
      }),
    })
    const json = await res.json()
    if (!json.ok) console.error('trigger: slack said', json.error)
  } catch (error) {
    console.error('trigger: slack unreachable:', error.message)
  }
}

async function fail(reason) {
  console.error(`trigger: ${reason}`)
  await slack(`CargoSharks blog: the daily trigger could not start the run. ${reason}`)
  process.exit(1)
}

if (dry) {
  console.log(`POST ${URL}\n${JSON.stringify(BODY)}`)
  process.exit(0)
}
if (!token) await fail('BLOG_DISPATCH_TOKEN is not set in the Coolify environment.')

// Three tries, five seconds apart, for the failures that are worth retrying: a
// network error or a 5xx. A 401, 403, 404 or 422 is a token or a workflow
// file that needs a person, and will not get better in five seconds.
let last = ''
for (let attempt = 1; attempt <= 3; attempt++) {
  try {
    const res = await fetch(URL, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28',
        'content-type': 'application/json',
        'user-agent': 'cargosharks-blog-trigger',
      },
      body: JSON.stringify(BODY),
    })
    if (res.status === 204) {
      console.log(`trigger: Blog run started on ${REPO} (task=auto)`)
      process.exit(0)
    }
    last = `GitHub answered ${res.status}: ${(await res.text()).slice(0, 300)}`
    if (res.status < 500) break
  } catch (error) {
    last = `GitHub unreachable: ${error.message}`
  }
  if (attempt < 3) await new Promise((r) => setTimeout(r, 5000))
}
await fail(last)
