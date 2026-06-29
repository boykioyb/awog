import { ref, type Ref } from 'vue'

// One row of a ContextMenu. Separators, danger/disabled rows, a trailing hint
// (shortcut), and one level of submenu via `children`.
export type MenuItem = {
  id?: string
  label?: string
  icon?: string
  danger?: boolean
  disabled?: boolean
  // Marks the row as the current selection — accent color + trailing checkmark.
  active?: boolean
  hint?: string
  separator?: boolean
  children?: MenuItem[]
}

export type MenuPos = { x: number; y: number }

// Approx menu box — used only to clamp the open point inside the viewport.
const MENU_W = 220
const MENU_H = 320

// Generic right-click menu plumbing: holds the open position + a typed target
// payload, clamps the spawn point to the viewport. One instance per surface.
export function useContextMenu<T = unknown>() {
  const pos = ref<MenuPos | null>(null)
  const target = ref(null) as Ref<T | null>

  function open(e: MouseEvent, payload: T) {
    e.preventDefault()
    pos.value = {
      x: Math.min(e.clientX, window.innerWidth - MENU_W),
      y: Math.min(e.clientY, window.innerHeight - MENU_H),
    }
    target.value = payload
  }
  function close() {
    pos.value = null
    target.value = null
  }
  return { pos, target, open, close }
}
