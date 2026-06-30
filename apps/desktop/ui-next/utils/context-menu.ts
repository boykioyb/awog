// Shared cursor-anchored context-menu positioning. Places a menu at the click
// point but keeps it fully on-screen: flips up when it would overflow the bottom,
// clamps horizontally, and caps height with a scroll when taller than the viewport.
// Measured AFTER render (the height isn't known up front), so it self-corrects
// regardless of item count. Used by every right-click menu (session list rows,
// project tabs) so positioning behaves identically everywhere.
export function placeMenu(el: HTMLElement | null, x: number, y: number): Record<string, string> {
  if (!el) return { left: `${x}px`, top: `${y}px` }
  const M = 8
  const vw = window.innerWidth
  const vh = window.innerHeight
  const w = el.offsetWidth
  const h = el.scrollHeight
  const left = x + w > vw - M ? Math.max(M, vw - w - M) : x
  const avail = vh - M * 2
  const maxH = h > avail ? avail : null
  const effH = maxH ?? h
  const top = y + effH > vh - M ? Math.max(M, vh - effH - M) : y
  return {
    left: `${left}px`,
    top: `${top}px`,
    ...(maxH != null ? { maxHeight: `${maxH}px`, overflowY: 'auto' } : {}),
  }
}
