/**
 * Three faces, from Google Fonts, as a stylesheet the browser fetches.
 *
 * They were `next/font`, which downloads and subsets the files at build time.
 * That made the image build depend on reaching fonts.gstatic.com from inside
 * the builder, and on the deployment server it could not: Turbopack reports
 * the failed download as thirty unresolvable font modules and the landing
 * image never builds, which takes cargosharks.com off the air. `apps/web`
 * already loads its faces this way for the same reason (a build that needs
 * the network to succeed fails in a room without one), and the privacy policy
 * in `content/pages/privacy.tsx` already names Google Fonts as the one third
 * party this site contacts, so the page now does what the policy says.
 *
 * Manrope because the supplied wordmark *is* Manrope ExtraBold converted to
 * outlines — the page and the mark are the same typeface rather than a near
 * match. IBM Plex Mono carries every label, eyebrow and figure, which is the
 * product's own convention: data is set in mono. IBM Plex Sans Arabic is the
 * face `apps/web` already uses, so the site and the software set Arabic
 * identically. The family names are mapped onto `--font-*` in `globals.css`.
 */
export const fontStylesheet =
  'https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans+Arabic:wght@400;500;600;700&display=swap'
