<template>
  <div class="wsbr">
    <!-- Browser-dev / không có shell Electron: không có Chromium nào để nhúng. -->
    <div v-if="!available" class="empty" style="padding: 30px">
      <div class="et">{{ t('sessions.workspace.browser.unavailable') }}</div>
    </div>

    <template v-else>
      <BrowserChrome
        v-model:url="urlDraft"
        :tabs="tabs"
        :active-tab-id="activeTabId"
        :root="root"
        :project="project"
        :selection-text="selectionText"
        surface="panel"
        :dock="dock"
        :expanded="expanded"
        @select-tab="selectTab"
        @close-tab="closeTab"
        @new-tab="newTab"
        @back="back"
        @forward="forward"
        @reload="reload"
        @submit-url="submitUrl"
        @popout="popout"
        @set-dock="onSetDock"
        @toggle-expand="onToggleExpand"
        @close="onClose"
      />

      <div v-if="error" class="wsbr-err">{{ error }}</div>

      <!-- Khung xem. Element này CHỈ là placeholder: trang web là một view native
           do main process đặt đúng lên hình chữ nhật này (ADR 0086) — vì thế không
           có iframe nào ở đây, và hộp phải giữ kích thước ổn định. -->
      <div ref="viewportEl" class="wsbr-view">
        <div v-if="elsewhere" class="empty" style="padding: 24px">
          <div class="et">{{ t('sessions.workspace.browser.elsewhere') }}</div>
          <button type="button" class="wsbr-takeover" @click="takeOver">
            {{ t('sessions.workspace.browser.takeOver') }}
          </button>
        </div>
        <div v-else-if="occluded" class="wsbr-hint">
          {{ t('sessions.workspace.browser.hidden') }}
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
// View Browser của workspace panel (ADR 0086) — Chromium nhúng của agent, hiện ngay
// cạnh transcript thay vì chỉ trong một cửa sổ ẩn.
//
// Cố ý KHÔNG có nội dung web trong component này. Trang là một `WebContentsView` do
// Electron main sở hữu; `useEmbeddedBrowser` giữ nó dán vào `viewportEl` và trả về
// danh sách tab + action mà `BrowserChrome` (dùng chung với cửa sổ popout) bind vào.
// Mọi thứ model ĐỌC từ trang vẫn đi qua browser_tool của sidecar (hàng rào nonce +
// redaction), không bao giờ qua bề mặt này.
//
// Ba việc còn lại của file này đều là "chỗ nối vào panel", chứ không phải chuyện
// trình duyệt: đổi mép dock, mở rộng panel, đóng view.
import type { WorkspaceDockSide } from '~/stores/settings'
import { useEmbeddedBrowser } from '~/composables/useEmbeddedBrowser'
import { useSettingsStore } from '~/stores/settings'
import { useWorkspaceData } from '~/composables/useWorkspaceData'
import { useWorkspacePanel } from '~/composables/useWorkspacePanel'
import { useSessionsStore } from '~/stores/sessions'

const props = defineProps<{ active?: boolean }>()

const { t } = useI18n()
const settings = useSettingsStore()
const sessions = useSessionsStore()
const viewportEl = useTemplateRef<HTMLElement>('viewportEl')

const {
  available,
  tabs,
  activeTabId,
  urlDraft,
  error,
  occluded,
  elsewhere,
  selectionText,
  submitUrl,
  back,
  forward,
  reload,
  popout,
  newTab,
  selectTab,
  closeTab,
  takeOver,
} = useEmbeddedBrowser({
  viewport: viewportEl,
  // Panel giữ component này mounted khi tab khác đang active (để không quăng trang
  // đi mỗi lần đổi tab), nên "đang hiện" là một prop chứ không phải trạng thái mount
  // — view native vẫn phải rời màn hình trong cả hai đường.
  visible: () => props.active !== false,
})

// Project của session đang xem → root tuyệt đối để lưu ảnh chụp trang. Panel không
// truyền `session` xuống view này, nên lấy từ store: view Browser chỉ render bên
// trong session đang hiển thị, và `active` chính là session đó.
const project = computed(() => sessions.active?.project)
const { root } = useWorkspaceData(project)

