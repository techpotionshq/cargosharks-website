import config from '@payload-config'
import { getPayload } from 'payload'
import { slack } from '@/cms/notify'
import type { Lead } from '@/payload-types'

/**
 * `POST /contact/`: a pilot request from the site's form, saved as a lead and
 * announced in Slack.
 *
 * Nothing is ever sent to the address a visitor types. A form that emails its
 * sender is a form anyone can use to make this domain mail a stranger, and an
 * auto-reply to inbound mail once looped into 195 enquiries in the product
 * (docs/Operations_Findings.md there). A person answers each lead.
 *
 * Spam is turned away three cheap ways, no third-party captcha: a field real
 * people never see (`website`), a minimum time between the form rendering and
 * being sent, and a per-address limit held in memory. One container serves the
 * site, so memory is the whole limit; a restart resets it, which is fine.
 */
export const dynamic = 'force-dynamic'

const COUNTRIES = ['Kuwait', 'UAE', 'Saudi Arabia', 'Bahrain', 'Oman', 'Qatar', 'Other']
const VOLUMES = ['Under 50', '50-200', '200-1,000', 'Over 1,000']
/** Faster than this from page load to send, and it was not typed by a person. */
const MIN_FILL_MS = 3000
const LIMIT = 5
const WINDOW_MS = 60 * 60 * 1000
const recent = new Map<string, number[]>()

const text = (value: unknown, max: number) =>
  typeof value === 'string' ? value.trim().slice(0, max) : ''

function limited(ip: string) {
  const now = Date.now()
  const hits = (recent.get(ip) ?? []).filter((at) => now - at < WINDOW_MS)
  hits.push(now)
  recent.set(ip, hits)
  return hits.length > LIMIT
}

export async function POST(request: Request) {
  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'invalid' }, { status: 400 })
  }

  // A bot that filled the hidden field, or answered faster than anyone can
  // type, gets the same "thanks" as a person: telling it why only teaches it.
  const startedAt = Number(body.startedAt)
  if (text(body.website, 200) || !startedAt || Date.now() - startedAt < MIN_FILL_MS)
    return Response.json({ ok: true })

  const ip =
    request.headers.get('cf-connecting-ip') ??
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    'unknown'
  if (limited(ip)) return Response.json({ error: 'too many' }, { status: 429 })

  const lead = {
    name: text(body.name, 120),
    company: text(body.company, 160),
    email: text(body.email, 200),
    phone: text(body.phone, 40),
    country: COUNTRIES.includes(String(body.country))
      ? (String(body.country) as NonNullable<Lead['country']>)
      : undefined,
    volume: VOLUMES.includes(String(body.volume))
      ? (String(body.volume) as NonNullable<Lead['volume']>)
      : undefined,
    message: text(body.message, 2000),
    lang: body.lang === 'ar' ? 'ar' : 'en',
    page: text(body.page, 300),
    status: 'new' as const,
  }
  if (!lead.name || !lead.company || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(lead.email))
    return Response.json({ error: 'missing' }, { status: 400 })

  const payload = await getPayload({ config })
  const saved = await payload.create({ collection: 'leads', data: lead, overrideAccess: true })

  const admin = `${process.env.SITE_URL ?? 'https://cargosharks.com'}/admin/collections/leads/${saved.id}`
  void slack(
    [
      `:incoming_envelope: *New pilot request* from *${lead.company}*`,
      `${lead.name} · ${lead.email}${lead.phone ? ` · ${lead.phone}` : ''}`,
      [
        lead.country,
        lead.volume && `${lead.volume} shipments a month`,
        lead.lang === 'ar' ? 'Arabic' : '',
      ]
        .filter(Boolean)
        .join(' · '),
      lead.message ? `> ${lead.message.replace(/\n/g, '\n> ')}` : '',
      `<${admin}|Open in admin>`,
    ]
      .filter(Boolean)
      .join('\n'),
    process.env.SLACK_LEADS_CHANNEL,
  )
  return Response.json({ ok: true })
}
