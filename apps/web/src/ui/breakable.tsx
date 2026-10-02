/**
 * An address or a URL that may wrap — at its seams, not mid-word.
 *
 * `wrap-anywhere` was the fix for a long email overflowing a phone, and it
 * fixed it by breaking wherever the line ran out: "fahad.alrashid@alqab /
 * andi.com". A `<wbr>` after each `@`, `.`, `/` and `-` offers the browser the
 * places a person would break the line instead, and it takes the first one
 * that fits. `wrap-anywhere` stays on the element as the last resort for a
 * single segment longer than the column.
 *
 * Isolated left-to-right: an address is Latin in both languages, and in an
 * Arabic cell an unmarked one moved its punctuation to the wrong end.
 */

import { Fragment } from 'react'

export function Breakable({
  text,
  className,
}: {
  readonly text: string
  readonly className?: string
}) {
  const parts = text.split(/(?<=[@./\-_?&=])/)
  return (
    <bdi dir="ltr" className={['wrap-anywhere', className].filter(Boolean).join(' ')}>
      {parts.map((part, index) => (
        <Fragment key={index}>
          {index > 0 ? <wbr /> : null}
          {part}
        </Fragment>
      ))}
    </bdi>
  )
}
