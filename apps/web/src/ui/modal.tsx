'use client'

/**
 * Dialogs.
 *
 * Built on the native `<dialog>` element and `showModal()`, which is not a
 * detail — it is the reason this file is 150 lines instead of 600. The
 * platform already gives us the focus trap, the inert background, the
 * top-layer stacking that no `z-index` can lose a fight with, and Escape to
 * dismiss. Every one of those is a thing hand-rolled modals get wrong.
 *
 * What is added on top is only what the platform does not do:
 *
 *   - a backdrop click closes it (`<dialog>` does not do this by itself) —
 *     unless something has been typed, see `dirty`
 *   - the page behind stops scrolling while it is open
 *   - a `close()` reachable from anywhere inside, so a form can dismiss the
 *     dialog it lives in without the caller threading a callback down
 *   - a `closeOn` signal, so a server action's success closes the dialog and a
 *     validation failure leaves it open with the errors showing
 *
 * That last one is the whole reason forms work in here. A modal that closes
 * on submit throws away the error message the submit came back with.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { Icon, type IconName } from './icon'
import { buttonClass } from './control'

const DialogContext = createContext<{ close: () => void } | null>(null)

/** Dismisses the dialog from anywhere inside it. */
export function useDialog() {
  const context = useContext(DialogContext)
  return context ?? { close: () => {} }
}

export type ModalSize = 'sm' | 'md' | 'lg' | 'xl'

const SIZE: Record<ModalSize, string> = {
  sm: 'max-w-md',
  md: 'max-w-xl',
  lg: 'max-w-3xl',
  xl: 'max-w-5xl',
}

export interface ModalProps {
  /**
   * What opens it. Given a render prop rather than a fixed button because the
   * same dialog is opened from a toolbar button on one screen and a row's
   * overflow menu on another, and those should not look alike.
   */
  readonly trigger: (props: { onClick: () => void }) => ReactNode
  readonly title: ReactNode
  readonly description?: ReactNode
  readonly icon?: IconName
  readonly size?: ModalSize
  readonly children: ReactNode
  /** Rendered in a hairline-separated footer. */
  readonly footer?: ReactNode
  /**
   * Closes the dialog when this value becomes truthy and changes.
   *
   * Pass the server action's success token. It is a signal rather than a
   * boolean prop so that two consecutive successes both close it.
   */
  readonly closeOn?: string | number | null
  readonly closeLabel?: string
}

