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
import { setLocalePreference, setThemePreference } from '@/lib/preferences'
import type { ThemeChoice } from '@/lib/theme'
import { DEFAULT_LOCALE, isLocale } from '@/i18n/request'
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
