'use client'

import { type ReactNode, useEffect, useState } from 'react'
import { CONTACT_DOMAIN, type Mailbox } from '@/content/copy'

/**
 * Email addresses, kept out of the markup.
 *
 * A complete address in the HTML is two problems. Harvesters read it, and
 * Cloudflare's Email Obfuscation (left on for anything that slips past this)
 * rewrites every one it finds into a `/cdn-cgi/l/email-protection` link plus a
 * script of its own. That script contradicted the privacy policy's "scripts
 * under /_next/static/ only", and Google crawled the rewritten link as a 404.
 *
 * So the static page carries the mailbox and the domain as separate text with
 * the "@" drawn by CSS: it reads correctly with JavaScript off, but no "x@y.z"
 * exists in the HTML or the React payload for a regex to find. Once hydrated,
 * the address is assembled for real, so it copies with its "@" and the link
 * gets its `mailto:`. A link has no `href` until then, a fraction of a second
 * on a static page.
 *
 * Every address on the site goes through here; `test/email.test.ts` fails on a
 * literal one anywhere else.
 */

function useAssembled() {
  const [assembled, setAssembled] = useState(false)
  useEffect(() => setAssembled(true), [])
  return assembled
}

export function EmailAddress({ box = 'hello' }: { box?: Mailbox }) {
  const assembled = useAssembled()
  // An address is a left-to-right run, even inside an Arabic sentence.
  return (
    <span dir="ltr">
      {assembled ? (
        `${box}@${CONTACT_DOMAIN}`
      ) : (
        <>
          {box}
          <span className="after:content-['@']" />
          {CONTACT_DOMAIN}
        </>
      )}
    </span>
  )
}

export function EmailLink({
  box = 'hello',
  subject,
  className,
  children,
}: {
  box?: Mailbox
  subject?: string
  className?: string
  /** The link text. Defaults to the address itself. */
  children?: ReactNode
}) {
  const assembled = useAssembled()
  const query = subject ? `?subject=${encodeURIComponent(subject)}` : ''
  return (
    <a
      href={assembled ? `mailto:${box}@${CONTACT_DOMAIN}${query}` : undefined}
      className={className}
    >
      {children ?? <EmailAddress box={box} />}
    </a>
  )
}
