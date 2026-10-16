import { computed, ref } from 'vue'
import type { MenuItem } from '~/composables/useContextMenu'

// Menu chung cho status bar + rail bottom của Workbench (ADR 0098 — slice F).
//
// Khác `useContextMenu` (neo theo con trỏ, mở XUỐNG): chip nằm ở thanh đáy nên
// menu phải mở phía TRÊN anchor — giống `openCtx` của prototype
// (`top = rect.top - h - 6`). Vì vậy vị trí neo theo `bottom` thay vì `top`,
// chiều cao thực tế không cần ước lượng trước.
//
// Singleton cấp module: thanh trạng thái + rail bottom chỉ được MỘT menu tại
// một thời điểm — mở cái mới tự đóng cái cũ (popovers, không cho chồng nhau).
// Cùng trạng thái với popover thông báo (rail) qua `notifOpen` bên dưới: mở
// một thứ đóng thứ kia.

// `header` bổ sung trên MenuItem: nhãn mục nhỏ (proto `.ph` "ĐỔI PROJECT").
export type WbMenuItem = MenuItem & { header?: string }

export type WbMenu = {
  /** Chip đã mở menu — bấm lại cùng chip = toggle đóng. */
  anchor: HTMLElement
  items: WbMenuItem[]
  /** id của row được chọn — caller định nghĩa hành vi. */
  onSelect: (id: string) => void
  /** Có ô lọc ở đầu menu (placeholder) — cho danh sách dài như "Đổi project". */
  filterPlaceholder?: string
  /** Menu dài (vd "Phong cách trả lời" ~20 mục): row thấp hơn để thấy nhiều mục. */
  compact?: boolean
}

const menu = ref<WbMenu | null>(null)
// Popover thông báo ở rail bottom — cùng ô mutual-exclusion với menu.
const notifOpen = ref(false)

// Bề rộng tối đa của menu: nhãn dài (đường dẫn project) cắt "…" thay vì kéo menu
// rộng gần hết màn hình.
export const WB_MENU_MAX_W = 380
// Trần chiều cao của MỌI menu (cùng trần `min(60vh, 420px)` với `.sb-menu` của
// StatusConfig): danh sách dài cuộn trong menu thay vì vươn gần hết chiều cao cửa sổ.
const MENU_MAX_H = 420

export function useWorkbenchMenu() {
  /**
   * Mở menu neo phía TRÊN `anchor`. Gọi lại với cùng anchor đang mở = đóng
   * (toggle như context menu gốc). `e` là MouseEvent của chip — truyền event
   * để `@click.stop` sẵn có giữ được backdrop của menu cũ đóng đúng.
   */
  function openMenu(
    anchor: HTMLElement,
    items: WbMenuItem[],
    onSelect: (id: string) => void,
    opts?: { filterPlaceholder?: string; compact?: boolean },
  ) {
    if (menu.value?.anchor === anchor) {
      closeMenu()
      return
    }
    notifOpen.value = false
    menu.value = {
      anchor,
      items,
      onSelect,
      ...(opts?.filterPlaceholder ? { filterPlaceholder: opts.filterPlaceholder } : {}),
      ...(opts?.compact ? { compact: true } : {}),
    }
  }

  function closeMenu() {
    menu.value = null
  }

  function pick(id: string) {
    const m = menu.value
    closeMenu()
    m?.onSelect(id)
  }

  // Neo: đáy menu = mép trên chip − 6px (proto). Chip ở nửa phải màn hình thì neo
  // mép PHẢI menu vào mép phải chip — menu rộng tới WB_MENU_MAX_W không tràn viewport.
  // Chiều cao KHÔNG ước lượng: neo theo `bottom` nên menu tự cao theo nội dung, chỉ
  // chặn trần bằng MENU_MAX_H / 60vh / khoảng trống phía trên chip (bản cũ ước lượng 30px/row trong khi row
  // thật 34px ⇒ trần thấp hơn nội dung, phần cuối bị cắt).
  const menuStyle = computed((): Record<string, string> => {
    const m = menu.value
    if (!m) return {}
    const r = m.anchor.getBoundingClientRect()
    const vw = window.innerWidth
    const side: Record<string, string> =
      r.left + WB_MENU_MAX_W > vw - 8
        ? { right: `${Math.max(8, vw - r.right)}px` }
        : { left: `${Math.max(8, r.left)}px` }
    return {
      ...side,
      bottom: `${Math.max(8, window.innerHeight - r.top + 6)}px`,
      maxHeight: `${Math.min(MENU_MAX_H, window.innerHeight * 0.6, Math.max(120, r.top - 14))}px`,
      maxWidth: `${Math.min(WB_MENU_MAX_W, vw - 16)}px`,
    }
  })

  return { menu, menuStyle, openMenu, closeMenu, pick, notifOpen }
}
