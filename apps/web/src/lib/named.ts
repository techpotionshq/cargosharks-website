import { sql, type SQL, type SQLWrapper } from 'drizzle-orm'

/**
 * A record's name in the reader's language — F27.
 *
 * Every reference table carries `name_ar` (customers and partners carry
 * `legal_name_ar`), and the registers read only the English column, so an
 * Arabic screen listed "Shuwaikh" and "Fintas Steel Industries" among Arabic
 * labels. The Arabic column is not guaranteed: partners have none yet and an
 * operator may leave it blank, so an empty string falls back to English
 * exactly as a null does — `nullif` is the load-bearing half.
 *
 * Chosen in SQL rather than by selecting both columns so a row type stays one
 * `name` and every register keeps rendering it as before. The English branch
 * returns the column untouched, so `order by` and the `en` output are what
 * they were. Pass columns (aliased ones included) or `sql` fragments naming
 * columns of a raw statement.
 */
export function named(locale: 'en' | 'ar', en: SQLWrapper, ar: SQLWrapper): SQL<string> {
  return locale === 'ar' ? sql<string>`coalesce(nullif(${ar}, ''), ${en})` : sql<string>`${en}`
}

/** The same choice for a value already in hand — fixtures and pages. */
export function pickName(locale: 'en' | 'ar', en: string, ar: string | null | undefined): string
export function pickName(
  locale: 'en' | 'ar',
  en: string | null,
  ar: string | null | undefined,
): string | null
export function pickName(
  locale: 'en' | 'ar',
  en: string | null,
  ar: string | null | undefined,
): string | null {
  return locale === 'ar' && ar ? ar : en
}
