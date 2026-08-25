import { IBM_Plex_Mono, IBM_Plex_Sans_Arabic, Manrope } from 'next/font/google'

/**
 * Three faces, self-hosted.
 *
 * `next/font` downloads and subsets these at build time and emits them next to
 * the page, so the deployed site makes no request to Google — which matters
 * here for a reason beyond speed: the privacy policy in `public/privacy.html`
 * enumerates what leaves the visitor's browser, and a font request that carries
 * an IP address to a third party would have to be enumerated with it.
 *
 * Manrope because the supplied wordmark *is* Manrope ExtraBold converted to
 * outlines — the page and the mark are the same typeface rather than a near
 * match. IBM Plex Mono carries every label, eyebrow and figure, which is the
 * product's own convention: data is set in mono. IBM Plex Sans Arabic is the
 * face `apps/web` already uses, so the site and the software set Arabic
 * identically.
 */

export const manrope = Manrope({
  subsets: ['latin'],
  variable: '--font-manrope',
  display: 'swap',
  weight: ['400', '500', '600', '700', '800'],
})

export const plexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  variable: '--font-plex-mono',
  display: 'swap',
  weight: ['400', '500', '600'],
})

export const plexArabic = IBM_Plex_Sans_Arabic({
  subsets: ['arabic'],
  variable: '--font-plex-arabic',
  display: 'swap',
  weight: ['400', '500', '600', '700'],
})

export const fontVariables = `${manrope.variable} ${plexMono.variable} ${plexArabic.variable}`
