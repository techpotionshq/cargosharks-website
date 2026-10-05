// Local stand-in for the hosted model, loaded into the service with --import
// when the guide records on the seeded stack. Intercepts fetch() calls to
// openrouter.ai and answers with a deterministic reading of the story's
// scripted messages, so a recording never depends on (or pays for) a model.
// Nothing leaves the machine.
const realFetch = globalThis.fetch

function textOf(messages) {
  return messages
    .filter((m) => m.role === 'user')
    .map((m) =>
      typeof m.content === 'string'
        ? m.content
        : m.content
            .filter((c) => c.type === 'text')
            .map((c) => c.text)
            .join('\n'),
    )
    .join('\n')
}

function find(text, re) {
  const m = text.match(re)
  return m ? m[0] : null
}

function enquiry(text) {
  const fields = []
  const add = (field, value, evidence, confidence = 0.92) =>
    fields.push({ field, value, confidence, evidence })
  const cont = find(text, /\b\d+\s*(x\s*)?containers?\b/i)
  if (cont) {
    add('mode', 'sea_fcl', cont)
    add('containerCount', cont.match(/\d+/)[0], cont)
    add('tradeDirection', 'import', find(text, /to\s+[A-Z][a-z]+[^.\n]*Kuwait/) ?? cont, 0.8)
  }
  const org = find(text, /from\s+(Shanghai|Ningbo)/i)
  if (org) add('origin', org.replace(/from\s+/i, ''), org)
  const dst = find(text, /Shuwaikh[^.\n]*/i)
  if (dst) add('destination', 'Shuwaikh Port', dst)
  const furn = find(text, /office furniture/i)
  if (furn) add('commodity', 'Furniture', furn)
  const hc = find(text, /40\s*(ft|foot)?\s*high\s*cube/i)
  if (hc) add('containerType', '40HC', hc)
  const ready = find(text, /ready (around|on|by)\s+\d{1,2}\s+October/i)
  if (ready) add('readyOn', `2026-10-${ready.match(/\d{1,2}/)[0].padStart(2, '0')}`, ready, 0.85)
  const kg = find(text, /\d[\d,]*\s*kg/i)
  if (kg) add('grossWeightKg', kg.replace(/[^\d]/g, ''), kg, 0.88)
  const fob = find(text, /\bFOB\b/)
  if (fob) add('incoterm', 'FOB', fob)
  return { fields, confidence: fields.length ? 0.9 : 0.2 }
}

function rate(text) {
  const lines = []
  const currency = find(text, /\bUSD\b/) ? 'USD' : 'KWD'
  const re =
    /^(Ocean freight|THC origin|THC destination|Documentation|Delivery order)[^:]*:\s*(USD|KWD)\s*([\d,.]+)/gim
  const keys = {
    'ocean freight': ['ocean_freight', 'per_container', '40HC'],
    'thc origin': ['thc_origin', 'per_container', '40HC'],
    'thc destination': ['thc_destination', 'per_container', '40HC'],
    documentation: ['documentation', 'flat', null],
    'delivery order': ['delivery_order', 'flat', null],
  }
  let m
  while ((m = re.exec(text))) {
    const [key, basis, ct] = keys[m[1].toLowerCase()]
    lines.push({
      chargeType: key,
      basis,
      rate: m[3].replace(/,/g, ''),
      currency: m[2],
      minimum: null,
      maximum: null,
      containerType: ct,
    })
  }
  const valid = find(text, /valid (until|to)\s+\d{1,2}\s+(October|November|December)\s+2026/i)
  let validTo = null
  if (valid) {
    const months = { october: '10', november: '11', december: '12' }
    const d = valid.match(/(\d{1,2})\s+(\w+)\s+2026/)
    validTo = `2026-${months[d[2].toLowerCase()]}-${d[1].padStart(2, '0')}`
  }
  return {
    declined: false,
    declinedReason: null,
    currency,
    validFrom: '2026-10-01',
    validTo,
    origin: null,
    destination: null,
    mode: null,
    lines,
    confidence: lines.length ? 0.9 : 0.1,
  }
}

function completion(content) {
  return new Response(
    JSON.stringify({
      id: 'local-' + Date.now(),
      model: 'demo-model',
      choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content } }],
      usage: { prompt_tokens: 900, completion_tokens: 120, cost: 0.0004 },
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  )
}

globalThis.fetch = async function (input, init) {
  const url = typeof input === 'string' ? input : (input?.url ?? String(input))
  if (!url.startsWith('https://openrouter.ai/')) return realFetch(input, init)
  const body = JSON.parse(init?.body ?? '{}')
  const schema = body.response_format?.json_schema?.schema
  const text = textOf(body.messages ?? [])
  await new Promise((r) => setTimeout(r, 400))
  if (schema?.properties?.fields) return completion(JSON.stringify(enquiry(text)))
  if (schema?.properties?.declined) return completion(JSON.stringify(rate(text)))
  if (schema)
    return new Response(JSON.stringify({ error: { message: 'not simulated' } }), { status: 400 })
  // Plain prose: the quotation's covering note.
  return completion(
    'Thank you for your enquiry. Please find our quotation for your two 40 foot high cube containers below. ' +
      'The price covers ocean freight, terminal handling at the port of loading and documentation. Our team will confirm the sailing as soon as you accept.',
  )
}
