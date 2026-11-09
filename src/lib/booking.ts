import { CALL_URL } from '@/content/copy'

/**
 * The intro-call booking link, with the name and email just typed into the
 * quote form already filled in on Cal.com's page.
 *
 * Name and email only. The rest of the form's answers already reach the team
 * through the lead and its Slack post; carrying them onto the booking would
 * need the event's "Additional notes" field switched on in Cal.com, for no
 * information the team does not already have.
 *
 * The link is built only after the visitor has sent the form and only opened
 * by their own click, so nothing reaches Cal.com until they choose to book.
 * Blank values are left out rather than sent empty.
 */
export function callUrl(person: { name?: string | null; email?: string | null }): string {
  const url = new URL(CALL_URL)
  const name = person.name?.trim()
  const email = person.email?.trim()
  if (name) url.searchParams.set('name', name)
  if (email) url.searchParams.set('email', email)
  return url.toString()
}
