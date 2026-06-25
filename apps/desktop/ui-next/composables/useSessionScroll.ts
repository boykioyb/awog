// Scroll to + briefly flash a transcript message by its `data-mi` index (§8).
// Shared by follow-up anchors (on a source message) and follow-up cards (on the
// composer) so clicking either jumps to + highlights the quoted message. Kept
// DOM-query based (the `data-mi` attribute already exists on every message row)
// so it stays decoupled from the transcript/composer components.
export function useSessionScroll() {
  const scrollToMessage = (msgIndex: number): void => {
    if (typeof document === 'undefined') return
    const el = document.querySelector<HTMLElement>(`[data-mi="${msgIndex}"]`)
    if (!el) return
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    // Self-contained flash (no CSS dependency): briefly tint the row background.
    const prev = el.style.backgroundColor
    const prevTransition = el.style.transition
    el.style.transition = 'background-color .25s ease'
    el.style.backgroundColor = 'color-mix(in srgb, var(--accent) 18%, transparent)'
    window.setTimeout(() => {
      el.style.backgroundColor = prev
      window.setTimeout(() => {
        el.style.transition = prevTransition
      }, 300)
    }, 850)
  }
  return { scrollToMessage }
}
