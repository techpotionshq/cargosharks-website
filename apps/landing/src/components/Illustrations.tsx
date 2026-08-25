/**
 * The two drawings on the page, and why there are only two.
 *
 * Every card on a capability grid *can* have an illustration, and the version
 * of this section that gave all five one looked like a stock icon set — five
 * drawings of roughly equal weight say "here is a grid" rather than "here is a
 * mechanism". These two are here because their claims are structural and a
 * sentence describing a structure is always worse than a picture of it: a lane
 * with six stamped milestones on it, and a figure whose third decimal place is
 * the entire point.
 *
 * Both are inline SVG rather than files. They are a few hundred bytes, they
 * inherit `currentColor` and the brand tokens, and a re-skin recolours them
 * without touching an asset — which a `.svg` in `public/` would not do.
 *
 * **Neither of them mirrors, and that is deliberate.** A lane diagram in an
 * RTL document should run right to left, so the wrapper flips it with a
 * transform; the *labels* are set as HTML beside the drawing rather than as
 * `<text>` inside it precisely so that flipping the artwork does not write the
 * Arabic backwards.
 */

/**
 * A lane, with the six milestones the product stamps on it.
 *
 * The shape is the argument: one line, six points, and the line does not stop
 * and restart at the port. Every system this replaces has a gap there — one
 * application for the booking, another for the customs entry — and the drawing
 * makes the absence of the gap the most visible thing about it.
 */
export function RouteArt() {
  // Even spacing along a 300-unit line, inset far enough that the end pins do
  // not clip against the viewBox.
  const stops = [12, 69, 126, 183, 240, 292]

  return (
    <svg
      viewBox="0 0 304 74"
      role="presentation"
      aria-hidden="true"
      className="w-full text-blue-lit rtl:-scale-x-100"
    >
      {/* The travelled part of the lane: solid, and stopping at the fourth pin.
          The shipment in the drawing is at sea, which is the state a forwarder's
          board is mostly in. */}
      <path
        d="M12 40 C 60 40, 78 22, 126 22 S 192 40, 240 40 L 292 40"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        opacity="0.28"
      />
      <path
        d="M12 40 C 60 40, 78 22, 126 22 S 192 40, 183 40"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        className="lane-dash"
      />

      {stops.map((x, index) => {
        // The pins sit on the curve, so their y has to follow it. Four values
        // rather than a sampled path length: the curve is fixed, this is a
        // drawing, and `getPointAtLength` in a render is a lot of machinery to
        // avoid writing down four numbers.
        const y = index === 1 || index === 2 ? 22 : index === 3 ? 31 : 40
        const done = index <= 3

        return (
          <g key={x}>
            <circle
              cx={x}
              cy={y}
              r={done ? 4 : 3}
              fill="currentColor"
              opacity={done ? 1 : 0.3}
            />
            {done ? <circle cx={x} cy={y} r="7.5" fill="none" stroke="currentColor" strokeWidth="1" opacity="0.35" /> : null}
          </g>
        )
      })}

      {/* The three time rows under the lane — planned, revised, actual — as
          three bars of different length. The claim the card makes is that all
          three are kept, and three bars of the *same* length would say the
          opposite. */}
      {[0, 1, 2].map((row) => (
        <rect
          key={row}
          x="12"
          y={54 + row * 6}
          width={[240, 196, 158][row]}
          height="2"
          rx="1"
          fill="currentColor"
          opacity={[0.34, 0.22, 0.5][row]}
        />
      ))}
    </svg>
  )
}

/**
 * A dinar figure with its third decimal place called out.
 *
 * The card's claim — "money is decimal all the way down" — is the single most
 * abstract thing on the page and the single most consequential to a Kuwaiti
 * buyer. Drawn, it takes about half a second: three places, and the last one
 * lit. Written, it takes a paragraph and is still an assertion.
 *
 * Set in `<text>` rather than HTML because the ring has to sit on a specific
 * glyph, and a ring positioned against text laid out by the browser is a ring
 * that moves when the font falls back.
 */
export function DinarArt() {
  return (
    /*
     * Markup, not SVG — and that is the whole lesson of this component.
     *
     * It was an `<svg>` with the figure in a `<text>` and a bracket drawn as a
     * `<path>` at hand-measured coordinates. Those coordinates were read off one
     * rendering of IBM Plex Mono at one size, so the bracket was correct on the
     * machine it was drawn on and nowhere else: at a different size, or before
     * the webfont loaded, or on any fallback mono, the glyphs moved and the
     * bracket did not. A mark that points at a specific digit has to be
     * positioned by whatever is laying out that digit, which in a browser is
     * the browser. Here the bracket is a box under a `<span>` and it is right by
     * construction.
     *
     * `dir="ltr"` because a figure is Latin numerals reading left to right in
     * both languages. An Arabic reader sees `4187.264` exactly as the product
     * prints it, which is the claim.
     */
    <div dir="ltr" className="figures pb-4 font-mono">
      <p className="flex items-baseline gap-2 text-[clamp(1.6rem,3.4vw,2.1rem)] leading-none tracking-[-0.03em]">
        <span className="text-[0.85rem] tracking-normal text-ink-faint">KWD</span>
        <span className="text-ink">
          4187.
          <span className="relative text-blue-lit">
            264
            {/* Three sides of a box, open at the top: a bracket. The bottom edge
                is the one that reads, the two stubs say where it starts and
                stops, and the missing top is what keeps it from looking like a
                field the digits have been typed into. */}
            <span
              aria-hidden="true"
              className="absolute inset-x-0 top-full mt-1.5 h-2 rounded-b-sm border-x border-b border-blue-lit/60"
            />
          </span>
        </span>
      </p>
    </div>
  )
}
