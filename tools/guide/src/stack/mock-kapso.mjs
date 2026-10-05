// Local stand-in for Kapso's WhatsApp send endpoint, for the seeded stack.
// Every outbound message is appended to GUIDE_KAPSO_OUT and answered as sent;
// the real Kapso API is never called. Run as its own process by seeded.mjs.
import http from 'node:http'
import { appendFileSync } from 'node:fs'

const out = process.env.GUIDE_KAPSO_OUT
const port = Number(process.env.GUIDE_KAPSO_PORT ?? 3162)
let n = 0
http
  .createServer((req, res) => {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      let parsed = null
      try {
        parsed = body ? JSON.parse(body) : null
      } catch {}
      appendFileSync(
        out,
        JSON.stringify({ at: new Date().toISOString(), url: req.url, body: parsed }) + '\n',
      )
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(
        JSON.stringify({
          messaging_product: 'whatsapp',
          messages: [{ id: `wamid.LOCAL${Date.now()}${++n}` }],
        }),
      )
    })
  })
  .listen(port, '127.0.0.1')
