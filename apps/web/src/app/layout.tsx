/**
 * The root shell — Architecture §11.
 *
 * `lang` and `dir` are set on `<html>` from the resolved locale, which is what
 * makes every CSS logical property in the stylesheet do the right thing
 * without a single conditional in a component.
 */

import type { Metadata } from 'next'
import { NextIntlClientProvider } from 'next-intl'
import { getLocale, getMessages } from 'next-intl/server'
import { directionOf, isLocale, DEFAULT_LOCALE } from '@/i18n/request'
import './globals.css'

export const metadata: Metadata = {
  title: 'Al-Qabandi & Partners',
  description: 'Digital freight platform',
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const resolved = await getLocale()
  const locale = isLocale(resolved) ? resolved : DEFAULT_LOCALE
  const messages = await getMessages()

  return (
    <html lang={locale} dir={directionOf(locale)}>
      <body className="min-h-dvh antialiased">
        <NextIntlClientProvider messages={messages}>{children}</NextIntlClientProvider>
      </body>
    </html>
  )
}
