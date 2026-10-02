import type { ReactNode } from 'react'
import { brandCss, faviconDataUri, resolveBrand } from '@qabandi/brand'
import { fontStylesheet } from '@/lib/fonts'
import type { Lang } from '@/content/copy'
import '@/app/globals.css'

/**
 * The `<html>` element, once, for both languages.
 *
 * Next allows one root layout per route group, and this site has two — the
 * English group and the Arabic one — precisely so that `lang` and `dir` can be
 * real attributes on the document rather than something JavaScript patches on
 * after hydration. Everything else about the two documents is identical, so it
 * lives here and neither group gets a chance to drift from the other.
 *
 * The brand stylesheet is inlined rather than linked. It is a few hundred bytes,
 * it defines the custom properties every rule in `globals.css` resolves
 * against, and a separate request for it would give the first paint a page with
 * no colours in it.
 */
export function Document({ lang, children }: { lang: Lang; children: ReactNode }) {
  const brand = resolveBrand()

  return (
    <html lang={lang} dir={lang === 'ar' ? 'rtl' : 'ltr'}>
      <head>
        <style id="qb-brand" dangerouslySetInnerHTML={{ __html: brandCss(brand) }} />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link rel="stylesheet" href={fontStylesheet} />
        <link rel="icon" href={faviconDataUri(brand)} />
        {/* The supplied `.ico` as well: browsers ask for `/favicon.ico` at the
            root by convention whatever the markup says. */}
        <link rel="alternate icon" href="/favicon.ico" sizes="any" />
        <link rel="apple-touch-icon" href="/cargosharks-logo/png/cargosharks-app-icon-180.png" />
        {/* The mobile browser chrome, matched to the page. Read off the ramp
            rather than written down: a re-skin that left the address bar in
            somebody else's navy would undo the whole point of the token. */}
        <meta name="theme-color" content={brand.palette.primary[950]} />
      </head>
      <body>{children}</body>
    </html>
  )
}
