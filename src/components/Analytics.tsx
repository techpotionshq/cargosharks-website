import Script from 'next/script'
import { CtaClicks } from './CtaClicks'

/**
 * Measurement for the marketing site: Google Tag Manager (which loads GA4) and
 * Microsoft Clarity (heatmaps and session recordings).
 *
 * **Production only.** A `pnpm dev` session would pollute the numbers an ad
 * campaign is judged on, and Clarity would record the blog admin previewing
 * unpublished drafts. The Payload admin at `/admin` has its own root layout
 * and never renders this.
 *
 * **What GTM holds.** Container GTM-5QJHLG6X (account "CargoSharks", owned by
 * the CargoSharks Google account, as are GA4 and Clarity) has two tags: the Google tag for GA4 property
 * G-1RKHRW9R3V on every page, and one GA4 event tag that forwards whatever
 * `src/lib/track.ts` pushes. The events are named in code, not in GTM, so a
 * redesign cannot silently break them; GTM only forwards. A source copy of the
 * container config is not kept in this repository: GTM's version history is
 * the record, and `Admin → Export Container` gives it back as JSON.
 *
 * **Clarity is loaded directly, not through GTM**, so it keeps working if the
 * container is ever emptied, and so the masking on the quote form
 * (`data-clarity-mask`, `LeadForm.tsx`) cannot be undone from a dashboard.
 *
 * Neither id is a secret: both are printed in every page's source.
 * Section 03 of the privacy policy describes all of this; change one, change
 * the other.
 */
const GTM_ID = 'GTM-5QJHLG6X'
const CLARITY_ID = 'zczxr7h4hj'

export function Analytics() {
  if (process.env.NODE_ENV !== 'production') return null

  return (
    <>
      <Script id="gtm" strategy="afterInteractive">
        {`(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer','${GTM_ID}');`}
      </Script>
      <Script id="ms-clarity" strategy="afterInteractive">
        {`(function(c,l,a,r,i,t,y){c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);})(window,document,"clarity","script","${CLARITY_ID}");`}
      </Script>
      <CtaClicks />
    </>
  )
}
