import config from '@payload-config'
import { getPayload } from 'payload'

/**
 * `POST /cron/leads/`: delete test leads, and nothing else.
 *
 * Checking the form end to end leaves rows behind, and the cron secret is not
 * an admin login. So this deletes only leads whose email is on a domain
 * reserved for testing (RFC 2606: example.com, .org, .net, and the .test
 * top-level domain), which no real enquiry can use. Any other lead is
 * removed from the admin, by a person.
 */
export const dynamic = 'force-dynamic'

const TEST_EMAIL = /@(?:[^@\s]+\.)?(?:example\.(?:com|org|net)|[^@\s]+\.test)$/i

export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`)
    return Response.json({ error: 'unauthorised' }, { status: 401 })

  const payload = await getPayload({ config })
  const { docs } = await payload.find({
    collection: 'leads',
    limit: 1000,
    depth: 0,
    overrideAccess: true,
  })
  const tests = docs.filter((lead) => TEST_EMAIL.test(lead.email))
  for (const lead of tests)
    await payload.delete({ collection: 'leads', id: lead.id, overrideAccess: true })
  return Response.json({
    deleted: tests.map((lead) => ({ id: lead.id, company: lead.company, email: lead.email })),
    kept: docs.length - tests.length,
  })
}
