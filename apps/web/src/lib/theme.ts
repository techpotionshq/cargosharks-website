/**
 * Appearance constants.
 *
 * Separate from `preferences.ts` because that file is a `'use server'` module,
 * and such a module may only export async functions — a constant exported
 * beside a Server Action is a build error, not a style question.
 */

export const THEME_COOKIE = 'qabandi_theme'

export type ThemeChoice = 'light' | 'dark' | 'system'

export function isThemeChoice(value: string | undefined): value is 'light' | 'dark' {
  return value === 'light' || value === 'dark'
}
