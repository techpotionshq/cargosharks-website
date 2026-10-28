/**
 * The blog's daily run, as a Coolify scheduled task in this container:
 *
 *   node scripts/cron.mjs          daily: draft one post (/cron/blog/)
 *   node scripts/cron.mjs topics   Sundays: queue the week's topics (/cron/topics/)
 *
 * Calls the app's own `/cron/blog/` with `CRON_SECRET`, so the run happens in
 * the server process that already holds the CMS connection. Exits non-zero
 * when the run fails, so Coolify shows it.
 *
 * `node:http` rather than `fetch`: fetch gives up on a response whose headers
 * take over five minutes (undici's `headersTimeout`), and a draft in two
 * languages takes longer than that. The run finished on the server; the task
 * reported a failure.
 */
import { request } from 'node:http'

const port = process.env.PORT || 3002
const job = process.argv[2] === 'topics' ? 'topics' : 'blog'
const secret = process.env.CRON_SECRET
if (!secret) {
  console.error('cron: CRON_SECRET is not set')
  process.exit(1)
}

const { status, body } = await new Promise((resolve, reject) => {
  const req = request(
    {
      host: '127.0.0.1',
      port,
      path: `/cron/${job}/`,
      method: 'POST',
      headers: { authorization: `Bearer ${secret}` },
    },
    (res) => {
      let data = ''
      res.setEncoding('utf8')
      res.on('data', (chunk) => (data += chunk))
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: data }))
    },
  )
  // The route's own `maxDuration` is 15 minutes; a minute more here, so the
  // server's answer, not this timer, says how a long run ended.
  req.setTimeout(16 * 60_000, () => req.destroy(new Error('no answer in 16 minutes')))
  req.on('error', reject)
  req.end()
})
console.log(`cron: ${status} ${body}`)
process.exit(status >= 200 && status < 300 ? 0 : 1)
