// Per-session bridge so the composer's `/style` command can open the response-
// style picker even though the picker chip now lives in the session header (a
// sibling component — a template ref no longer reaches it). The mounted picker
// registers its `open` handler under its session id; the composer dispatches by
// id. Module-scoped (not a store): it holds function references, not reactive
// state, and entries are cleared on unmount.

const openers = new Map<string, () => void>()

// Register (or, with `open: null`, unregister) a picker's open handler for a
// session. The picker calls this on mount / session switch / unmount.
export const registerStylePicker = (sessionId: string, open: (() => void) | null): void => {
  if (open) openers.set(sessionId, open)
  else openers.delete(sessionId)
}

// Open the response-style picker for a session. Returns false when no picker is
// currently mounted for that session (e.g. headless contexts).
export const openSessionStylePicker = (sessionId: string): boolean => {
  const open = openers.get(sessionId)
  if (!open) return false
  open()
  return true
}
