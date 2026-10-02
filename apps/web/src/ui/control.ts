/**
 * The class strings every text control and every button shares.
 *
 * A plain module rather than exports of `form.tsx`, and the distinction is not
 * tidiness. `form.tsx` is a client module, and a server component importing a
 * *string* from one receives a client reference in its place — so the sixteen
 * hand-rolled search boxes and sign-in fields that needed these could not
 * import them, and each grew its own focus treatment instead. Most of them
 * grew the same one, `focus:border-brand`, which is exactly the bug below.
 *
 * ## Focus is not an error
 *
 * Qabandi's brand is a red at hue 27, which is where `critical` lives. A
 * control whose border turned brand-red on focus looked identical to a
 * control that had just failed validation, on every form in the product. The
 * focus treatment is therefore its own token (`--qb-focus`, see `lightTheme`
 * in `@qabandi/brand`), which the palette moves off the brand onto the accent
 * whenever the brand sits on a status hue — and it is drawn as an outline, so
 * the border stays free to say "invalid" while the ring says "here".
 */

/** The ring alone, inset by a pixel so it sits on the border. */
export const FOCUS_OUTLINE =
  'focus-visible:outline-2 focus-visible:-outline-offset-1 focus-visible:outline-focus'

/**
 * The ring a focused control wears, border included.
 *
 * Never combine this with another `focus-visible:border-*` in one class list:
 * which of two conflicting utilities wins is decided by the order Tailwind
 * emits them, not by the order they are written. `CONTROL_BAD` takes
 * `FOCUS_OUTLINE` for exactly that reason.
 */
export const FOCUS_RING = `${FOCUS_OUTLINE} focus-visible:border-focus`

/**
 * A text control at rest.
 *
 * `border-line-strong` rather than `border-line`: the hairline the cards use is
 * 1.3:1 against white, which is fine for a card edge and not fine for the
 * boundary of something a person has to find and type into (WCAG 1.4.11).
 */
export const CONTROL_BASE =
  'w-full rounded-sm border bg-surface text-ink transition-colors placeholder:text-ink-subtle disabled:opacity-60'

export const CONTROL_REST = `border-line-strong hover:border-ink-subtle ${FOCUS_RING}`

/** Invalid keeps its red border while focused; the ring still says where the caret is. */
export const CONTROL_BAD = `border-critical bg-critical-soft/30 ${FOCUS_OUTLINE}`

/** The standard field: 40px, which is also the smallest comfortable tap target. */
export const CONTROL = `${CONTROL_BASE} h-10 px-3 text-body ${CONTROL_REST}`

export const CONTROL_INVALID = `${CONTROL_BASE} h-10 px-3 text-body ${CONTROL_BAD}`

/**
 * The search box a register or the top bar carries — a step quieter than a
 * form field, with room at the inline start for the magnifier.
 */
export const SEARCH_CONTROL = `${CONTROL_BASE} h-10 ps-8 pe-3 text-body-sm ${CONTROL_REST}`

// --- buttons ----------------------------------------------------------------

/**
 * One button vocabulary, for `Button`, `Submit`, `ModalCancel` and the dialog
 * triggers.
 *
 * There were four copies of this, and they had drifted by exactly the amounts
 * that are visible in a row: a submit at `h-9` beside a cancel at `h-9` but a
 * different padding, a ghost trigger four pixels shorter than its neighbours.
 */
export const BUTTON_VARIANT = {
  primary: 'bg-brand font-semibold text-on-brand shadow-card hover:bg-brand-hover',
  secondary: 'border border-line bg-surface font-medium text-ink hover:bg-surface-sunken',
  ghost: 'font-medium text-ink-muted hover:bg-surface-sunken hover:text-ink',
  /** A filled red, for the confirm button inside a destructive dialog. */
  danger: 'bg-critical font-semibold text-on-brand hover:opacity-90',
  /** Outlined red, for the trigger that *opens* one — quieter than the confirm. */
  'danger-outline':
    'border border-critical/40 bg-surface font-medium text-critical hover:bg-critical-soft',
} as const

/*
  Phones get a ten-pixel taller button at every size.

  The desktop sizes are tuned for a dense board operated with a mouse; on a
  phone the same 32px "sm" is a target a thumb misses. `max-md:` raises the
  floor to 40px without changing the desktop rhythm at all.
*/
export const BUTTON_SIZE = {
  sm: 'h-8 max-md:h-10 px-2.5 text-body-sm gap-1.5',
  md: 'h-9 max-md:h-10 px-3.5 text-body gap-2',
  lg: 'h-11 px-5 text-title gap-2',
} as const

export type ButtonVariant = keyof typeof BUTTON_VARIANT
export type ButtonSize = keyof typeof BUTTON_SIZE

export function buttonClass(
  variant: ButtonVariant = 'secondary',
  size: ButtonSize = 'md',
  extra?: string,
): string {
  return [
    // The weight lives in the variant: a second `font-*` here would conflict
    // with it, and the winner would be whichever Tailwind happened to emit last.
    'inline-flex items-center justify-center rounded-sm whitespace-nowrap transition-colors disabled:opacity-60',
    BUTTON_VARIANT[variant],
    BUTTON_SIZE[size],
    extra,
  ]
    .filter(Boolean)
    .join(' ')
}

/**
 * A trigger drawn as a row of a `MoreMenu` panel rather than as a button.
 *
 * Here rather than in `menu.tsx` for the reason this file exists: `Button` is
 * a server component, and it needs the string, not a client reference to it.
 */
export const MENU_ITEM =
  'flex h-10 w-full items-center gap-2.5 rounded-sm px-3 text-start text-body font-medium whitespace-nowrap text-ink transition-colors hover:bg-surface-sunken focus-visible:bg-surface-sunken'

/** The same row for a destructive move — cancel, void. */
export const MENU_ITEM_DANGER =
  'flex h-10 w-full items-center gap-2.5 rounded-sm px-3 text-start text-body font-medium whitespace-nowrap text-critical transition-colors hover:bg-critical-soft focus-visible:bg-critical-soft'
