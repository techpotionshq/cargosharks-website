'use client'

/**
 * "More" — the secondary actions of a record, behind one button.
 *
 * A detail page header used to carry every move the record could make as an
 * equal button: an enquiry offered six — Mark replied, Assign, Cancel it,
 * Close, Price it, New quotation — and the one that moved it on was the fifth,
 * no more prominent than the one that ends it. The header now shows the next
 * step on its own and folds the rest in here, so the page says what it wants
 * done and still offers everything else one click away.
 *
 * ## A disclosure, not an ARIA menu
 *
 * What goes inside is the product's ordinary triggers — `RecordDialog`
 * buttons and links, each rendered by its own slice on the server. An ARIA
 * `menu` would require every one of them to become a `menuitem` with roving
 * focus, which is a contract the children cannot keep without knowing they are
 * in a menu. A button with `aria-expanded` that reveals a group is the
 * disclosure pattern, it is correct for exactly this, and Tab works inside it
 * without any help. The arrow keys are added on top because people reach for
 * them in anything that looks like a menu.
 *
 * ## Why the panel hides with `visibility`, not `display`
 *
 * The items are dialog triggers, and each `<dialog>` is a DOM *child* of its
 * trigger even though it paints in the top layer. An ancestor with
 * `display: none` stops a top-layer element rendering at all, so a menu that
 * unmounted or `hidden`-ed itself on click would open an invisible modal and
 * trap focus in it. `visibility` is inherited but overridable — `Modal` sets
 * `visible` on its dialog — so the panel can disappear while the dialog it
 * launched stays on screen.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react'
import { Icon } from './icon'
import { buttonClass } from './control'

const InMenu = createContext(false)

/** True inside a `MoreMenu` — triggers use it to draw themselves as rows. */
export function useInMenu(): boolean {
  return useContext(InMenu)
}

export function MoreMenu({
  label,
  children,
}: {
  /** The button's text — "More". Also its accessible name. */
  readonly label: string
  readonly children: ReactNode
}) {
  const [open, setOpen] = useState(false)
  /*
    Every item is permission-gated by its own slice, so a read-only account
    can arrive with a menu of nothing. A More button that opens onto an empty
    panel is a broken control; it hides itself instead. Measured after mount
    because the items are rendered on the server and only the DOM knows.
  */
  const [empty, setEmpty] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const button = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const panelId = useId()
  /*
    How far the panel has to move to stay on screen, in physical pixels.

    `end-0` is right whenever the More button sits at the header's inline end,
    and on a phone it often does not: the header wraps, the button lands at
    the start of its line, and a 224px panel anchored to its end opened off
    the left edge in English (five detail pages) and off the right in Arabic
    (three). Measured on open, after layout and before paint, and nudged back
    inside an 8px margin — so the anchoring stays as designed wherever it fits.
  */
  const [shift, setShift] = useState(0)

  useLayoutEffect(() => {
    if (!open) return
    const element = panel.current
    if (!element) return
    // Where it would sit unshifted: the measured box, less the shift it has.
    const rect = element.getBoundingClientRect()
    const shown = new DOMMatrixReadOnly(getComputedStyle(element).transform).m41
    const left = rect.left - shown
    const right = rect.right - shown
    const width = document.documentElement.clientWidth
    const margin = 8
    setShift(left < margin ? margin - left : right > width - margin ? width - margin - right : 0)
  }, [open])

  const close = useCallback((refocus: boolean) => {
    setOpen(false)
    if (refocus) button.current?.focus()
  }, [])

  // Outside click and Escape. Only while open, so a closed menu costs nothing.
  useEffect(() => {
    if (!open) return
    function onPointer(event: PointerEvent) {
      // A dialog launched from the panel is inside `root` in the DOM even
      // while it covers the screen, so a click in it is not "outside".
      if (root.current && !root.current.contains(event.target as Node)) close(false)
    }
    function onKey(event: globalThis.KeyboardEvent) {
      if (event.key === 'Escape' && !document.querySelector('dialog[open]')) close(true)
    }
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, close])

  /*
    A dialog opened from the panel hands focus back to its trigger when it
    closes — and that trigger is now invisible, so focus fell to the body and a
    keyboard user started again from the top of the page. `close` does not
    bubble, but it can be caught on the way down, so the panel hears every
    dialog inside it and sends focus to the More button instead.
  */
  useEffect(() => {
    const element = root.current
    if (!element) return
    function onDialogClose() {
      requestAnimationFrame(() => button.current?.focus())
    }
    element.addEventListener('close', onDialogClose, true)
    return () => element.removeEventListener('close', onDialogClose, true)
  }, [])

  useEffect(() => {
    const panel = document.getElementById(panelId)
    setEmpty(
      !panel || panel.querySelectorAll(':scope > a, :scope > button, :scope > form').length === 0,
    )
  }, [panelId, children])

  function items(): HTMLElement[] {
    const panel = document.getElementById(panelId)
    if (!panel) return []
    return [
      ...panel.querySelectorAll<HTMLElement>(':scope > a, :scope > button, :scope > form button'),
    ]
  }

  function onPanelKey(event: KeyboardEvent<HTMLDivElement>) {
    const list = items()
    const at = list.indexOf(document.activeElement as HTMLElement)
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const step = event.key === 'ArrowDown' ? 1 : -1
      list[(at + step + list.length) % list.length]?.focus()
    } else if (event.key === 'Home') {
      event.preventDefault()
      list[0]?.focus()
    } else if (event.key === 'End') {
      event.preventDefault()
      list.at(-1)?.focus()
    } else if (event.key === 'Tab' && !event.shiftKey && at === list.length - 1) {
      // Tabbing off the end leaves the menu, and so should the panel.
      close(false)
    }
  }

  return (
    <div ref={root} className={empty ? 'hidden' : 'relative'}>
      <button
        ref={button}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => {
          setOpen((was) => !was)
          if (!open) requestAnimationFrame(() => items()[0]?.focus())
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' && !open) {
            event.preventDefault()
            setOpen(true)
            requestAnimationFrame(() => items()[0]?.focus())
          }
        }}
        className={buttonClass('secondary', 'md')}
      >
        {label}
        <Icon
          name="chevron-down"
          size={14}
          className={`transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      <InMenu.Provider value>
        {/*
          `end-0` anchors the panel under the button's inline end, which is the
          right edge in English and the left in Arabic — the side the header's
          actions sit on — so it opens inwards over the page in both
          directions instead of off the edge of a phone.
        */}
        <div
          ref={panel}
          id={panelId}
          role="group"
          aria-label={label}
          onKeyDown={onPanelKey}
          // A click on a row has done its job: close, but leave focus where the
          // row put it — usually into the dialog it just opened.
          onClick={(event) => {
            if ((event.target as HTMLElement).closest(`#${CSS.escape(panelId)} > *`)) close(false)
          }}
          style={shift ? { transform: `translateX(${shift}px)` } : undefined}
          className={[
            'absolute end-0 top-full z-30 mt-1.5 flex max-w-[calc(100vw-1rem)] min-w-56 flex-col gap-0.5 rounded-card border border-line bg-surface-raised p-1.5 shadow-pop',
            open ? 'visible' : 'invisible',
          ].join(' ')}
        >
          {children}
        </div>
      </InMenu.Provider>
    </div>
  )
}
