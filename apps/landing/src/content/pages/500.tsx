/**
 * Converted, not written — and now the source.
 *
 * This page was hand-written HTML in `public/500.html` until the marketing
 * site became a Next app. The conversion was mechanical, by a script, and
 * deliberately so: between them these documents carry fifty-three
 * `[TO CONFIRM]` markers, a clause-numbering scheme people quote back in
 * emails, and a great deal of prose that says exactly what the software does
 * and no more. Retyping that into JSX by hand is the most expensive way to
 * introduce an error in this repository — a dropped `not` in a clause is
 * invisible in review and consequential in a way a layout bug never is.
 *
 * The HTML original is gone and this file is what there is. **Edit it here.**
 * It reads oddly for a React component — `className` on plain markup, no props,
 * no composition — because it is a document rather than a component, and
 * breaking it into components would be the retyping the conversion avoided.
 *
 * Its styling is `src/app/pages.css`, scoped under `.doc-page`, which
 * `src/components/DocPage.tsx` puts on the `<main>` around it.
 */
export function ServerErrorContent() {
  return (
    <>
      <section className="hero hero--page errband">
        <div className="hero__field" aria-hidden="true"><div className="hero__grid"></div></div>

        <div className="shell hero__copy">
          <div className="err">
            <div>
              <p className="err__code" aria-hidden="true">500</p>
              <p className="eyebrow">Error 500 &mdash; server error</p>
              <h1>The request arrived and we failed to answer it.</h1>
              <p className="err__say">That is our fault rather than yours, and it is worth reloading once before doing anything else &mdash; most failures of this kind are a single request that went wrong rather than a site that is down.</p>
              <p className="err__say">Nothing you sent has been lost, because <b>this site keeps nothing</b>. There is no account here, no database behind it and no form that posts anywhere: the only thing on it that sends is a <code>mailto:</code> link, which opens your own mail client and waits for you to press send.</p>
              {/*
                The product's own error boundary shows the Next.js digest, because the
                server logged the stack under the same value and quoting it turns "the
                site is down" into a line an engineer can grep for. A static file has
                no digest and logs nothing, so there is no reference to print here —
                and printing an invented one would be worse than printing none.
              */}
              <p className="err__say">There is no reference number on this page to quote. A static file logs nothing on its own, so what we need instead is the address you were on and roughly when.</p>
            </div>

            <div>
              <ul className="err__out">
                <li><a href="/">
                  <span><b>The home page</b><small>Usually still standing when one page is not.</small></span>
                  <span className="err__tag">Home</span>
                </a></li>
                <li><a href="https://demo.cargosharks.com">
                  <span><b>The live demo</b><small>A separate deployment on a separate address. This failure does not reach it.</small></span>
                  <span className="err__tag">Demo</span>
                </a></li>
                <li><a href="/#demo">
                  <span><b>Book the 15-day pilot</b><small>If that is what you came for, the form is on the home page and takes six fields.</small></span>
                  <span className="err__tag">Pilot</span>
                </a></li>
                <li><a href="mailto:hello@cargosharks.com?subject=Server%20error%20on%20cargosharks.com">
                  <span><b>hello@cargosharks.com</b><small>Tell us the address and the time. A named person replies, not a ticket queue.</small></span>
                  <span className="err__tag">Email</span>
                </a></li>
              </ul>
            </div>
          </div>
        </div>
      </section>
    </>
  )
}
