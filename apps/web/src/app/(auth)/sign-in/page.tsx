/**
 * Sign-in — `FR-ID-05…07`.
 *
 * Credentials and TOTP. There is no sign-up link and no magic link, because
 * the product is invitation-only (`FR-ID-07`) and both are the entry point the
 * 2026 pre-account-hijacking advisory needs (§8).
 *
 * Mandatory 2FA for Administrator and Finance is checked at *session
 * establishment*, not only at enrolment — a session predating the policy must
 * not survive it.
 *
 * The layout is a split panel, and the left half is not decoration. This is
 * the only screen an operator sees before they have any context, and it is the
 * one place the product can say whose system this is: the mark, the year the
 * business was founded, and the two branches it runs. A centred card on an
 * empty page says nothing, and on a whitelabel product that blankness is
 * exactly the wrong first impression — it is the operator's system, and it
 * should look like it from the first screen.
 *
 * On a phone the left half is dropped rather than stacked. Nobody signing in
 * on a handset needs the provenance; they need the form above the fold.
 *
 * The customer link at the bottom is deliberate: most people who land here by
 * accident want to track a shipment, and sending them to a login they do not
 * have is how a tracking page goes unused.
 */

import Link from 'next/link'
import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getLocale, getTranslations } from 'next-intl/server'
import { getSession, homeFor } from '@/lib/session'
import { getBrand } from '@/lib/brand'
import { DEFAULT_LOCALE, isLocale } from '@/i18n/request'
import { Icon, type IconName } from '@/ui/icon'
import { Logo } from '@/ui/logo'
import { SignInForm } from '@/features/auth/ui/sign-in-form'
import { DemoPanel, type DemoPanelPersona } from '@/features/auth/ui/demo-panel'
import { useDemoLogin } from '@/lib/pilot/source'
import { DEMO_PERSONAS, demoPassword } from '@/lib/pilot/demo'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('signIn')
  return { title: t('title') }
}

