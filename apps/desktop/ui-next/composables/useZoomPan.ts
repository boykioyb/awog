// Shared wheel-zoom + drag-pan state for the image viewer and Mermaid diagrams.
// Returns plain refs + handlers; the consumer binds @wheel/@pointer* to a viewport
// and applies `translate(tx,ty) scale(scale)` to the stage.
export function useZoomPan(opts?: { min?: number; max?: number; step?: number }) {
  const min = opts?.min ?? 0.2
  const max = opts?.max ?? 8
  const step = opts?.step ?? 0.2

  const scale = ref(1)
  const tx = ref(0)
  const ty = ref(0)

  let dragging = false
  let startX = 0
  let startY = 0
  let originX = 0
  let originY = 0

  const clamp = (v: number) => Math.min(max, Math.max(min, v))
  const zoomBy = (d: number) => {
    scale.value = clamp(Math.round((scale.value + d) * 100) / 100)
  }
  const setScale = (v: number) => {
    scale.value = clamp(v)
  }
  function reset() {
    scale.value = 1
    tx.value = 0
    ty.value = 0
  }

  function onWheel(e: WheelEvent) {
    e.preventDefault()
    zoomBy(e.deltaY < 0 ? step : -step)
  }
  function onPointerDown(e: PointerEvent) {
    dragging = true
    startX = e.clientX
    startY = e.clientY
    originX = tx.value
    originY = ty.value
    const el = e.currentTarget as HTMLElement
    el.setPointerCapture?.(e.pointerId)
  }
  function onPointerMove(e: PointerEvent) {
    if (!dragging) return
    tx.value = originX + (e.clientX - startX)
    ty.value = originY + (e.clientY - startY)
  }
  function onPointerUp() {
    dragging = false
  }

  return {
    scale,
    tx,
    ty,
    zoomBy,
    setScale,
    reset,
    onWheel,
    onPointerDown,
    onPointerMove,
    onPointerUp,
  }
}
