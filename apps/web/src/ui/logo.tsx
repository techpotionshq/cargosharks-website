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
  sm: 'text-[0.875rem] leading-tight',
  md: 'text-[1.0625rem] leading-tight',
  lg: 'text-2xl leading-tight',
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
    <span className={['flex items-center gap-2.5', className].filter(Boolean).join(' ')}>
      <span
        className="shrink-0"
        // eslint-disable-next-line react/no-danger -- generated from typed brand tokens
        dangerouslySetInnerHTML={{
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
             * first thirty seconds of the demo.
             */
            className={`font-display font-semibold text-balance ${NAME_CLASS[size]} ${nameTone}`}
            style={{
              letterSpacing: 'var(--qb-wordmark-tracking)',
              fontWeight: 'var(--qb-wordmark-weight)' as unknown as number,
            }}
          >
            {name}
          </span>
          {showTagline ? (
            <span className={`truncate text-[0.6875rem] font-medium ${taglineTone}`}>
              {tagline}
            </span>
          ) : null}
        </span>
      )}
    </span>
  )
}
