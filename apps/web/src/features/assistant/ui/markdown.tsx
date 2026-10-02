/**
 * The small slice of Markdown a model actually writes, rendered as React.
 *
 * ## Why not a library
 *
 * Every mainstream Markdown renderer produces an HTML *string*, which reaches
 * the page through `dangerouslySetInnerHTML` and therefore needs a sanitiser
 * behind it. That is two dependencies and one configuration mistake away from
 * script execution — and the text here is the least trustworthy in the
 * product: it is written by a model, from rows that include a customer's own
 * words, on a screen where staff read it as the system talking.
 *
 * This returns React elements. There is no HTML string at any point, so there
 * is nothing to sanitise and no configuration to get wrong. React escapes text
 * children, and a `<script>` in an answer renders as the characters
 * `<script>`.
 *
 * ## Why this subset
 *
 * Answers here are short prose with figures in them. What models reliably emit
 * for that is paragraphs, bullet and numbered lists, bold, inline code, the
 * occasional heading, and tables when asked for several rows. That is what is
 * supported. Anything unrecognised falls through as text rather than being
 * dropped, so a construct nobody anticipated is ugly rather than invisible.
 *
 * Links are deliberately rendered as their text and never as anchors. A model
 * can be talked into producing a URL by something it read in a customer email,
 * and an anchor in an operator's interface is a phishing surface for no
 * benefit — every record the assistant refers to is already reachable by its
 * reference.
 */

import type { ReactNode } from 'react'

/* -------------------------------------------------------------------------
 * Inline
 * ---------------------------------------------------------------------- */

/**
 * `**bold**`, `*italic*`, `` `code` `` — one pass, longest marker first.
 *
 * A single regex with alternation rather than three passes, because three
 * passes over the same string re-enter the output of the previous one: bold
 * text containing an asterisk becomes italic inside bold, which is not what
 * was written.
 */
