/**
 * Where an alert opens — the one place both the inbox and the action agree on.
 *
 * Built from the outbox row's job or enquiry: a job file or an enquiry, and
 * nothing else.
 */
export function target(jobId: string | null, enquiryId: string | null): string | null {
  if (jobId) return `/jobs/${jobId}`
  if (enquiryId) return `/enquiries/${enquiryId}`
  return null
}

/**
 * Is `href` a path `target` could have built — A13.
 *
 * `openNotification` redirects to the `href` the bell's form posts, and a form
 * field is whatever the poster says it is: `https://evil.example` or
 * `//evil.example` made the product's own sign-in-protected domain a
 * redirector to anywhere, the shape every phishing link wants. Only the two
 * shapes above pass, with an id made of the characters ids are made of.
 */
export function isTarget(href: string): boolean {
  return /^\/(jobs|enquiries)\/[A-Za-z0-9-]{1,64}$/.test(href)
}
