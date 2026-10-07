import type { AwogBrowserTab } from '~/types/awog-bridge'
import type { MenuItem } from '~/composables/useContextMenu'
import type { WorkspaceDockSide } from '~/stores/settings'
import { useBrowserContext } from '~/composables/useBrowserContext'
import { useBrowserPins } from '~/composables/useBrowserPins'
import { useSelectionTranslate } from '~/composables/useSelectionTranslate'

// Mọi hành động của chrome trình duyệt (ADR 0086) — logic sau nút `⋯` ở hàng URL
// và menu `⋮` trên hàng tab. Tách khỏi BrowserNavBar để component chỉ còn
// template + emit passthrough.
//
// Ba bề mặt menu nó sở hữu:
//   - `actionsAt`   — menu "cấp trang" của nút ⋯ (ghim · copy · dịch · trích ·
//                     chọn phần tử · dock · popout · phóng to)
//   - `dockAt`      — submenu đổi mép dock, mở TỪ menu ⋯ (giữ nguyên vị trí neo)
//   - `overflowAt`  — menu ⋮ "cấp trình duyệt" (BrowserOverflowMenu): nút bấm
//                     nằm ở hàng TAB nhưng menu render cùng chỗ này, qua
//                     `openOverflow` mà NavBar expose lên cho chrome gọi.
//
// i18n: chuỗi đã có sống ở `sessions.workspace.browser.*` (một key một chuỗi —
// không nhân bản sang browser.json); chỉ chuỗi MỚI nằm ở `browser.*`.

// Getter thay vì ref cụ thể: caller (NavBar) chỉ cần `() => props.x`, composable
// không cần biết nguồn là props hay computed.
export interface BrowserActionsInput {
  // Tab đang active — nguồn của URL THẬT + title khi ghim/copy/dịch.
  tab: () => AwogBrowserTab | null
  // id tab để hỏi selection trên đúng webContents.
  tabId: () => string | null
  // Text người dùng đang bôi đen TRONG trang ('' = không có).
  selectionText: () => string
  // Tên project để giải LLM default cho bản dịch.
  project: () => string | undefined
  expanded: () => boolean
  canExpand: () => boolean
  dock: () => WorkspaceDockSide
  // 'panel' mới có dock/expand/popout; 'window' (popout) thì OS lo mấy thứ đó.
  isPanel: () => boolean
  // 'main' = tab trên main strip (session-main-tabs): không có dock/expand —
  // nó không nằm trong dock — nhưng PiP/popout vẫn có nghĩa (nhả trang ra card
  // nổi hay cửa sổ riêng từ chính tab đang xem).
  isMain?: () => boolean
}

// Tập emit mà menu đụng tới — NavBar forward emit thật của nó xuống đây.
export interface BrowserActionsEmit {
  (e: 'popout'): void
  (e: 'set-dock', side: WorkspaceDockSide): void
  (e: 'toggle-expand'): void
}

