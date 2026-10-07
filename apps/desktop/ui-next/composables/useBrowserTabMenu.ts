import type { AwogBrowserTab } from '~/types/awog-bridge'
import type { MenuItem } from '~/composables/useContextMenu'
import { useContextMenu } from '~/composables/useContextMenu'

// Menu chuột phải của MỘT tab trên strip — tải lại / nhân bản / đóng tab / đóng
// hàng loạt theo VỊ TRÍ (trái, phải, các tab khác, tất cả), đúng kiểu tab của
// trình duyệt thật.
//
// Dùng chung cho hai strip: `.mtabs` của session-main (SessionDetail) và strip
// của chrome (BrowserTabs — dock panel + cửa sổ popout). Hai bề mặt khác nhau ở
// cách ĐƯA tab mới/nhân bản lên mặt (strip main PIN bằng con trỏ riêng, còn dock
// đi qua con trỏ của agent) nên composable nhận callback thay vì ôm cả
// `useEmbeddedBrowser`. Đóng hàng loạt vẫn là n lần `closeTab` tuần tự — IPC
// không cần method batch mới.
export function useBrowserTabMenu(opts: {
  tabs: () => AwogBrowserTab[]
  newTab: (url?: string) => Promise<string | null>
  closeTab: (tabId: string) => Promise<unknown>
  reloadTab: (tabId: string) => Promise<unknown>
  // Tab đang HIỂN THỊ trên bề mặt này (strip main = pin `mainTab`, dock/popout =
  // con trỏ active của scope). Đóng hàng loạt mà nuốt cả tab này thì focus nhảy
  // về tab được chuột phải trước — đúng kiểu Chrome giữ tab của menu khi đóng
  // các tab còn lại.
  shownTabId?: () => string | null
  focus?: (tabId: string) => unknown
  // Tab vừa sinh (new/duplicate) được "nhận" thế nào tuỳ bề mặt: strip main pin
  // nó lên thanh tab; các bề mặt khác để newTab tự active qua con trỏ scope.
  adopt?: (tabId: string | null) => void
}) {
  const { t } = useI18n()
  const menu = useContextMenu<AwogBrowserTab>()

  const items = computed<MenuItem[]>(() => {
    const tab = menu.target.value
    if (!tab) return []
    const list = opts.tabs()
    const idx = list.findIndex((v) => v.tabId === tab.tabId)
    return [
      { id: 'new', label: t('browser.tabMenu.new'), icon: 'plus' },
      { id: 'reload', label: t('browser.tabMenu.reload'), icon: 'refresh' },
      // Trang trắng (about:blank) không có gì để nhân bản.
      {
        id: 'duplicate',
        label: t('browser.tabMenu.duplicate'),
        icon: 'copy',
        disabled: !tab.url,
      },
      { separator: true },
      { id: 'close', label: t('browser.tabMenu.close'), icon: 'x' },
      {
        id: 'close-others',
        label: t('browser.tabMenu.closeOthers'),
        disabled: list.length <= 1,
      },
      { id: 'close-left', label: t('browser.tabMenu.closeLeft'), disabled: idx <= 0 },
      {
        id: 'close-right',
        label: t('browser.tabMenu.closeRight'),
        disabled: idx === -1 || idx >= list.length - 1,
      },
      { separator: true },
      { id: 'close-all', label: t('browser.tabMenu.closeAll'), icon: 'trash', danger: true },
    ]
  })

  const open = (e: MouseEvent, tab: AwogBrowserTab): void => menu.open(e, tab)

  // Đóng tuần tự: mỗi closeTab là một lần sync/reattach; chạy song song chỉ rút
  // ngắn được vài ms mà các lần applyList đạp nhau gây nháy. Tab đang hiển thị
  // nằm trong danh sách đóng thì chuyển focus về tab của menu TRƯỚC — Chrome
  // cũng giữ tab được chuột phải thay vì rơi về tab kề.
  const closeMany = async (victims: AwogBrowserTab[], keepId?: string): Promise<void> => {
    const shown = opts.shownTabId?.()
    if (keepId && shown && victims.some((v) => v.tabId === shown)) opts.focus?.(keepId)
    for (const v of victims) await opts.closeTab(v.tabId)
  }

  const onSelect = async (id: string): Promise<void> => {
    // AppContextMenu emit 'select' rồi mới 'close' — nhưng handler này async, nên
    // chụp target + vị trí NGAY đầu, trước await đầu tiên.
    const tab = menu.target.value
    if (!tab) return
    const list = opts.tabs()
    const idx = list.findIndex((v) => v.tabId === tab.tabId)
    if (id === 'new') {
      opts.adopt?.(await opts.newTab())
    } else if (id === 'reload') {
      await opts.reloadTab(tab.tabId)
    } else if (id === 'duplicate') {
      opts.adopt?.(await opts.newTab(tab.url || undefined))
    } else if (id === 'close') {
      await opts.closeTab(tab.tabId)
    } else if (id === 'close-others') {
      await closeMany(
        list.filter((v) => v.tabId !== tab.tabId),
        tab.tabId,
      )
    } else if (id === 'close-left' && idx > 0) {
      await closeMany(list.slice(0, idx), tab.tabId)
    } else if (id === 'close-right' && idx >= 0) {
      await closeMany(list.slice(idx + 1), tab.tabId)
    } else if (id === 'close-all') {
      await closeMany([...list])
    }
  }

  return {
    menuPos: menu.pos,
    menuTab: menu.target,
    items,
    open,
    closeMenu: menu.close,
    onSelect,
  }
}
