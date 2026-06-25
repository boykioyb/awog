import { ref } from 'vue'

// Pointer-drag resize for a panel handle. Returns a reactive `width`, a `dragging`
// flag (for the handle's active style), and an `onPointerDown` to bind on the
// handle (@pointerdown). `edge: 'left'` = handle on the panel's left edge (e.g. a
// right-docked panel), so dragging left widens it; default 'right' widens on drag-right.
export function useResizable(
  initial: number,
  opts: { min: number; max: number; edge?: 'left' | 'right' },
) {
  const width = ref(initial)
  const dragging = ref(false)
  const edge = opts.edge ?? 'right'

  function onPointerDown(ev: PointerEvent) {
    ev.preventDefault()
    const handle = ev.currentTarget as HTMLElement
    handle.setPointerCapture(ev.pointerId)
    dragging.value = true
    const startX = ev.clientX
    const startW = width.value
    const onMove = (e: PointerEvent) => {
      const dx = e.clientX - startX
      const next = startW + (edge === 'left' ? -dx : dx)
      width.value = Math.max(opts.min, Math.min(opts.max, next))
    }
    const onUp = () => {
      dragging.value = false
      handle.removeEventListener('pointermove', onMove)
      handle.removeEventListener('pointerup', onUp)
    }
    handle.addEventListener('pointermove', onMove)
    handle.addEventListener('pointerup', onUp)
  }

  return { width, dragging, onPointerDown }
}
