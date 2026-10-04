/**
 * The lockup — mark plus wordmark.
 *
 * The mark's geometry comes from `@qabandi/brand` as an SVG string so that the
 * same drawing serves the screen and the Chromium-rendered PDF letterhead. The
 * wordmark is HTML rather than SVG text, because it has to switch to Arabic,
 * wrap on a phone and inherit the page's font loading — none of which SVG text
 * does well.
 */

import type { Brand } from '@qabandi/brand'
import { markSvg } from '@qabandi/brand'

export interface LogoProps {
  readonly brand: Brand
  readonly locale: 'en' | 'ar'
  /** `chrome` for the navy sidebar, `ink` for a light surface. */
  readonly tone?: 'chrome' | 'ink' | 'inverse'
  readonly size?: 'sm' | 'md' | 'lg'
  /** Hides the wordmark, for a collapsed sidebar or a favicon-sized slot. */
  readonly markOnly?: boolean
  readonly showTagline?: boolean
  readonly className?: string
}

const MARK_PX = { sm: 28, md: 36, lg: 48 } as const
const NAME_CLASS = {
  sm: 'text-body leading-tight',
  md: 'text-heading leading-tight',
  lg: 'text-display leading-tight',
} as const

export function Logo({
  brand,
  locale,
  tone = 'ink',
  size = 'md',
  markOnly = false,
  showTagline = true,
  className,
}: LogoProps) {
  const name = locale === 'ar' ? brand.identity.nameAr : brand.identity.nameEn
  const tagline = locale === 'ar' ? brand.identity.taglineAr : brand.identity.taglineEn

  const nameTone =
    tone === 'chrome' ? 'text-chrome-ink' : tone === 'inverse' ? 'text-on-brand' : 'text-ink'
  const taglineTone =
    tone === 'chrome'
      ? 'text-chrome-ink-muted'
      : tone === 'inverse'
        ? 'text-on-brand/70'
        : 'text-ink-subtle'

  return (
    <span className={['flex max-w-full items-center gap-2.5', className].filter(Boolean).join(' ')}>
      <span
        className="shrink-0"
        // eslint-disable-next-line react/no-danger -- generated from typed brand tokens
        // Not request input, and not quite a constant either — worth saying
        // which, because the eslint note above says "typed brand tokens" and
        // that is only true of the generated monogram.
        //
        // `markSvg` builds the mark from brand tokens and escapes the two
        // strings it interpolates (`title`, `className`). The exception is
        // `BRAND_LOGO_SVG`: an operator may supply artwork as inline SVG, and
        // that path inserts the file verbatim, because sanitising artwork into
        // safety generally means rendering it wrong.
        //
        // That is deployment configuration rather than anything a visitor can
        // reach, and whoever sets environment variables on this server can
        // already run code on it, so the rule's threat model does not apply as
        // written. The residual risk is real but different: if artwork ever
        // arrives from a *customer* rather than from the operator — which the
        // whitelabel story invites — it is markup from outside the trust
        // boundary reaching every page, and it must be sanitised before it is
        // stored, not here.
        dangerouslySetInnerHTML={{
          // nosemgrep: typescript.react.security.audit.react-dangerouslysetinnerhtml.react-dangerouslysetinnerhtml
          __html: markSvg(brand, {
            size: MARK_PX[size],
            title: markOnly ? name : undefined,
            idPrefix: `qb-${size}`,
          }),
        }}
      />
      {markOnly ? null : (
        <span className="flex min-w-0 flex-col">
          <span
            /*
             * Wraps rather than truncates. A clipped company name is the one
             * failure mode this component must not have: "Al-Qabandi & Partn…"
             * in the sidebar of their own product would be noticed in the
             * first thirty seconds of the demo. `break-words` for a name that
             * is one long word: wrapping needs a space to wrap at, and at the
             * brand preview's display size such a name ran out of its card
             * on a phone.
             */
            className={`font-display font-semibold text-balance break-words ${NAME_CLASS[size]} ${nameTone}`}
            style={{
              letterSpacing: 'var(--qb-wordmark-tracking)',
              fontWeight: 'var(--qb-wordmark-weight)' as unknown as number,
            }}
          >
            {name}
          </span>
          {showTagline ? (
            <span className={`truncate text-micro font-medium ${taglineTone}`}>{tagline}</span>
          ) : null}
        </span>
      )}
    </span>
  )
}
