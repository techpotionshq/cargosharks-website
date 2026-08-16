/**
 * The root shell — Architecture §11, NFR-16.
 *
 * Three things happen here and nowhere else:
 *
 *   1. `lang` and `dir` are set on `<html>` from the resolved locale, which is
 *      what makes every logical property in the stylesheet do the right thing
 *      without a single conditional in a component.
 *   2. The brand is resolved and emitted as CSS custom properties. Every
 *      Tailwind colour utility in the application resolves against these, so
 *      this one `<style>` element is the whole whitelabel mechanism.
 *   3. The title, description and favicon are taken from the brand rather than
 *      written down — a customer must see nothing identifying a third-party
 *      product (`FR-CP-01`).
 */

import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import { NextIntlClientProvider } from 'next-intl'
import { getLocale, getMessages } from 'next-intl/server'
import { brandCss, faviconDataUri } from '@qabandi/brand'
import { directionOf, isLocale, DEFAULT_LOCALE } from '@/i18n/request'
import { getBrand } from '@/lib/brand'
import { THEME_COOKIE, isThemeChoice } from '@/lib/theme'
import './globals.css'

export async function generateMetadata(): Promise<Metadata> {
  const brand = getBrand()
  return {
    title: {
      default: `${brand.identity.nameEn} · ${brand.identity.taglineEn}`,
      template: `%s · ${brand.identity.nameEn}`,
    },
    description: brand.identity.legalNameEn,
    icons: { icon: faviconDataUri(brand) },
    applicationName: brand.identity.nameEn,
  }
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const resolved = await getLocale()
  const locale = isLocale(resolved) ? resolved : DEFAULT_LOCALE
  const messages = await getMessages()
  const brand = getBrand()

  /**
   * An explicit choice is stamped on the root; its absence leaves the page on
   * `prefers-color-scheme`, which is what the brand stylesheet's media query
   * covers. Read on the server, so there is no flash of the wrong theme.
   */
  const theme = (await cookies()).get(THEME_COOKIE)?.value
  const themeAttr = isThemeChoice(theme) ? theme : undefined

  return (
    <html lang={locale} dir={directionOf(locale)} data-theme={themeAttr} suppressHydrationWarning>
      <head>
        {/*
          The brand's variables, ahead of everything that reads them. Inline
          rather than a stylesheet request: it is under a kilobyte, and a
          flash of unbranded interface on the tracking page would undo the
          only moment in the demo that requires no explanation (Pilot §2).
        */}
        <style
          id="qb-brand"
          // eslint-disable-next-line react/no-danger -- generated from typed tokens, never user input
          dangerouslySetInnerHTML={{ __html: brandCss(brand) }}
        />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        {/*
          Loaded as a stylesheet rather than through `next/font` deliberately:
          the pilot environment is stood up in a day (Pilot §4) and a build
          that reaches the network to succeed is a build that fails in a room
          with no internet. Both faces degrade to the system stack declared in
          the brand's typography tokens.
        */}
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=IBM+Plex+Sans+Arabic:wght@400;500;600;700&display=swap"
        />
      </head>
      <body className="min-h-dvh bg-canvas text-ink antialiased">
        <NextIntlClientProvider messages={messages}>{children}</NextIntlClientProvider>
      </body>
    </html>
  )
}
