/**
 * Reading a customer's message the way a person reads it.
 *
 * An email reply carries the whole thread again beneath itself: the customer's
 * two new lines, then "On Tue, Desk wrote:", then every earlier message quoted
 * with `>`. Shown whole on the enquiry's conversation panel, a five-message
 * thread is a wall of repeats, and the new lines are the ones that scroll off.
 * So the body is split into what this message says and the history it quotes;
 * the panel shows the first and folds the second away, one click from sight.
 *
 * Split rather than stripped, because a coordinator sometimes needs the quote:
 * a customer who answers "yes, the second one" inline is only legible against
 * what they answered. Nothing is thrown away here.
 *
 * Pure text in and text out, so the web panel and the service read one rule.
 */

/** The message's own words, and the history it quotes, if any. */
export interface SplitMessage {
  readonly body: string
  readonly quoted: string | null
}

/*
  The lines a mail client writes above the history it quotes.

  English Gmail and Apple Mail ("On <date>, <name> wrote:"), Arabic Gmail
  ("في <date> كتب <name>:"), Outlook's "-----Original Message-----" and its
  long underscore rule, and a forwarded block. Each is the *start* of history:
  everything from it down is quoted, including unmarked lines.
*/
const ATTRIBUTION: readonly RegExp[] = [
  /^On .{4,200} wrote:\s*$/,
  /^في .{4,200}كتب.{0,200}:\s*$/,
  /^-{2,}\s*Original Message\s*-{2,}/i,
  /^-{2,}\s*Forwarded message\s*-{2,}/i,
  /^_{10,}\s*$/,
]

const QUOTE_MARK = /^\s*>/

/**
 * Split a message into its own words and the history quoted beneath them.
 *
 * Two shapes of history are recognised. An attribution line starts it, and
 * everything below belongs to it. Failing that, a trailing run of `>` lines
 * (blank lines allowed between them) is history; `>` lines with the sender's
 * own text *after* them are an inline answer and stay in the body, because
 * folding them would hide half of what the customer said.
 *
 * A `From:` header line counts only once there is text above it, since a
 * forwarded mail that *starts* with one is all the message there is.
 */
export function splitQuotedHistory(text: string): SplitMessage {
  const lines = text.split(/\r?\n/)

  let cut = -1
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!.trim()
    if (ATTRIBUTION.some((pattern) => pattern.test(line))) {
      cut = i
      break
    }
    if (/^From: .+/.test(line) && lines.slice(0, i).some((l) => l.trim() !== '')) {
      cut = i
      break
    }
  }

  if (cut === -1) {
    // The trailing run of quoted lines, walking up from the end.
    let start = lines.length
    for (let i = lines.length - 1; i >= 0; i -= 1) {
      const line = lines[i]!
      if (QUOTE_MARK.test(line)) start = i
      else if (line.trim() !== '') break
    }
    if (start < lines.length) cut = start
  }

  if (cut === -1) return { body: text.trim(), quoted: null }

  const body = lines.slice(0, cut).join('\n').trim()
  const quoted = lines.slice(cut).join('\n').trim()
  // A message that is nothing but a quote is shown, not folded to nothing.
  if (body === '') return { body: text.trim(), quoted: null }
  return { body, quoted: quoted === '' ? null : quoted }
}
