import { ref, type Ref } from 'vue'

// One row of a ContextMenu. Separators, danger/disabled rows, a trailing hint
// (shortcut), and one level of submenu via `children`.
export type MenuItem = {
  id?: string
  label?: string
  icon?: string
  // Chấm màu dữ liệu (vd màu hồ sơ trình duyệt) vẽ trước nhãn — màu của NGƯỜI DÙNG,
  // không phải token theme.
  dot?: string
  danger?: boolean
  disabled?: boolean
  // Marks the row as the current selection — accent color + trailing checkmark.
  active?: boolean
  hint?: string
  separator?: boolean
  children?: MenuItem[]
  // Nút nhỏ ngay trên hàng (vd − 100% + của thu phóng) thay cho một lớp submenu. Bấm
  // phát `select` với id của nút và GIỮ menu mở để bấm tiếp; hàng tự nó không chọn được.
  buttons?: MenuButton[]
}

export type MenuButton = { id: string; title: string; icon?: string; text?: string }

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
