/**
 * The internal application — one of four audiences served as route groups (§3).
 *
 * The guard here is a convenience, not the boundary. A customer contact who
 * reached an ops route would see nothing anyway: every query runs under their
 * principal, and the `internal` arm of each RLS policy would not apply to
 * them. This redirect exists so they get a sensible page rather than an empty
 * one.
 *
 * The chrome is cut from the brand's *secondary* — navy, not the corporate red
 * — and that is a deliberate whitelabel decision (see `brands/qabandi.ts`).
 * The operator's colour frames the product, the product's surfaces stay
 * neutral, and red is spent only where it means something.
 */

import Link from 'next/link'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { getLocale, getTranslations } from 'next-intl/server'
import { getSession } from '@/lib/session'
import { needsTwoFactorEnrolment } from '@/features/auth/enrolment'
import { getBrand } from '@/lib/brand'
import { DEFAULT_LOCALE, isLocale } from '@/i18n/request'
import { THEME_COOKIE, isThemeChoice } from '@/lib/theme'
import { usePilotFixtures } from '@/lib/pilot/source'
import { can, canOpenSettings } from '@/lib/permissions'
import { getNavCounts } from '@/features/dashboard/nav-counts'
import { SupportAccessBanner } from '@/features/support/ui/banner'
import { AssistantDock } from '@/features/assistant/ui/assistant-dock'
import { AssistantLauncher } from '@/features/assistant/ui/assistant-launcher'
import { assistantLabels } from '@/features/assistant/labels'
import { assistantConfigured } from '@/features/assistant/queries'
import { signOut } from '@/features/auth/actions'
import { Logo } from '@/ui/logo'
import { Icon } from '@/ui/icon'
import { MobileMenu, MobileNav, SidebarNav, type NavSection } from '@/ui/nav'
import { LanguageSwitch, ThemeSwitch, TimeZoneSwitch } from '@/ui/preferences'
import { FOCUS_RING } from '@/ui/control'
import { Toaster } from '@/ui/toast'
import { getInbox } from '@/features/notifications/queries'
import { NotificationBell } from '@/features/notifications/ui/notification-bell'