/** What the operator gets, in three lines. Claims the product can back. */
const ASSURANCES: readonly { icon: IconName; key: 'live' | 'scoped' | 'bilingual' }[] = [
  { icon: 'live', key: 'live' },
  { icon: 'hold', key: 'scoped' },
  { icon: 'globe', key: 'bilingual' },
]

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ reset?: string }>
}) {
  /*
    Somebody already signed in has no business on this form.

    Left reachable, it is a small trap rather than a cosmetic flaw: the page
    offers a fresh sign-in, so an operator who lands here from a stale tab or a
    bookmark authenticates a second time and replaces their own session. They
    are sent to whichever shell their actor type belongs to instead.
  */
  const existing = await getSession()
  if (existing) redirect(homeFor(existing))

  const { reset } = await searchParams
  const t = await getTranslations('signIn')
  const brand = getBrand()
  const resolved = await getLocale()
  const locale = isLocale(resolved) ? resolved : DEFAULT_LOCALE
  const established = brand.identity.established

  /*
    The demo credentials, on the public demo deployment only.

    The three role names are looked up as literal keys rather than built from
    `persona.key`, because `scripts/check-messages.mjs` can only verify a key
    it can read — an interpolated one is reported as unverifiable, which is the
    same thing as unchecked. The icons sit here for the same reason the labels
    do: `lib/pilot/demo.ts` is the data, and neither the message catalogue nor
    the icon set belongs in it.
  */
  const demo = useDemoLogin()
  const demoRoles = demo
    ? {
        operations: { role: t('demo.personas.operations'), icon: 'dashboard' as IconName },
        customer: { role: t('demo.personas.customer'), icon: 'customers' as IconName },
        agent: { role: t('demo.personas.agent'), icon: 'partners' as IconName },
      }
    : null

  const demoPersonas: DemoPanelPersona[] = demoRoles
    ? DEMO_PERSONAS.map((persona) => ({
        email: persona.email,
        name: locale === 'ar' ? persona.nameAr : persona.nameEn,
        org: locale === 'ar' ? persona.orgAr : persona.orgEn,
        role: demoRoles[persona.key].role,
        icon: demoRoles[persona.key].icon,
      }))
    : []

  /*
    On the public demo the operations view is the one a prospect wants first,
    so its credentials seed the form's fields — one click to sign in. A persona
    tile above overwrites them; a real deployment passes nothing, and the
    fields open empty.
  */
  const operations = DEMO_PERSONAS.find((persona) => persona.key === 'operations')
  const demoDefaults =
    demo && operations ? { email: operations.email, password: demoPassword() } : undefined

  return (
    /* Full viewport: there is no header above this any more to subtract. */
    <div className="grid min-h-dvh lg:grid-cols-[1.05fr_1fr]">
      {/* ---- the operator's half -------------------------------------- */}
      <aside className="relative hidden overflow-hidden border-e border-line bg-canvas lg:flex lg:flex-col lg:justify-between lg:p-12">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              'radial-gradient(38rem 24rem at 15% 8%, color-mix(in oklab, var(--qb-brand) 12%, transparent), transparent 70%),' +
              'radial-gradient(32rem 22rem at 90% 96%, color-mix(in oklab, var(--qb-accent) 12%, transparent), transparent 68%)',
          }}
        />

        {/*
          The mark, oversized and cropped by the panel's edge.

          At 22rem it stops being a logo and becomes the surface's texture,
          which is the only way a single-colour mark carries a whole panel. Low
          opacity so the type in front of it stays the thing being read.
        */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -bottom-24 -end-16 text-brand opacity-[0.06]"
        >
          <Logo
            brand={brand}
            locale={locale}
            size="lg"
            markOnly
            className="scale-[9] origin-bottom-right"
          />
        </div>

        <div className="relative">
          <Logo brand={brand} locale={locale} size="md" />
        </div>

        <div className="relative max-w-md">
          <h2 className="font-display text-[1.75rem] leading-tight font-semibold tracking-tight text-balance text-ink">
            {t('panelTitle')}
          </h2>
          <p className="mt-3 text-[0.9375rem] leading-relaxed text-ink-muted">{t('panelBody')}</p>

          <ul className="mt-8 flex flex-col gap-3.5">
            {ASSURANCES.map((item) => (
              <li key={item.key} className="flex items-start gap-3">
                <span className="mt-px flex size-7 shrink-0 items-center justify-center rounded-full bg-brand-soft text-brand-soft-ink">
                  <Icon name={item.icon} size={15} />
                </span>
                <span className="text-[0.875rem] leading-snug text-ink-muted">
                  {t(`assurances.${item.key}`)}
                </span>
              </li>
            ))}
          </ul>
        </div>

        <p className="relative text-[0.75rem] text-ink-subtle">
          {locale === 'ar' ? brand.identity.legalNameAr : brand.identity.legalNameEn}
          {established ? <span className="numeric"> · {established}</span> : null}
        </p>
      </aside>

      {/* ---- the form --------------------------------------------------- */}
      <main className="flex items-center justify-center px-4 py-12 sm:px-8">
        <div className="w-full max-w-sm">
          {/* The mark returns on a phone, where the left panel is gone. */}
          <Logo brand={brand} locale={locale} size="md" markOnly className="mb-5 lg:hidden" />

          <h1 className="font-display text-2xl font-semibold tracking-tight text-ink">
            {t('title')}
          </h1>
          <p className="mt-1.5 text-[0.9375rem] text-ink-muted">{t('subtitle')}</p>

          {reset ? (
            <p
              role="status"
              className="mt-5 rounded-sm bg-positive-soft px-3 py-2.5 text-[0.8125rem] leading-snug font-medium text-positive ring-1 ring-positive/25 ring-inset"
            >
              {t('resetDone')}
            </p>
          ) : null}

          {demo ? (
            <DemoPanel
              personas={demoPersonas}
              password={demoPassword()}
              labels={{
                title: t('demo.title'),
                password: t('demo.password'),
              }}
            />
          ) : null}

          <div className="mt-7">
            <SignInForm
              labels={{
                email: t('email'),
                password: t('password'),
                submit: t('submit'),
                submitting: t('submitting'),
              }}
              defaults={demoDefaults}
            />
          </div>

          {/*
            Under the form rather than beside the password label.

            Beside the field it competes with the label for the same glance and
            gets clicked by people who have not yet tried their password. Below
            the submit button it is where somebody looks *after* failing, which
            is when they want it.
          */}
          <p className="mt-3 text-end">
            <Link
              href="/forgot-password"
              className="text-[0.8125rem] font-medium text-accent hover:underline"
            >
              {t('forgotPassword')}
            </Link>
          </p>

          <p className="mt-4 flex items-start gap-2 rounded-sm bg-surface-sunken px-3 py-2.5 text-[0.75rem] leading-snug text-ink-muted">
            <Icon name="hold" size={14} className="mt-px shrink-0 text-ink-subtle" />
            {t('twoFactor')}
          </p>

          <p className="mt-3 text-[0.75rem] text-ink-subtle">{t('invitationOnly')}</p>

          <div className="mt-8 border-t border-line pt-6">
            <p className="text-[0.8125rem] text-ink-muted">{t('customerPrompt')}</p>
            <Link
              href="/track"
              className="mt-1.5 inline-flex items-center gap-1.5 text-[0.875rem] font-medium text-accent hover:underline"
            >
              <Icon name="tracking" size={15} />
              {t('customerLink')}
            </Link>
          </div>
        </div>
      </main>
    </div>
  )
}
