import type { ShallowRef } from 'vue'
import type { WorkspaceDockSide } from '~/stores/settings'
import { useSettingsStore } from '~/stores/settings'

// Sizing + dock của view Browser trong workspace panel — tách khỏi
// WorkspaceBrowser.vue để file kia chỉ còn chrome + viewport + ba state
// (unavailable / elsewhere / bình thường). Mọi thứ ở đây là "chỗ nối vào panel",
// không phải chuyện trình duyệt: biên panel sống trong SessionDetail và không
// export, nên cục đo-chỗ-trống phải tự đo qua `closest('.wpanel')`.
export function useBrowserPanelSizing(options: {
  // Khung viewport của trình duyệt — điểm leo để tìm hộp flex chứa panel.
  viewport: Readonly<ShallowRef<HTMLElement | null>>
}) {
  const settings = useSettingsStore()

  const BROWSER_VIEW = 'Browser'
  // Bằng WP_SIDE / WP_BOTTOM trong SessionDetail.vue — panel sở hữu việc kéo tay và
  // không export biên, nên ba bộ số này phải trùng nhau bằng mắt.
  const WP_MAX = { side: 560, bottom: 600 } as const
  const WP_MIN = { side: 240, bottom: 120 } as const
  const WP_DEFAULT = { side: 322, bottom: 260 } as const

  const dock = computed<WorkspaceDockSide>(() => settings.workspaceDockOf(BROWSER_VIEW))
  const onSetDock = (side: WorkspaceDockSide): void => {
    settings.setWorkspaceDock(BROWSER_VIEW, side)
  }

  const isBottom = computed(() => dock.value === 'bottom')
  const panelSize = computed(() =>
    dock.value === 'bottom'
      ? settings.workspacePanel.bottomHeight
      : dock.value === 'left'
        ? settings.workspacePanel.leftWidth
        : settings.workspacePanel.rightWidth,
  )
  // Chỗ mà panel THẬT SỰ có: hộp flex chứa nó (chat + panel). Đo từ element của
  // chính component này (`closest`), không `document.querySelector` — panel sở hữu
  // việc kéo tay và không export biên nào, nên đây là cách duy nhất biết còn bao
  // nhiêu chỗ mà không cần SessionDetail truyền xuống.
  const CHAT_FLOOR = { side: 320, bottom: 220 } as const
  // Phải là REF, không phải hàm đọc DOM gọi trong computed: computed chỉ tính lại khi
  // một dep REACTIVE đổi, còn kích thước cửa sổ thì không phải dep nào cả. Bản đầu
  // của bản vá này mắc đúng lỗi đó — kéo cửa sổ từ 680 lên 1180 mà nút vẫn nghĩ
  // panel đã mở hết cỡ (đo được: ở row 1180, panel 360 vẫn hiện "Trả bảng về cỡ cũ").
  const room = ref<number | null>(null)
  let roomObserver: ResizeObserver | null = null
  let observedBox: Element | null = null

  const boxOf = (): Element | null =>
    options.viewport.value?.closest('.wpanel')?.parentElement ?? null

  // CHỈ đo, không bao giờ đăng ký lại observer ở đây.
  //
  // LỖI THẬT (bản vá đầu của chính chỗ này): callback gọi `disconnect()` rồi
  // `observe()` lại — mà `observe()` một element LUÔN phát callback ngay lần đầu,
  // nên nó tự gọi lại mình vô hạn và Chromium đổ log
  // "ResizeObserver loop completed with undelivered notifications" liên tục.
  // Đăng ký là việc của `watchBox`, chạy ngoài callback.
  //
  // Chỉ ghi khi số THỰC SỰ đổi: mỗi lần ghi là một lần đánh thức `expandTarget` và
  // watcher clamp phía dưới.
  const measureRoom = (): void => {
    const box = boxOf()
    if (!box) {
      if (room.value !== null) room.value = null
      return
    }
    const r = box.getBoundingClientRect()
    const next = Math.round(isBottom.value ? r.height : r.width)
    if (next !== room.value) room.value = next
  }

  // Theo dõi chính hộp flex chứa panel: nó co lại khi cửa sổ đổi cỡ, khi danh sách
  // phiên gập/mở, hay khi panel mép kia mở ra — nhiều đường hơn là `window.resize`.
  // Ghi cỡ panel KHÔNG làm hộp này đổi bề rộng (hộp do cha nó định), nên quan sát nó
  // không tạo vòng phản hồi.
  const watchBox = (): void => {
    const box = boxOf()
    if (!roomObserver || box === observedBox) return
    if (observedBox) roomObserver.unobserve(observedBox)
    observedBox = box
    if (box) roomObserver.observe(box)
  }

  onMounted(() => {
    roomObserver = new ResizeObserver(measureRoom)
    watchBox()
    measureRoom()
  })
  onUnmounted(() => {
    roomObserver?.disconnect()
    roomObserver = null
    observedBox = null
  })
  // Khung tới muộn (mở view sau khi mount) và đổi mép dock thì trục đo cũng đổi.
  watch([options.viewport, dock], () => {
    watchBox()
    measureRoom()
  })

  const setPanelSize = (next: number): void => {
    if (dock.value === 'bottom') settings.setWorkspaceBottomHeight(next)
    else if (dock.value === 'left') settings.setWorkspaceLeftWidth(next)
    else settings.setWorkspaceRightWidth(next)
  }

  // Mở rộng tới đâu là ĐỦ, chứ không phải tới hằng số.
  //
  // LỖI THẬT 2026-09-09: nút này nhảy thẳng lên `WP_MAX` (560 / 600) bất kể cửa sổ
  // rộng bao nhiêu. Đo ở row 680px: panel 560 ⇒ **chat còn 114px**, tức cột chat bị
  // nghiền thành một dải card dẹt — người dùng đọc ra là "tràn, không fit màn hình".
  // Nay trần là min(WP_MAX, 60% của hộp, hộp − sàn chat): trên màn rộng không đổi gì
  // (row 1200 ⇒ vẫn 560), trên màn hẹp thì nó dừng trước khi giết cột chat.
  //
  // Sàn là WP_MIN (cỡ nhỏ nhất kéo tay được), KHÔNG phải WP_DEFAULT: lấy mặc định
  // làm sàn thì trên cửa sổ hẹp trần bị NÂNG lên đúng bằng mặc định, và nút "mở
  // rộng" thành một cú bấm không làm gì trong khi icon vẫn khoe "đang mở rộng" —
  // đúng triệu chứng "lỗi expand". Trần thấp hơn mặc định là một sự thật về chỗ
  // trống, chỗ để nói ra là `canExpand` chứ không phải giấu bằng cách nâng trần.
  const expandTarget = computed<number>(() => {
    const cap = isBottom.value ? WP_MAX.bottom : WP_MAX.side
    const box = room.value
    if (box === null) return cap
    const floor = isBottom.value ? CHAT_FLOOR.bottom : CHAT_FLOOR.side
    return Math.max(
      isBottom.value ? WP_MIN.bottom : WP_MIN.side,
      Math.min(cap, Math.round(box * 0.6), box - floor),
    )
  })

  // Thu về mặc định — nhưng không bao giờ vượt trần. Trên cửa sổ hẹp, mặc định
  // (322) LỚN HƠN trần, nên trả về mặc định là giao cho watcher clamp bên dưới kéo
  // xuống ngay: hai bên đá qua đá lại và panel nhấp nháy.
  const shrinkTarget = computed(() =>
    Math.min(isBottom.value ? WP_DEFAULT.bottom : WP_DEFAULT.side, expandTarget.value),
  )
  // Còn chỗ để mở rộng thật không? Hết chỗ thì nút phải TẮT, không phải im lặng
  // không làm gì.
  const canExpand = computed(() => expandTarget.value - shrinkTarget.value > 4)

  // Cửa sổ NHỎ LẠI thì panel phải nhỏ theo.
  //
  // Chặn cú bấm "mở rộng" mới là nửa việc: mở rộng ở màn 1700 (panel 560) rồi thu
  // cửa sổ về 1200 thì panel vẫn 560 và chat lại còn 114px — cùng một cái nghiền,
  // chỉ khác đường tới. Panel không tự co được (`flex: 0 0 <size>`, cố ý: nó là cột
  // có cỡ do người dùng đặt), nên chỗ duy nhất sửa được là ghi lại cỡ.
  //
  // Có mất preference: kéo rộng 560 rồi thu cửa sổ là mất số 560 đó. Đổi lại là một
  // layout còn dùng được, và bấm mở rộng lần nữa trên màn rộng là lấy lại ngay —
  // giữ một con số mà cột chat không đọc nổi thì không phải là giữ gì cả.
  // CHỈ theo `expandTarget`, không theo `panelSize`.
  //
  // Theo cả `panelSize` thì mỗi `pointermove` của tay kéo panel đều bị kéo ngược
  // về trần ngay trong cùng một tick: panel không nhúc nhích quá 60% hộp và cú kéo
  // giật ngược liên tục (triệu chứng "giật giật" + "kéo không rộng ra được"). Sự
  // kiện cần phản ứng là CHỖ TRỐNG HẸP LẠI (cửa sổ thu nhỏ, mở panel mép kia), và
  // đó đúng là lúc `expandTarget` đổi. Người dùng tự kéo rộng hơn trần là lựa chọn
  // tường minh của họ — để yên.
  watch(expandTarget, (target) => {
    if (panelSize.value <= target) return
    setPanelSize(target)
  })

  // "Đã mở rộng" = đang ở (gần) mức lớn nhất mà chỗ này cho phép, không phải bằng
  // hằng số — nếu không thì trên màn hẹp nút sẽ mãi hiện "mở rộng" dù không nới
  // thêm được nữa.
  const expanded = computed(() => panelSize.value >= expandTarget.value - 4)
  const onToggleExpand = (): void => {
    if (!canExpand.value) return
    setPanelSize(expanded.value ? shrinkTarget.value : expandTarget.value)
  }

  return { dock, onSetDock, expanded, canExpand, onToggleExpand }
}
