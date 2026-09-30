/**
 * The language and appearance switches.
 *
 * Server components wrapping forms that post to Server Actions — no client
 * JavaScript at all. Two reasons that matters here rather than being
 * ideological: the public tracking page is opened on a phone on a port road,
 * and Moment 1 of the demo is someone switching to Arabic in front of the
 * client, which must not wait on a bundle.
 *
 * Server Actions are the only mutation path in this application; nothing posts
 * to an API route (§3).
 */

import { getLocale } from 'next-intl/server'
import { getTranslations } from 'next-intl/server'
import { setLocalePreference, setThemePreference, setTimeZonePreference } from '@/lib/preferences'
import type { ThemeChoice } from '@/lib/theme'
import { DEFAULT_LOCALE, isLocale } from '@/i18n/request'
import { TIME_ZONES, describeTimeZone, timeZoneKey } from '@/lib/time'
import { Icon } from './icon'

export async function LanguageSwitch({ tone = 'ink' }: { readonly tone?: 'ink' | 'chrome' }) {
  const resolved = await getLocale()
  const locale = isLocale(resolved) ? resolved : DEFAULT_LOCALE
  const t = await getTranslations('common')
  const next = locale === 'ar' ? 'en' : 'ar'

  return (
    <form action={setLocalePreference}>
      <input type="hidden" name="locale" value={next} />
      <button
        type="submit"
        // `lang` on the button is not decoration: it tells the browser to
        // shape and speak the label in the language it is written in.
        lang={next}
        aria-label={`${t('language')}`}
        className={`inline-flex h-8 items-center gap-1.5 rounded-sm px-2 text-[0.8125rem] font-medium transition-colors ${
          tone === 'chrome'
            ? 'text-chrome-ink-muted hover:bg-white/10 hover:text-chrome-ink'
            : 'text-ink-muted hover:bg-surface-sunken hover:text-ink'
        }`}
      >
        <Icon name="globe" size={16} />
        {t('language')}
      </button>
    </form>
  )
}

const THEMES: readonly { value: ThemeChoice; icon: 'sun' | 'moon' | 'dashboard' }[] = [
  { value: 'light', icon: 'sun' },
  { value: 'dark', icon: 'moon' },
  { value: 'system', icon: 'dashboard' },
]

export async function ThemeSwitch({
  current,
  tone = 'ink',
}: {
  readonly current: ThemeChoice
  readonly tone?: 'ink' | 'chrome'
}) {
  const t = await getTranslations('common')

  return (
    <form
      action={setThemePreference}
      aria-label={t('theme')}
      className={`inline-flex items-center gap-0.5 rounded-sm p-0.5 ${
        tone === 'chrome' ? 'bg-white/10' : 'bg-surface-sunken'
      }`}
    >
      {THEMES.map(({ value, icon }) => {
        const active = current === value
        return (
          <button
            key={value}
            type="submit"
            name="theme"
            value={value}
            aria-pressed={active}
            title={value}
            className={`flex size-7 items-center justify-center rounded-md transition-colors ${
              active
                ? tone === 'chrome'
                  ? 'bg-white/15 text-chrome-ink'
                  : 'bg-surface text-ink shadow-card'
                : tone === 'chrome'
                  ? 'text-chrome-ink-muted hover:text-chrome-ink'
                  : 'text-ink-subtle hover:text-ink'
            }`}
          >
            <Icon name={icon} size={15} />
          </button>
        )
      })}
    </form>
  )
}

/**
 * The time-zone picker.
 *
 * A `<select>` and a submit, rather than a control that posts on change: the
 * same no-JavaScript rule the two switches above follow, and the reason is the
 * same one — the tracking page is opened on a phone on a port road. A select
 * that needs an `onChange` handler to do anything is a select that does nothing
 * until a bundle arrives.
 *
 * The list is a menu rather than the vocabulary. `resolveTimeZone` accepts any
 * zone the runtime knows, so a principal whose zone was set from a longer list
 * — or by an administrator — keeps it, and it is shown here as the selected
 * option even when `TIME_ZONES` does not name it.
 */
export async function TimeZoneSwitch({
  current,
  tone = 'ink',
}: {
  readonly current: string
  readonly tone?: 'ink' | 'chrome'
}) {
  const t = await getTranslations('common')
  const tZone = await getTranslations('timeZones')
  const locale = await getLocale()

  // A stored zone outside the menu still needs an option to be selected on.
  const options = TIME_ZONES.includes(current) ? TIME_ZONES : [current, ...TIME_ZONES]

  // The city in the viewer's language where the catalogue names it (F64).
  const cityOf = (zone: string): string | undefined => {
    const key = timeZoneKey(zone)
    return tZone.has(key) ? tZone(key) : undefined
  }

  return (
    /*
      Desktop chrome only, like the pilot badge beside it.

      A 412px header has no room for a zone picker: added unconditionally it
      pushed the assistant launcher to x=466 in a 412px viewport — off-screen,
      and unclickable, which is exactly how the mobile assistant specs failed.
      The header is already at its width budget, which is why the badge next to
      this one is `lg:` too.

      The cost is honest: a phone cannot change the setting. It is still
      *honoured* there, because the zone is a column on the principal rather
      than a property of the device, so choosing it once at a desk is enough. A
      settings screen is the right home for it on a phone, and is follow-up
      rather than something to squeeze into this row.
    */
    <form action={setTimeZonePreference} className="hidden items-center gap-1 lg:inline-flex">
      <label className="sr-only" htmlFor="preferences-time-zone">
        {t('timeZone')}
      </label>
      <Icon
        name="clock"
        size={16}
        className={tone === 'chrome' ? 'text-chrome-ink-muted' : 'text-ink-muted'}
      />
      {/*
        No `dir="ltr"` any more: it was there because every label was an
        English city. The labels are now in the page's language, and an Arabic
        label forced left-to-right puts its parenthesised offset on the wrong
        side.
      */}
      <select
        id="preferences-time-zone"
        name="timeZone"
        defaultValue={current}
        className={`h-8 rounded-sm border-0 bg-transparent px-1 text-[0.8125rem] font-medium focus:outline-none ${
          tone === 'chrome' ? 'text-chrome-ink-muted' : 'text-ink-muted'
        }`}
      >
        {options.map((zone) => (
          <option key={zone} value={zone}>
            {describeTimeZone(zone, locale, cityOf(zone))}
          </option>
        ))}
      </select>
      <button
        type="submit"
        className={`inline-flex h-8 items-center rounded-sm px-2 text-[0.8125rem] font-medium transition-colors ${
          tone === 'chrome'
            ? 'text-chrome-ink-muted hover:bg-white/10 hover:text-chrome-ink'
            : 'text-ink-muted hover:bg-surface-sunken hover:text-ink'
        }`}
      >
        {t('save')}
      </button>
    </form>
  )
}