// ── Chỗ nối vào panel ───────────────────────────────────────────────────────

const BROWSER_VIEW = 'Browser'
// Bằng WP_SIDE / WP_BOTTOM trong SessionDetail.vue — panel sở hữu việc kéo tay và
// không export biên, nên hai bộ số này phải trùng nhau bằng mắt.
const WP_MAX = { side: 560, bottom: 600 } as const
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

const boxOf = (): Element | null => viewportEl.value?.closest('.wpanel')?.parentElement ?? null

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
watch([viewportEl, dock], () => {
  watchBox()
  measureRoom()
})

// Mở rộng tới đâu là ĐỦ, chứ không phải tới hằng số.
//
// LỖI THẬT 2026-09-09: nút này nhảy thẳng lên `WP_MAX` (560 / 600) bất kể cửa sổ
// rộng bao nhiêu. Đo ở row 680px: panel 560 ⇒ **chat còn 114px**, tức cột chat bị
// nghiền thành một dải card dẹt — người dùng đọc ra là "tràn, không fit màn hình".
// Nay trần là min(WP_MAX, 60% của hộp, hộp − sàn chat): trên màn rộng không đổi gì
// (row 1200 ⇒ vẫn 560), trên màn hẹp thì nó dừng trước khi giết cột chat.
const expandTarget = computed<number>(() => {
  const cap = isBottom.value ? WP_MAX.bottom : WP_MAX.side
  const box = room.value
  if (box === null) return cap
  const floor = isBottom.value ? CHAT_FLOOR.bottom : CHAT_FLOOR.side
  return Math.max(
    isBottom.value ? WP_DEFAULT.bottom : WP_DEFAULT.side,
    Math.min(cap, Math.round(box * 0.6), box - floor),
  )
})

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
watch([expandTarget, panelSize], ([target, size]) => {
  if (size <= target) return
  if (dock.value === 'bottom') settings.setWorkspaceBottomHeight(target)
  else if (dock.value === 'left') settings.setWorkspaceLeftWidth(target)
  else settings.setWorkspaceRightWidth(target)
})

// "Đã mở rộng" = đang ở (gần) mức lớn nhất mà chỗ này cho phép, không phải bằng
// hằng số — nếu không thì trên màn hẹp nút sẽ mãi hiện "mở rộng" dù không nới
// thêm được nữa.
const expanded = computed(() => panelSize.value >= expandTarget.value - 4)
const onToggleExpand = (): void => {
  const next = expanded.value
    ? isBottom.value
      ? WP_DEFAULT.bottom
      : WP_DEFAULT.side
    : expandTarget.value
  if (dock.value === 'bottom') settings.setWorkspaceBottomHeight(next)
  else if (dock.value === 'left') settings.setWorkspaceLeftWidth(next)
  else settings.setWorkspaceRightWidth(next)
}

// Đóng view Browser (không phải đóng cả panel): đi qua đúng cầu nối mà status bar
// dùng, nên SessionDetail vẫn là nơi duy nhất sở hữu danh sách view đang mở.
const { toggleView } = useWorkspacePanel()
const onClose = (): void => toggleView(BROWSER_VIEW)
</script>

<style scoped>
.wsbr {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}
.wsbr-err {
  padding: 6px 10px;
  color: var(--danger);
  background: var(--dangerBg);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  flex-shrink: 0;
}
/* Hộp placeholder mà view native che lên. Tự giữ background để panel không loé
   qua trong nhịp giữa một lần resize và lúc view bám theo. */
.wsbr-view {
  flex: 1 1 auto;
  min-height: 0;
  position: relative;
  background: var(--bg);
  display: flex;
  align-items: center;
  justify-content: center;
}
.wsbr-hint,
.wsbr-takeover {
  color: var(--textDim);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
}
.wsbr-takeover {
  margin-top: 10px;
  padding: 4px 12px;
  border-radius: var(--r-btn);
  background: transparent;
  border: 1px solid var(--border);
  cursor: pointer;
}
.wsbr-takeover:hover {
  border-color: var(--accentBorder);
  color: var(--text);
}
</style>
