/**
 * Finds what is drawn outside the box it belongs to.
 *
 * "Lines are going out of containers" was the report, and nothing in the suite
 * could have seen it: every screen rendered, every heading was there, and the
 * suspend warning still ran 300px out of the side of its dialog. A screenshot
 * test would see it in one language at one width; this asks the layout itself.
 *
 * Runs in the page (it is handed to `page.evaluate`, so it must not close over
 * anything). For every text line and every painted box under `scope` it finds
 * the nearest *container* — a cell, a button, a badge, a dialog, anything with
 * a border on two sides or a rounded fill — and reports what extends past that
 * container's edge. Three things are deliberately not findings:
 *
 *   - Content inside a clipping or scrolling ancestor nearer than the
 *     container. A wide register in its `overflow-x-auto` shell scrolls on
 *     purpose, and a `truncate` ends in an ellipsis on purpose.
 *   - Anything fixed (the sidebar, a toast): it has no container on the page.
 *   - Anything invisible: `checkVisibility` with opacity and visibility, so a
 *     closed menu or a hover-only hint is not measured.
 */
export interface Spill {
  readonly kind: 'text' | 'box' | 'page'
  /** The offending element, as a short tag.class path. */
  readonly element: string
  /** What it spilled out of. */
  readonly container: string
  /** Pixels past the edge, rounded. */
  readonly by: number
  readonly text: string
}

export function findSpills(scopeSelector: string | null): Spill[] {
  const TOLERANCE = 1.5
  const scope = scopeSelector ? document.querySelector(scopeSelector) : document.body
  if (!scope) return []
  const spills: Spill[] = []
  const seen = new Set<string>()

  const describe = (el: Element) => {
    const parts: string[] = []
    let node: Element | null = el
    for (let i = 0; i < 3 && node && node !== document.body; i++) {
      const classes = (node.getAttribute('class') ?? '').split(/\s+/).filter(Boolean).slice(0, 4)
      parts.unshift([node.tagName.toLowerCase(), ...classes].join('.'))
      node = node.parentElement
    }
    return parts.join(' > ')
  }
  const painted = (colour: string) => colour !== 'transparent' && !/,\s*0\)$/.test(colour)
  const borderSides = (style: CSSStyleDeclaration) =>
    (['Top', 'Right', 'Bottom', 'Left'] as const).filter(
      (side) => parseFloat(style[`border${side}Width`]) > 0 && painted(style[`border${side}Color`]),
    ).length
  const isContainer = (el: Element) => {
    if (/^(TD|TH|BUTTON|DIALOG)$/.test(el.tagName) || el.hasAttribute('data-badge')) return true
    const style = getComputedStyle(el)
    if (style.display === 'inline' || style.display === 'contents') return false
    if (borderSides(style) >= 2) return true
    return painted(style.backgroundColor) && parseFloat(style.borderTopLeftRadius) > 0
  }
  const clips = (style: CSSStyleDeclaration) =>
    style.overflowX !== 'visible' || style.overflowY !== 'visible'
  const visible = (el: Element) =>
    el.checkVisibility({ opacityProperty: true, visibilityProperty: true })

  /** The nearest container, or null when something clips first. */
  const containerOf = (from: Element | null) => {
    for (let el = from; el && el !== document.body; el = el.parentElement) {
      const style = getComputedStyle(el)
      if (isContainer(el)) return clips(style) ? null : el
      if (clips(style) || style.position === 'fixed') return null
    }
    return null
  }
  const past = (inner: DOMRect, outer: DOMRect) =>
    Math.max(
      outer.left - inner.left,
      inner.right - outer.right,
      outer.top - inner.top,
      inner.bottom - outer.bottom,
    )
  const record = (
    kind: Spill['kind'],
    el: Element,
    container: Element,
    by: number,
    text: string,
  ) => {
    const key = `${kind}|${describe(el)}|${describe(container)}`
    if (seen.has(key)) return
    seen.add(key)
    spills.push({
      kind,
      element: describe(el),
      container: describe(container),
      by: Math.round(by),
      text: text.trim().replace(/\s+/g, ' ').slice(0, 80),
    })
  }

  // Text, line by line: a block can be the right width while a word in it is not.
  const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT)
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const parent = node.parentElement
    if (!node.textContent?.trim() || !parent || !visible(parent)) continue
    if (parent.closest('svg,script,style,template,option,.sr-only')) continue
    const container = containerOf(parent)
    if (!container) continue
    const edge = container.getBoundingClientRect()
    const range = document.createRange()
    range.selectNodeContents(node)
    for (const line of range.getClientRects()) {
      const by = past(line, edge)
      if (line.width > 0 && by > TOLERANCE) {
        record('text', parent, container, by, node.textContent)
        break
      }
    }
  }

  // Boxes that paint something: rules, fills, outlines, icons, fields.
  for (const el of scope.querySelectorAll('*')) {
    if (el.closest('svg') && el.tagName.toLowerCase() !== 'svg') continue
    if (/^(SCRIPT|STYLE|TEMPLATE|OPTION|BR)$/.test(el.tagName) || !visible(el)) continue
    const style = getComputedStyle(el)
    if (style.position === 'fixed' || style.display === 'contents' || style.display === 'inline')
      continue
    const box = el.getBoundingClientRect()
    if (box.width === 0 && box.height === 0) continue
    const paints =
      /^(svg|IMG|INPUT|SELECT|TEXTAREA|HR)$/.test(el.tagName) ||
      borderSides(style) > 0 ||
      painted(style.backgroundColor)
    if (!paints) continue
    const container = containerOf(el.parentElement)
    if (!container) continue
    const by = past(box, container.getBoundingClientRect())
    if (by > TOLERANCE) record('box', el, container, by, '')
  }

  const sideways = document.documentElement.scrollWidth - window.innerWidth
  if (!scopeSelector && sideways > 1) {
    spills.push({ kind: 'page', element: 'html', container: 'viewport', by: sideways, text: '' })
  }
  return spills
}