export default async function OpsLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession()
  if (!session) redirect('/sign-in')
  if (session.actor.type === 'customer_contact') redirect('/portal')
  if (session.actor.type === 'agent_contact') redirect('/agent')

  /*
    The second factor, enforced — FR-ID-06.

    Before the navigation is built and before any query runs, because an
    administrator who has not enrolled must not reach a screen at all. Until
    now this was a label: `requiresTwoFactor` was computed on every request,
    drawn as an icon on the users screen, and read by nothing that could stop
    anybody.

    The predicate is shared with `(settings)` and with the enrolment page
    itself (`features/auth/enrolment.ts`), so the guard and the screen it
    guards cannot drift apart.
  */
  if (await needsTwoFactorEnrolment(session)) redirect('/two-factor/enrol')

  const t = await getTranslations('nav')
  const ta = await getTranslations('assistant')
  const aiConfigured = await assistantConfigured()
  const tc = await getTranslations('common')
  const tApp = await getTranslations('app')
  const brand = getBrand()
  const resolved = await getLocale()
  const locale = isLocale(resolved) ? resolved : DEFAULT_LOCALE
  const themeCookie = (await cookies()).get(THEME_COOKIE)?.value
  const theme = isThemeChoice(themeCookie) ? themeCookie : 'system'

  // The two counts worth interrupting someone for. Everything else is a page
  // you go to; these are things that are wrong right now.
  const counts = await getNavCounts(session.actor)

  // This operator's own alerts, for the bell in the header below.
  const inbox = await getInbox(session.actor, locale)

  /**
   * The navigation, grouped the way the business is: what you sell, what you
   * move, who you move it with, and what you bill.
   *
   * Four groups, and every one of them is a shipment in some stage of its life.
   * Administration used to be a fifth — users, branches, the audit log and the
   * brand console sitting under Payments — and it made the sidebar a list of
   * everything rather than a list of the work. It now lives behind one door at
   * the foot of this nav (`app/(settings)`), which is also what let those
   * screens get the permission gates they were missing: three of the five were
   * offered to every signed-in account, including `read_only`.
   */
  const allSections: NavSection[] = [
    {
      label: t('sections.commercial'),
      items: [
        { href: '/dashboard', label: t('dashboard'), icon: 'dashboard' },
        {
          href: '/enquiries',
          label: t('enquiries'),
          icon: 'enquiries',
          badge: counts.openEnquiries,
        },
        { href: '/quotes', label: t('quotes'), icon: 'quotes' },
        { href: '/customers', label: t('customers'), icon: 'customers' },
        { href: '/rates', label: t('rates'), icon: 'rates' },
      ],
    },
    {
      label: t('sections.operations'),
      items: [
        { href: '/jobs', label: t('jobs'), icon: 'jobs' },
        {
          href: '/exceptions',
          label: t('exceptions'),
          icon: 'alert',
          badge: counts.openExceptions,
        },
        { href: '/consolidations', label: t('consolidations'), icon: 'ship' },
        { href: '/customs', label: t('customs'), icon: 'customs' },
        { href: '/documents', label: t('documents'), icon: 'document' },
        /*
          In the nav as well as in the dock, because they are different jobs.

          The dock is for a question asked mid-task and is deliberately
          transient. This is where somebody goes to read back a thread from
          Tuesday, or to work through a morning one exception at a time — and a
          surface reachable only by a floating button is one that half the
          staff never discover.
        */
        /*
          Offered only where it can answer.

          The nav is a list of things this deployment does, and an entry that
          leads to "no key is set" belongs on the settings screen rather than
          beside Documents. An administrator who has just added the key sees it
          on their next navigation.
        */
        ...(aiConfigured
          ? [{ href: '/assistant', label: t('assistant'), icon: 'assistant' as const }]
          : []),
      ],
    },
    {
      label: t('sections.network'),
      items: [
        { href: '/partners', label: t('partners'), icon: 'partners' },
        { href: '/locations', label: t('locations'), icon: 'locations' },
        /*
          Reference data sits in operations, not in settings.

          Ports, charge types, commodities and exception codes are the tables
          the rating and booking engines read, and an empty one fails silently
          three screens away as "no rate found". An operations manager holds
          `admin.reference.write` precisely so a shipment routed through a
          depot nobody has recorded does not wait for an administrator.
        */
        { href: '/reference', label: t('reference'), icon: 'reference' },
        /*
          Bulk import sits with the network because that is what it fills.

          It is the first screen a new deployment needs and close to the last
          one it uses — a client arrives with thirty years of customers, agents
          and ports in spreadsheets, and every register in this section stays
          empty until those files are in (FR-MD-11, FR-RT-09).
        */
        { href: '/imports', label: t('imports'), icon: 'download' },
      ],
    },
    {
      label: t('sections.finance'),
      items: [
        /*
          Each ledger behind its own read key, as the pages are (QA P2-11).
          The links were drawn for everybody and the pages let everybody in.
        */
        ...(can(session, 'receivable.read')
          ? [
              { href: '/finance', label: t('finance'), icon: 'finance' as const },
              { href: '/invoices', label: t('invoices'), icon: 'invoices' as const },
              { href: '/payments', label: t('payments'), icon: 'payments' as const },
            ]
          : []),
        /*
          Payables sits under Payments rather than beside Invoices, and the
          order is what the finance day actually looks like: money in, money
          out, and then the agents where both directions meet.
        */
        ...(can(session, 'payable.read')
          ? [
              {
                href: '/payables',
                label: t('payables'),
                icon: 'payments' as const,
                badge: counts.payablesToReview,
              },
              { href: '/settlements', label: t('settlements'), icon: 'finance' as const },
            ]
          : []),
        /*
          Last in the finance section, and gated.

          It is the only screen here that shows the whole book at once rather
          than one document, so it sits behind `report.read` — which finance
          and management hold and a coordinator does not. The page asserts the
          same permission; this only stops it appearing in a menu that would
          then refuse it.
        */
        ...(can(session, 'report.read')
          ? [{ href: '/reports', label: t('reports'), icon: 'chart' as const }]
          : []),
      ],
    },
  ]
  // A section whose every entry is gated away (a customs broker's Finance)
  // would draw its heading over nothing.
  const sections = allSections.filter((section) => section.items.length > 0)

  const displayName =
    locale === 'ar' && session.principal.nameAr
      ? session.principal.nameAr
      : session.principal.nameEn

  const initials = session.principal.nameEn
    .split(' ')
    .map((part) => part[0])
    .slice(0, 2)
    .join('')

  const roleKey = [...session.branchRoles.values()][0] ?? 'read_only'
  const branchCodes = session.branchRoles.size

  return (
    <div className="flex min-h-dvh bg-canvas">
      {/*
        Two elements rather than one: the outer column carries the chrome
        colour for the *whole* page height, and the inner nav sticks to the
        viewport. A single sticky element would leave the chrome ending
        mid-scroll on a long board, with the canvas showing beneath it.

        `border-e` is logical: the sidebar sits at the inline start, which is
        the right-hand side in Arabic, with no conditional.
      */}
      <div className="hidden w-62 shrink-0 border-e border-chrome-line bg-chrome md:block">
        <nav className="sticky top-0 flex h-dvh flex-col">
          {/*
            Exactly the topbar's height, and centred rather than padded.

            The hairline under this block and the one under the topbar are read
            as a single rule across the top of the application, so a four-pixel
            disagreement is visible as a broken line at the sidebar seam — which
            is what `py-3.5` produced, because the lockup is a two-line column
            and taller than the padding was calculated against. `h-14` with
            flex centring states the height the seam actually depends on, and
            stays true if the logo or its tagline ever changes size.
          */}
          <div className="flex h-14 items-center border-b border-chrome-line px-4">
            <Link href="/dashboard" className="block min-w-0 rounded-sm outline-offset-4">
              <Logo brand={brand} locale={locale} tone="chrome" size="sm" />
            </Link>
          </div>

          <SidebarNav sections={sections} moreBelowLabel={t('moreBelow')} />

          {/*
            The two ways out of the working set: what the customer sees, and
            the settings behind the operator.

            Both are deliberately below the navigation and outside its groups.
            Neither is a place you go to move a shipment, and putting them in
            the list would mean scanning past them every time you reach for
            Invoices.
          */}
          <div className="flex flex-col gap-0.5 border-t border-chrome-line px-3 py-2">
            <Link
              href="/track"
              className="flex items-center gap-2.5 rounded-sm px-3 py-2 text-body-sm font-medium text-chrome-ink-muted transition-colors hover:bg-surface-sunken hover:text-chrome-ink"
            >
              <Icon name="tracking" size={16} className="text-ink-subtle" />
              {t('tracking')}
              <Icon name="external" size={13} className="ms-auto opacity-50" />
            </Link>

            {/*
              Rendered on the same condition the settings layout admits on, so
              the link never leads to a redirect. An account with no
              administration key simply does not see a door.
            */}
            {canOpenSettings(session) ? (
              <Link
                href="/settings"
                className="flex items-center gap-2.5 rounded-sm px-3 py-2 text-body-sm font-medium text-chrome-ink-muted transition-colors hover:bg-surface-sunken hover:text-chrome-ink"
              >
                <Icon name="settings" size={16} className="text-ink-subtle" />
                {t('settings')}
                <Icon name="chevron-end" size={13} className="ms-auto opacity-50" />
              </Link>
            ) : null}
          </div>

          {/* Who you are signed in as, and the way out. */}
          <div className="border-t border-chrome-line p-3">
            <div className="flex items-center gap-2.5 rounded-sm bg-surface-sunken/70 p-2">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-brand text-caption font-semibold text-on-brand">
                {initials}
              </span>
              <span className="flex min-w-0 flex-col leading-tight">
                <span className="truncate text-body-sm leading-tight font-medium text-chrome-ink">
                  {displayName}
                </span>
                <span className="truncate text-micro leading-tight text-chrome-ink-muted">
                  {t(`roles.${roleKey}`)} · {tc('branchCount', { count: branchCodes })}
                </span>
              </span>
              <form action={signOut} className="ms-auto">
                <button
                  type="submit"
                  title={t('signOut')}
                  aria-label={t('signOut')}
                  className="flex size-9 items-center justify-center rounded-sm text-chrome-ink-muted transition-colors hover:bg-surface hover:text-critical"
                >
                  <Icon name="sign-out" size={15} />
                </button>
              </form>
            </div>
          </div>
        </nav>
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-line bg-surface/85 px-4 backdrop-blur-md md:px-6">
          {/* On a phone the sidebar collapses to the mark alone. */}
          {/*
            Named, because the mark alone is an image and the link had no text
            a screen reader could announce — it was read as "link", twice per
            screen. 40px square so it is a target and not a smudge.
          */}
          <Link
            href="/dashboard"
            aria-label={locale === 'ar' ? brand.identity.nameAr : brand.identity.nameEn}
            className="-ms-2 flex size-10 items-center justify-center rounded-sm md:hidden"
          >
            <Logo brand={brand} locale={locale} size="sm" markOnly />
          </Link>

          {/*
            Points at `/search`, not at the board.

            The placeholder promises references, containers and customers; the
            operations board reads neither `q` nor any of those, so submitting
            this used to land on an unfiltered list of live shipments — which
            looks like an answer and is not one.
          */}
          <form action="/search" className="relative hidden max-w-sm flex-1 sm:block">
            <Icon
              name="search"
              size={16}
              className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-ink-subtle"
            />
            <input
              type="search"
              name="q"
              placeholder={tc('searchPlaceholder')}
              aria-label={tc('search')}
              className={`h-9 w-full rounded-full border border-line-strong bg-surface-sunken ps-9 pe-3 text-body-sm text-ink placeholder:text-ink-subtle focus:bg-surface ${FOCUS_RING}`}
            />
          </form>

          <div className="ms-auto flex items-center gap-1.5">
            {usePilotFixtures() ? (
              <span
                className="hidden items-center gap-1.5 rounded-full bg-caution-soft px-2.5 py-1 text-micro font-semibold text-caution ring-1 ring-caution/25 ring-inset lg:inline-flex"
                title={tApp('pilotHint')}
              >
                <Icon name="dot" size={9} />
                {tApp('pilot')}
              </span>
            ) : null}
            {aiConfigured ? <AssistantLauncher label={ta('title')} /> : null}
            <NotificationBell inbox={inbox} />
            <TimeZoneSwitch current={session.principal.timezone} />
            {/*
              From \`md\` up only. On a phone the three-way switch was 130px of
              a 358px bar, and the menu button needed the room; it moves into
              the menu sheet below, beside the other things about *you*.
            */}
            <span className="hidden md:contents">
              <ThemeSwitch current={theme} />
            </span>
            <LanguageSwitch />
            <MobileMenu
              sections={sections}
              showSettings={canOpenSettings(session)}
              labels={{
                menu: t('menu'),
                close: tc('close'),
                search: tc('search'),
                searchPlaceholder: tc('searchPlaceholder'),
                tracking: t('tracking'),
                settings: t('settings'),
              }}
              account={
                <div className="flex flex-col gap-3">
                  {/* The time zone stays a desk setting: see \`TimeZoneSwitch\`. */}
                  <div className="flex items-center">
                    <ThemeSwitch current={theme} />
                  </div>
                  <div className="flex items-center gap-2.5 rounded-sm bg-surface-sunken/70 p-2">
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-brand text-caption font-semibold text-on-brand">
                      {initials}
                    </span>
                    <span className="flex min-w-0 flex-col leading-tight">
                      <span className="truncate text-body-sm font-medium text-ink">
                        {displayName}
                      </span>
                      <span className="truncate text-micro text-ink-muted">
                        {t(`roles.${roleKey}`)} · {tc('branchCount', { count: branchCodes })}
                      </span>
                    </span>
                    {/* Labelled, not an icon: on a phone this is the only way out. */}
                    <form action={signOut} className="ms-auto shrink-0">
                      <button
                        type="submit"
                        data-mobile-sign-out
                        className="inline-flex h-10 items-center gap-1.5 rounded-sm px-3 text-body-sm font-medium text-ink-muted transition-colors hover:bg-surface hover:text-critical"
                      >
                        <Icon name="sign-out" size={16} />
                        {t('signOut')}
                      </button>
                    </form>
                  </div>
                </div>
              }
            />
          </div>
        </header>

        {/*
          The sidebar is desktop-only, so a phone gets two things in its
          place: this strip, for hopping between neighbouring screens, and the
          menu button in the bar above, for everything — the grouped list,
          search, settings, tracking and signing out. The strip alone was the
          whole of phone navigation once, and it had no way out of a session.
          The menu opens with no JavaScript (invoker commands), which was the
          argument for not having one.
        */}
        <MobileNav sections={sections} />

        {/*
          Above the content, on every internal screen, and outside `main`.

          Vendor access to a customer's commercial data is only acceptable if
          the customer can see it happening without going to look — so this
          sits in the layout rather than on a settings page, and renders
          nothing at all when no session is open (`features/support/ui/banner`).
        */}
        <SupportAccessBanner session={session} />

        {/*
          A flex column, so a page can choose to fill the viewport.

          Every existing screen is a block of content that grows downwards and
          is unaffected: a single child of a column flex container with the
          default `stretch` still lays out exactly as it did. What it buys is
          `/assistant`, which is a chat and therefore has to pin a composer to
          the bottom of the *screen* rather than to the bottom of its content —
          and the alternative was subtracting the chrome's height by hand in a
          `calc`, which is wrong the first time the header wraps.
        */}
        {/*
          No room is kept for a floating button any more.

          On a phone the assistant used to float `bottom-4 end-4`, and padding
          here only cleared it at the very end of the page: while scrolling it
          sat over the balance column of every register. It is an icon in the
          top bar now, as it is a labelled button from `md` up, so nothing
          floats and the page ends where its content does.

          `@container`: the page's grids lay out against this box, not the
          window. From `md` the sidebar takes 248px, so a window breakpoint
          promised a 768px tablet room it did not have; `@3xl:grid-cols-4`
          asks the question that was meant.
        */}
        <main className="@container flex flex-1 flex-col px-4 pt-6 pb-10 md:px-6 lg:px-8">
          {children}
        </main>
      </div>

      {/*
        The assistant, on every internal screen and outside `main`.

        In the layout rather than on a page of its own because the questions it
        answers are asked *while* doing something else — a coordinator with an
        enquiry half-written wants to know what the agent quoted last time, and
        navigating away to ask would lose the form. It opens over whatever is
        there and closes back to it.

        Labels are resolved here, on the server, like every other string in
        this layout: the panel is a client component, and a client component
        that reached for translations would pull the whole message catalogue
        across the boundary.
      */}
      <AssistantDock labels={assistantLabels(ta, usePilotFixtures())} configured={aiConfigured} />

      {/* "Done", said once, after a dialog's save — see `ui/toast.tsx`. */}
      <Toaster labels={{ saved: tc('saved'), dismiss: tc('close') }} />
    </div>
  )
}
