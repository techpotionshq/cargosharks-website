import config from '@payload-config'
import { getPayload } from 'payload'
import { checkEmail } from '@/cms/email-check'
import { slack } from '@/cms/notify'
import { enquiry } from '@/content/copy'
import type { Lead } from '@/payload-types'

/**
 * `POST /contact/`: a demo request from the site's form, saved as a lead and
 * announced in Slack.
 *
 * The qualifying answers (branches, users, modes, current system, e-invoicing,
 * timeline) are accepted only as one of the values the form offers, and are
 * written at the top of the lead's `message` and into the Slack post rather
 * than into columns of their own. That keeps the form's questions changeable
 * without a migration while they are still settling; once they have, they can
 * become select fields on `Leads` like `country` and `volume`.
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
/** Each optional answer, by field name, with the English label Slack prints. */
const ANSWERS = {
  branches: { label: 'Branches', values: enquiry.branchCounts },
  users: { label: 'Users', values: enquiry.userCounts },
  system: { label: 'Uses today', values: enquiry.systems },
  einvoicing: { label: 'E-invoicing', values: enquiry.einvoicingNeeds },
  timeline: { label: 'Go live', values: enquiry.timelines },
} as const
const MODES = enquiry.modeOptions.map((mode) => mode.value as string)
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
  // Measured by the browser on its own clock (see LeadForm), so a device whose
  // clock is wrong is not mistaken for a bot.
  const elapsed = Number(body.elapsedMs)
  if (text(body.website, 200) || !Number.isFinite(elapsed) || elapsed < MIN_FILL_MS)
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
    message: '',
    lang: body.lang === 'ar' ? 'ar' : 'en',
    page: text(body.page, 300),
    status: 'new' as const,
  }
  // Anything not offered by the form is dropped, not stored: these lines are
  // read by a person deciding how to answer, and free text belongs in `message`.
  const answers = Object.entries(ANSWERS).flatMap(([field, { label, values }]) => {
    const value = String(body[field] ?? '')
    return values.some((option) => option.value === value) ? [`${label}: ${value}`] : []
  })
  const modes = (Array.isArray(body.modes) ? body.modes : [])
    .map(String)
    .filter((m) => MODES.includes(m))
  if (modes.length) answers.push(`Moves: ${modes.join(', ')}`)
  const note = text(body.message, 2000)
  lead.message = [answers.join('\n'), note].filter(Boolean).join('\n\n')

  if (!lead.name || !lead.company || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(lead.email))
    return Response.json({ error: 'missing' }, { status: 400 })

  // Link-stuffed messages are what form spam looks like; a forwarder asking
  // about a demo does not paste three URLs. Same silent "thanks" as a bot.
  if ((note.match(/https?:\/\/|www\./gi) ?? []).length >= 2) return Response.json({ ok: true })

  // A throwaway inbox or a domain that cannot receive mail is refused out loud:
  // the second is usually a typo the visitor can fix (src/cms/email-check.ts).
  const verdict = await checkEmail(lead.email)
  if (!verdict.ok) return Response.json({ error: 'email' }, { status: 400 })

  const payload = await getPayload({ config })
  const saved = await payload.create({ collection: 'leads', data: lead, overrideAccess: true })

  const admin = `${process.env.SITE_URL ?? 'https://cargosharks.com'}/admin/collections/leads/${saved.id}`
  void slack(
    [
      `:incoming_envelope: *New demo request* from *${lead.company}*`,
      `${lead.name} · ${lead.email}${verdict.personal ? ' _(personal email)_' : ''}${lead.phone ? ` · ${lead.phone}` : ''}`,
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
