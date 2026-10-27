/**
 * The blog's daily run, as a Coolify scheduled task in this container:
 *
 *   node scripts/cron.mjs
 *
 * Calls the app's own `/cron/blog/` with `CRON_SECRET`, so the run happens in
 * the server process that already holds the CMS connection. Node's `fetch`,
 * nothing to install. Exits non-zero when the run fails, so Coolify shows it.
 */
const port = process.env.PORT || 3002
const secret = process.env.CRON_SECRET
if (!secret) {
  console.error('cron: CRON_SECRET is not set')
  process.exit(1)
}

const res = await fetch(`http://127.0.0.1:${port}/cron/blog/`, {
  method: 'POST',
  headers: { authorization: `Bearer ${secret}` },
  signal: AbortSignal.timeout(15 * 60_000),
})
const body = await res.text()
console.log(`cron: ${res.status} ${body}`)
process.exit(res.ok ? 0 : 1)
