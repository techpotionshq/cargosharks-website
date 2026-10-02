/**
 * The two events between the top-bar launcher and the dock.
 *
 * Window events rather than a shared context: the launcher is in the layout's
 * header and the dock is a sibling of the whole column, and joining them with
 * a provider would mean wrapping the server-rendered layout in a client one.
 */

/** Launcher → dock: open if closed, close if open. */
export const ASSISTANT_TOGGLE_EVENT = 'qabandi:assistant-toggle'

/** Dock → anyone: the size it is now — `closed`, `docked` or `expanded`. */
export const ASSISTANT_SIZE_EVENT = 'qabandi:assistant-size'
