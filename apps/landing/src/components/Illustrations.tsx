/**
 * The one drawing on the site, and it is a technical drawing.
 *
 * The version this replaces was a smooth blue curve with six dots on it and
 * three rounded bars underneath — a diagram in the visual language of an
 * infographic, which is to say of nothing in particular. Terminal's site draws
 * its yard as a wireframe: numbered bays, dashed lane markings, hairline
 * outlines, one label in an accent colour. That reads as a plan somebody works
 * from rather than as decoration, and it costs the same to draw.
 *
 * So this is a berth plan. Six bays, one box in each, and the one that has run
 * past its free days called out in amber — the thread the whole page follows.
 * A forwarder looking at it sees a yard; a designer looking at it sees a drawing
 * that could not have come from a stock icon set.
 *
 * **Everything is `currentColor` except the call-out.** The drawing sits on the
 * dark demurrage band today and would sit on paper if it moved, and a drawing
 * that names its own greys can only ever be right on one surface. The caller
 * sets a text colour, the plan inherits it, and the opacities below do the rest
 * — which is also why the ribs and the bay outlines are not separate tokens.
 * Amber is the exception because it is not a shade, it is the meaning.
 *
 * Inline SVG rather than a file: a few hundred bytes, it inherits the brand
 * tokens, and a re-skin recolours it without touching an asset.
 */
export function YardArt() {
  const bays = [0, 1, 2, 3, 4, 5]
  // The fourth bay is the one over its free time. Fixed rather than random:
  // this drawing is the same drawing on every load, which is what a plan is.
  const late = 3

  return (
    // A numbered plan does not mirror — bay 01 stays bay 01, and a berth is
    // numbered from the same end whichever language the page is in.
    <div dir="ltr" className="w-full">
      <svg viewBox="0 0 320 132" role="presentation" aria-hidden="true" className="w-full">
        {/* The apron the boxes are set against, and the lane in front of it with
            traffic on it. */}
        <path d="M8 104 H312" stroke="currentColor" strokeWidth="1" opacity="0.55" />
        <path d="M8 118 H312" stroke="currentColor" strokeWidth="1" opacity="0.4" className="lane-dash" />

        {bays.map((bay) => {
          const x = 10 + bay * 51
          const isLate = bay === late

          return (
            <g key={bay}>
              {/* The painted bay on the ground. */}
              <rect
                x={x}
                y={30}
                width={44}
                height={74}
                fill="none"
                strokeWidth="1"
                strokeDasharray="3 3"
                stroke="currentColor"
                opacity="0.35"
              />

              {/* The container standing in it, drawn as a plan: the outline and
                  the corrugation lines a box actually has. */}
              <rect
                x={x + 6}
                y={44}
                width={32}
                height={54}
                fill="none"
                strokeWidth={isLate ? 1.4 : 1}
                stroke="currentColor"
                className={isLate ? 'text-amber' : undefined}
                opacity={isLate ? 1 : 0.8}
              />
              {[0, 1, 2, 3].map((rib) => (
                <path
                  key={rib}
                  d={`M${x + 6} ${54 + rib * 12} h32`}
                  strokeWidth="1"
                  stroke="currentColor"
                  className={isLate ? 'text-amber' : undefined}
                  opacity={isLate ? 0.45 : 0.35}
                />
              ))}

              {/* Bay number, in the mono the product labels everything in. */}
              <text
                x={x + 22}
                y={22}
                textAnchor="middle"
                fontSize="8"
                letterSpacing="1"
                className={`figures font-mono ${isLate ? 'fill-amber' : 'fill-current'}`}
                opacity={isLate ? 1 : 0.7}
              >
                {String(bay + 1).padStart(2, '0')}
              </text>

              {/* The call-out on the one box that is over: a leader line and a
                  day count, the same two marks a yard plan actually carries. */}
              {isLate ? (
                <>
                  <path
                    d={`M${x + 22} 44 V 34 H ${x + 60}`}
                    fill="none"
                    strokeWidth="1"
                    stroke="currentColor"
                    className="text-amber"
                  />
                  <text
                    x={x + 64}
                    y={37}
                    fontSize="8"
                    letterSpacing="0.5"
                    className="figures fill-amber font-mono"
                  >
                    +131d
                  </text>
                </>
              ) : null}
            </g>
          )
        })}
      </svg>
    </div>
  )
}
