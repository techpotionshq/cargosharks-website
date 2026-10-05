/**
 * The registration line under a document's letterhead.
 *
 * Each part prints only when its number is known. Al-Qabandi's commercial
 * registration and customs licence were written as one string with dashes for
 * the numbers, so a document would have carried "Commercial Registration — ·
 * Customs Licence —": a label promising a number the forwarder had not given.
 * A part with no value is now left out whole, and a line with no parts is
 * empty, so the caller prints nothing at all.
 *
 * Here and not in a renderer because both renderers ask it: the PDF letterhead
 * in `apps/service` and any screen in `apps/web` that shows the issuer.
 */

import type { BrandDocuments } from './types'

/** The separator between parts, as the letterhead has always used it. */
const SEPARATOR = ' · '

export function registrationLine(documents: BrandDocuments, locale: 'en' | 'ar'): string {
  const parts = documents.registrations
    .filter((part) => part.value.trim() !== '')
    .map((part) => {
      const label = (locale === 'ar' ? part.labelAr : part.labelEn).trim()
      const value = part.value.trim()
      return label ? `${label} ${value}` : value
    })
  if (parts.length > 0) return parts.join(SEPARATOR)
  return (locale === 'ar' ? documents.registrationNoteAr : documents.registrationNoteEn).trim()
}