export function Modal({
  trigger,
  title,
  description,
  icon,
  size = 'md',
  children,
  footer,
  closeOn = null,
  closeLabel = 'Close',
}: ModalProps) {
  const ref = useRef<HTMLDialogElement>(null)
  const [open, setOpen] = useState(false)
  const titleId = useId()
  const lastSignal = useRef(closeOn)
  /*
    Whether anything inside has been typed into since it opened.

    A stray click on the scrim used to throw away a half-written enquiry —
    the dialog closed, the uncontrolled fields went with it, and there is no
    undo. Once a field has changed, the backdrop stops dismissing and only
    the explicit ways out (Cancel, the close button, Escape) remain. A ref,
    because nothing renders from it.
  */
  const dirty = useRef(false)

  const close = useCallback(() => {
    ref.current?.close()
    setOpen(false)
  }, [])

  const show = useCallback(() => {
    lastSignal.current = closeOn
    dirty.current = false
    ref.current?.showModal()
    setOpen(true)
  }, [closeOn])

  // `showModal()` is imperative and has no declarative equivalent, so the
  // element and the state are reconciled here rather than in the click handler
  // — otherwise Escape, which closes the element directly, desynchronises them.
  useEffect(() => {
    const element = ref.current
    if (!element) return
    const onClose = () => setOpen(false)
    element.addEventListener('close', onClose)
    return () => element.removeEventListener('close', onClose)
  }, [])

  useEffect(() => {
    if (!open) return
    if (closeOn && closeOn !== lastSignal.current) {
      lastSignal.current = closeOn
      close()
    }
  }, [closeOn, open, close])

  /*
    The page behind a modal must not scroll under it — on a phone that is the
    difference between a dialog and a confusing overlay.

    Locking it costs the viewport its scrollbar, and on a desktop that is a
    fifteen-pixel jump of everything behind the scrim at the moment the dialog
    arrives, then back again when it leaves. The gutter is measured before the
    lock and handed to the body as padding, so the page underneath does not
    move at all. Both properties are captured and restored rather than cleared,
    because clearing them would silently drop whatever a caller had set.
  */
  useEffect(() => {
    if (!open) return
    const { style } = document.body
    const previousOverflow = style.overflow
    const previousPadding = style.paddingInlineEnd
    const gutter = window.innerWidth - document.documentElement.clientWidth
    style.overflow = 'hidden'
    if (gutter > 0) style.paddingInlineEnd = `${gutter}px`
    return () => {
      style.overflow = previousOverflow
      style.paddingInlineEnd = previousPadding
    }
  }, [open])

  return (
    <>
      {trigger({ onClick: show })}

      <dialog
        ref={ref}
        aria-labelledby={titleId}
        // The element itself is the backdrop hit target: a click whose target
        // is the dialog rather than any of its children landed outside the
        // panel, because the panel fills the dialog's padding box.
        onClick={(event) => {
          if (event.target === ref.current && !dirty.current) close()
        }}
        onInput={() => {
          dirty.current = true
        }}
        /*
          The height cap and the flex column live on the *element*, and that is
          the whole reason there is one scrollbar in here instead of two.

          A `<dialog>` scrolls itself: the UA gives it `overflow: auto`. With
          the cap a rung lower — on the panel inside — the dialog box measured
          the taller content, grew a scrollbar of its own, and parked it beside
          the body's. Two nested scrollbars, each moving a different amount,
          and the one under the cursor was rarely the one the reader wanted.

          `open:flex` rather than a bare `flex`: `display` on a plain `dialog`
          selector beats the user-agent's `display: none` for a closed one, and
          every dialog on the page would render inline, permanently.
        */
        // `visible`: a dialog opened from a `MoreMenu` lives inside a panel
        // that hides itself with `visibility` once the row is clicked, and
        // visibility is inherited — see `ui/menu.tsx`.
        className={`visible m-auto max-h-[85dvh] w-[calc(100vw-2rem)] ${SIZE[size]} overflow-hidden rounded-lg border border-line bg-surface p-0 text-ink shadow-pop backdrop:bg-[color:var(--qb-scrim)] backdrop:backdrop-blur-[2px] open:flex open:animate-[qb-modal-in_140ms_ease-out]`}
      >
        <div className="flex min-h-0 w-full flex-1 flex-col">
          <header className="flex items-start gap-3 border-b border-line px-5 py-4">
            {icon ? (
              <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent">
                <Icon name={icon} size={18} />
              </span>
            ) : null}
            <div className="min-w-0 flex-1">
              <h2 id={titleId} className="text-heading font-semibold text-ink">
                {title}
              </h2>
              {description ? (
                <p className="mt-0.5 text-body-sm text-ink-muted">{description}</p>
              ) : null}
            </div>
            <button
              type="button"
              onClick={close}
              aria-label={closeLabel}
              className="-me-2 -mt-1 flex size-10 shrink-0 items-center justify-center rounded-sm text-ink-subtle transition-colors hover:bg-surface-sunken hover:text-ink"
            >
              <Icon name="close" size={17} />
            </button>
          </header>

          <DialogContext.Provider value={{ close }}>
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">{children}</div>
            {footer ? (
              <footer className="flex items-center justify-end gap-2 border-t border-line bg-surface-sunken/50 px-5 py-3">
                {footer}
              </footer>
            ) : null}
          </DialogContext.Provider>
        </div>
      </dialog>
    </>
  )
}

/**
 * A button that dismisses the dialog it is inside.
 *
 * `type="button"` matters: inside a `<form>` the default is `submit`, and a
 * Cancel that submits the form is the worst possible bug in a create dialog.
 */
export function ModalCancel({ children }: { readonly children: ReactNode }) {
  const { close } = useDialog()
  return (
    <button type="button" onClick={close} className={buttonClass('secondary', 'md')}>
      {children}
    </button>
  )
}