export function useBrowserActions(input: BrowserActionsInput, emit: BrowserActionsEmit) {
  const { t } = useI18n()
  const translate = useSelectionTranslate()
  const browserCtx = useBrowserContext()

  const bridge = computed(() =>
    typeof window === 'undefined' ? null : (window.awog?.browser ?? null),
  )
  const hasSelection = computed(() => !!input.selectionText()?.trim())

  // ── Ghim + copy ───────────────────────────────────────────────────────────

  // Danh sách pin là state cấp module (localStorage), nên nút ghim ở đây, dải
  // chip BrowserPinStrip và các card ở BrowserEmptyState nhìn cùng một sự thật.
  const { isPinned, toggle } = useBrowserPins()

  // URL đang TẢI THẬT, không phải draft trong ô nhập. Ghim và copy phải tác động
  // lên trang đang trước mắt người dùng.
  const currentUrl = computed(() => input.tab()?.url ?? '')
  const currentPinned = computed(() => isPinned(currentUrl.value))

  const onTogglePin = (): void => {
    if (!currentUrl.value) return
    toggle({ url: currentUrl.value, title: input.tab()?.title ?? '' })
  }

  const copied = ref(false)
  let copyTimer: ReturnType<typeof setTimeout> | null = null
  const onCopyUrl = async (): Promise<void> => {
    if (!currentUrl.value) return
    try {
      await navigator.clipboard.writeText(currentUrl.value)
      copied.value = true
      if (copyTimer) clearTimeout(copyTimer)
      copyTimer = setTimeout(() => (copied.value = false), 1400)
    } catch {
      // Clipboard bị từ chối — URL vẫn hiện trong ô để copy tay.
    }
  }
  onUnmounted(() => {
    if (copyTimer) clearTimeout(copyTimer)
  })

  // ── Trang → chat / bản dịch ───────────────────────────────────────────────

  const fail = (err: unknown): void => {
    useToast().add({
      title: t('browser.toast.failed', {
        message: err instanceof Error ? err.message : String(err),
      }),
      color: 'error',
    })
  }

  // Nhận RECT chứ không phải MouseEvent: nó chỉ còn được gọi từ menu hành động,
  // nơi không có event nào — và rect phải đo TRƯỚC await dù sao (currentTarget bị
  // xoá khi event kết thúc dispatch), nên truyền thẳng rect là hợp đồng đúng hơn.
  const onTranslate = async (rect: DOMRect): Promise<void> => {
    const api = bridge.value
    if (!api) return
    try {
      const sel = await api.selection(input.tabId() ?? undefined, input.tab()?.scope)
      const text = sel.text.trim()
      if (!text) return
      // Nguồn 'browser': kết quả render trong chrome (BrowserTranslateStrip),
      // KHÔNG phải popover nổi — popover sẽ nằm dưới view native, và cách duy nhất
      // để thấy nó là ẩn trang đi, đúng thứ phá việc đang làm.
      translate.open(text, rect, input.project(), 'browser')
    } catch (err) {
      fail(err)
    }
  }

  // ── Menu (⋮ và split-view) ────────────────────────────────────────────────

  // Rộng xấp xỉ của .smenu — chỉ dùng để căn phải dưới nút; ContextMenu tự kẹp
  // lại vào trong viewport sau khi đo thật.
  const MENU_W = 216
  const anchorOf = (ev: MouseEvent): { x: number; y: number } => {
    const r = (ev.currentTarget as HTMLElement).getBoundingClientRect()
    return { x: Math.max(8, r.right - MENU_W), y: r.bottom + 4 }
  }

  const overflowAt = ref<{ x: number; y: number } | null>(null)
  const dockAt = ref<{ x: number; y: number } | null>(null)
  const actionsAt = ref<{ x: number; y: number } | null>(null)
  // Rect của chính nút `⋯`, giữ lại để bản dịch có điểm neo (menu select không
  // mang theo event nào).
  const actionsRect = ref<DOMRect | null>(null)
  // Nút ⋮ sống ở hàng TAB (BrowserChrome) còn menu render ở NavBar — chrome gọi
  // qua defineExpose, event được forward nguyên vẹn để neo đúng vị trí.
  const openOverflow = (ev: MouseEvent): void => {
    // Surface 'main' gộp menu ⋯ vào menu này — mục 'translate' trong đó cần một
    // rect neo giống khi mở từ ⋯, nên ghi luôn ở đây (menu ⋮ của chrome panel
    // không mục nào đọc actionsRect, ghi thừa cũng vô hại).
    actionsRect.value = (ev.currentTarget as HTMLElement).getBoundingClientRect()
    overflowAt.value = anchorOf(ev)
  }

  const DOCK_OPTS = [
    { side: 'left', icon: 'dock-left', label: 'sessions.workspace.dock.left' },
    { side: 'right', icon: 'dock-right', label: 'sessions.workspace.dock.right' },
    { side: 'bottom', icon: 'dock-bottom', label: 'sessions.workspace.dock.bottom' },
  ] as const

  const dockItems = computed<MenuItem[]>(() =>
    DOCK_OPTS.map((opt) => ({
      id: opt.side,
      label: t(opt.label),
      icon: opt.icon,
      active: opt.side === input.dock(),
    })),
  )
  const onDockSelect = (id: string): void => {
    emit('set-dock', id as WorkspaceDockSide)
  }

  // ── Menu hành động trên trang (§3.6) ─────────────────────────────────────
  // Gom năm nút hành-động-trên-trang + ba nút cửa sổ. Handler vốn nằm trong cục
  // chrome nên không phải luồn prop xuống BrowserOverflowMenu — menu kia là "cấp
  // trình duyệt" (ảnh chụp, nhập cookie, xoá dữ liệu), menu này là "cấp trang".
  const openActions = (ev: MouseEvent): void => {
    actionsRect.value = (ev.currentTarget as HTMLElement).getBoundingClientRect()
    actionsAt.value = anchorOf(ev)
  }
  const actionItems = computed<MenuItem[]>(() => [
    {
      id: 'pin',
      label: currentPinned.value
        ? t('sessions.workspace.browser.unpin')
        : t('sessions.workspace.browser.pin'),
      icon: 'pin',
      active: currentPinned.value,
      disabled: !currentUrl.value,
    },
    {
      id: 'copy',
      label: t('sessions.workspace.browser.copyUrl'),
      icon: copied.value ? 'check' : 'copy',
      disabled: !currentUrl.value,
    },
    // Dịch phần người dùng bôi đen TRONG trang. Text lấy qua bridge (không phải
    // selection của renderer) rồi đi đúng đường selection-to-translate.
    {
      id: 'translate',
      label: t('translate.action'),
      icon: 'book',
      disabled: !hasSelection.value,
      ...(hasSelection.value ? {} : { hint: t('browser.noSelection') }),
    },
    {
      id: 'quote',
      label: t('browser.quote'),
      icon: 'quote',
      disabled: !hasSelection.value,
      ...(hasSelection.value ? {} : { hint: t('browser.noSelection') }),
    },
    { id: 'pick', label: t('browser.pick'), icon: 'inspect' },
    { id: 'sep-view', label: '', separator: true },
    // Nhóm hiển thị của trang — zoom/DevTools/emulation mobile, trạng thái đọc
    // từ TabInfo (main push qua `browser:changed`) nên dấu tick luôn đúng cả khi
    // user zoom bằng ⌘± ngay trong trang hay đóng DevTools bằng nút của nó.
    {
      id: 'zoom',
      label: t('browser.menu.zoom'),
      icon: 'search',
      hint: `${Math.round((input.tab()?.zoom ?? 1) * 100)}%`,
      children: [
        { id: 'zoom-in', label: t('browser.menu.zoomIn'), icon: 'plus', hint: '⌘+' },
        { id: 'zoom-out', label: t('browser.menu.zoomOut'), icon: 'minus', hint: '⌘−' },
        { id: 'zoom-reset', label: t('browser.menu.zoomReset'), icon: 'revert', hint: '⌘0' },
      ],
    },
    {
      id: 'mobile',
      label: t('browser.menu.mobile'),
      icon: 'smartphone',
      active: !!input.tab()?.mobile,
      disabled: !input.tab(),
    },
    {
      id: 'devtools',
      label: t('browser.menu.devtools'),
      icon: 'code',
      active: !!input.tab()?.devtools,
      disabled: !input.tab(),
    },
    ...(input.isPanel()
      ? ([
          {
            id: 'expand',
            label: input.expanded() ? t('browser.shrink') : t('browser.expand'),
            icon: input.expanded() ? 'fullscreen-exit' : 'fullscreen',
            disabled: !input.canExpand(),
            ...(input.canExpand() ? {} : { hint: t('browser.expandNoRoom') }),
          },
          { id: 'dock', label: t('sessions.workspace.dock.change'), icon: `dock-${input.dock()}` },
        ] as MenuItem[])
      : []),
    // PiP giật view về card nổi trong app — chỉ ở panel/main-tab: trong popout
    // thì `open` của PiP thuộc renderer khác, mở ở đây chẳng hiện gì.
    ...(input.isPanel() || (input.isMain?.() ?? false)
      ? ([
          { id: 'sep', label: '', separator: true },
          { id: 'pip', label: t('browser.pip.open'), icon: 'pip' },
          { id: 'popout', label: t('sessions.workspace.browser.popout'), icon: 'external' },
        ] as MenuItem[])
      : []),
  ])
  const onActionSelect = (id: string): void => {
    if (id === 'pin') onTogglePin()
    else if (id === 'copy') void onCopyUrl()
    else if (id === 'translate' && actionsRect.value) void onTranslate(actionsRect.value)
    else if (id === 'quote')
      void browserCtx.quoteSelectionToChat(input.tabId() ?? undefined, input.tab()?.scope)
    else if (id === 'pick')
      void browserCtx.pickToChat(input.tabId() ?? undefined, input.tab()?.scope)
    else if (id === 'zoom-in' || id === 'zoom-out' || id === 'zoom-reset')
      void bridge.value?.zoom(
        input.tabId() ?? undefined,
        input.tab()?.scope,
        id === 'zoom-reset' ? 'reset' : id === 'zoom-in' ? 'in' : 'out',
      )
    else if (id === 'mobile')
      void bridge.value?.mobileEmulation(
        input.tabId() ?? undefined,
        input.tab()?.scope,
        !input.tab()?.mobile,
      )
    else if (id === 'devtools')
      void bridge.value?.devTools(input.tabId() ?? undefined, input.tab()?.scope)
    else if (id === 'expand') emit('toggle-expand')
    else if (id === 'pip') useBrowserPip().openPip()
    else if (id === 'popout') emit('popout')
    else if (id === 'dock' && actionsAt.value) dockAt.value = actionsAt.value
  }

  return {
    // Anchors — NavBar bind `:open` + `@close` lên ba menu.
    overflowAt,
    dockAt,
    actionsAt,
    dockItems,
    actionItems,
    // Nút ⋮ ở hàng tab và nút ⋯ ở hàng URL.
    openOverflow,
    openActions,
    onDockSelect,
    onActionSelect,
  }
}