const INLINE = /(\*\*[^*]+\*\*|__[^_]+__|\*[^*\n]+\*|_[^_\n]+_|`[^`\n]+`)/g

function inline(text: string, keyPrefix: string): ReactNode[] {
  return text.split(INLINE).map((part, index) => {
    const key = `${keyPrefix}-${index}`

    if (part.startsWith('**') && part.endsWith('**')) {
      return (
        <strong key={key} className="font-semibold text-ink">
          {part.slice(2, -2)}
        </strong>
      )
    }
    if (part.startsWith('__') && part.endsWith('__')) {
      return (
        <strong key={key} className="font-semibold text-ink">
          {part.slice(2, -2)}
        </strong>
      )
    }
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
      return (
        <code
          key={key}
          className="rounded-sm bg-surface-sunken px-1 py-0.5 font-mono text-[0.8125em] text-ink"
        >
          {part.slice(1, -1)}
        </code>
      )
    }
    if (
      (part.startsWith('*') && part.endsWith('*') && part.length > 2) ||
      (part.startsWith('_') && part.endsWith('_') && part.length > 2)
    ) {
      return (
        <em key={key} className="italic">
          {part.slice(1, -1)}
        </em>
      )
    }

    /*
      A bare link, reduced to its text. `[label](url)` keeps the label and
      throws the target away — see the header on why an anchor here is a
      phishing surface with nothing to offer.
    */
    return part.replace(/\[([^\]]+)\]\((?:[^)]*)\)/g, '$1')
  })
}

/* -------------------------------------------------------------------------
 * Block
 * ---------------------------------------------------------------------- */

const isTableRow = (line: string): boolean => line.trim().startsWith('|') && line.includes('|', 1)
const isDivider = (line: string): boolean =>
  /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(line) && line.includes('-')

const cells = (line: string): string[] =>
  line
    .trim()
    .replace(/^\||\|$/g, '')
    .split('|')
    .map((cell) => cell.trim())

export function Markdown({ text }: { readonly text: string }) {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  const blocks: ReactNode[] = []

  let index = 0
  let key = 0

  const paragraph: string[] = []
  const flush = (): void => {
    if (paragraph.length === 0) return
    const body = paragraph.join(' ')
    paragraph.length = 0
    blocks.push(
      <p key={`p-${key++}`} className="whitespace-pre-wrap">
        {inline(body, `p-${key}`)}
      </p>,
    )
  }

  while (index < lines.length) {
    const line = lines[index]!

    if (line.trim() === '') {
      flush()
      index++
      continue
    }

    /* fenced code -------------------------------------------------------- */
    if (line.trim().startsWith('```')) {
      flush()
      const body: string[] = []
      index++
      while (index < lines.length && !lines[index]!.trim().startsWith('```')) {
        body.push(lines[index]!)
        index++
      }
      index++ // the closing fence, or the end of a stream mid-block
      blocks.push(
        <pre
          key={`code-${key++}`}
          className="overflow-x-auto rounded-md bg-surface-sunken p-3 font-mono text-caption text-ink"
        >
          <code>{body.join('\n')}</code>
        </pre>,
      )
      continue
    }

    /* heading ------------------------------------------------------------- */
    const heading = /^(#{1,6})\s+(.*)$/.exec(line)
    if (heading) {
      flush()
      blocks.push(
        <p key={`h-${key++}`} className="mt-1 font-semibold text-ink">
          {inline(heading[2]!, `h-${key}`)}
        </p>,
      )
      index++
      continue
    }

    /* table --------------------------------------------------------------- */
    if (isTableRow(line) && index + 1 < lines.length && isDivider(lines[index + 1]!)) {
      flush()
      const header = cells(line)
      index += 2
      const rows: string[][] = []
      while (index < lines.length && isTableRow(lines[index]!)) {
        rows.push(cells(lines[index]!))
        index++
      }

      blocks.push(
        /*
          Scrolls inside itself rather than widening the panel. An answer about
          eleven overdue invoices is a wide table, and the dock is 24rem — a
          table that stretched its container would push the composer off the
          screen.
        */
        <div key={`t-${key++}`} className="overflow-x-auto rounded-md border border-line">
          <table className="w-full border-collapse text-body-sm">
            <thead>
              <tr className="bg-surface-sunken">
                {header.map((cell, column) => (
                  <th
                    key={column}
                    className="border-b border-line px-2.5 py-1.5 text-start font-semibold text-ink"
                  >
                    {inline(cell, `th-${column}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rowIndex) => (
                <tr key={rowIndex} className="border-b border-line last:border-b-0">
                  {row.map((cell, column) => (
                    /*
                      Figures line up. `tabular-nums` on every cell rather than
                      guessing which column is money: a mixed table of
                      references and amounts reads badly when only some of it
                      is aligned, and proportional digits in a column of totals
                      are genuinely harder to compare.
                    */
                    <td
                      key={column}
                      className="px-2.5 py-1.5 align-top tabular-nums text-ink-muted"
                    >
                      {inline(cell, `td-${rowIndex}-${column}`)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      )
      continue
    }

    /* lists ---------------------------------------------------------------- */
    const bullet = /^\s*[-*+]\s+(.*)$/.exec(line)
    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line)

    if (bullet || numbered) {
      flush()
      const ordered = Boolean(numbered)
      const items: string[] = []

      while (index < lines.length) {
        const candidate = lines[index]!
        const match = ordered
          ? /^\s*\d+[.)]\s+(.*)$/.exec(candidate)
          : /^\s*[-*+]\s+(.*)$/.exec(candidate)
        if (!match) break
        items.push(match[1]!)
        index++
      }

      const List = ordered ? 'ol' : 'ul'
      blocks.push(
        <List
          key={`l-${key++}`}
          className={`flex flex-col gap-1 ps-5 ${ordered ? 'list-decimal' : 'list-disc'}`}
        >
          {items.map((item, position) => (
            <li key={position} className="ps-0.5">
              {inline(item, `li-${position}`)}
            </li>
          ))}
        </List>,
      )
      continue
    }

    paragraph.push(line)
    index++
  }

  flush()

  return <div className="flex flex-col gap-2.5 text-body leading-relaxed">{blocks}</div>
}
