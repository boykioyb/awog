<template>
  <div class="flex h-full min-h-0 flex-col">
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
        :can-expand="canExpand"
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
        @tab-menu="onTabMenu"
      />

      <div v-if="error" class="shrink-0 bg-destructive/10 px-2.5 py-1.5 text-xs text-destructive">
        {{ error }}
      </div>

      <!-- Khung xem. Element này CHỈ là placeholder: trang web là một view native
           do main process đặt đúng lên hình chữ nhật này (ADR 0086) — vì thế không
           có iframe nào ở đây, và hộp phải giữ kích thước ổn định. Hai state phụ
           thuộc sự thật của view: "đang hiện chỗ khác" (elsewhere) thắng trước,
           rồi tới "tab trắng" (empty) — tab trắng không bao giờ được attach nên
           DOM ở đây thật sự nhìn thấy. `.wsbr-view` không còn là selector hook —
           sizing đi qua `closest('.wpanel')` trên chính element này. -->
      <div
        ref="viewportEl"
        class="relative flex min-h-0 flex-1 items-center justify-center bg-background"
      >
        <!-- Frame đông cứng trong lúc overlay DOM bắt view native ẩn (xem
             `frozen` của useEmbeddedBrowser) — khỏi nháy trắng. -->
        <img
          v-if="frozen"
          :src="frozen"
          alt=""
          class="pointer-events-none absolute inset-0 h-full w-full object-fill"
        />
        <!-- Tab trắng → empty-state thắng: "hiện ở chỗ khác" vô nghĩa khi tab
             chưa có trang nào. -->
        <BrowserEmptyState v-if="empty" @open="onEmptyOpen" />
        <BrowserElsewhere v-else-if="elsewhere" :where="elsewhereWhere" @takeover="takeOver" />
      </div>

      <!-- Menu chuột phải của một tab trên strip — Teleport ra body + fixed +
           tự kẹp viewport; chồng lên view native an toàn (detector `covered`
           giấu view thay menu đó). -->
      <Teleport to="body">
        <AppContextMenu
          :open="!!tabMenuPos"
          :position="tabMenuPos ?? { x: 0, y: 0 }"
          :items="tabMenuItems"
          @close="closeTabMenu"
          @select="onTabMenuSelect"
        />
      </Teleport>
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
// Sau refactor file này chỉ còn ghép: chrome + viewport + ba state (unavailable /
// elsewhere / empty). Cục sizing/dock/expand sống ở `useBrowserPanelSizing`.
import { useEmbeddedBrowser } from '~/composables/useEmbeddedBrowser'
import { useBrowserPanelSizing } from '~/composables/useBrowserPanelSizing'
import { useBrowserPip } from '~/composables/useBrowserPip'
import { useBrowserTabMenu } from '~/composables/useBrowserTabMenu'
import { useWorkspaceData } from '~/composables/useWorkspaceData'
import { useWorkspacePanel } from '~/composables/useWorkspacePanel'
import type { Session } from '~/composables/useSessionsData'
import type { AwogBrowserTab } from '~/types/awog-bridge'

const props = defineProps<{ active?: boolean; session: Session }>()

const { t } = useI18n()
const viewportEl = useTemplateRef<HTMLElement>('viewportEl')

const {
  available,
  tabs,
  activeTabId,
  activeTab,
  urlDraft,
  error,
  elsewhere,
  empty,
  frozen,
  selectionText,
  submitUrl,
  back,
  forward,
  reload,
  reloadTab,
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
  // Browser THEO PHIÊN: prop `session` (không phải `sessions.active`) vì một panel
  // đang ngủ trong KeepAlive vẫn là panel CỦA session đó — nó phải giữ đúng scope
  // của mình kể cả lúc người dùng đang mở session khác.
  scope: () => props.session.engineId,
})

// Sizing/dock/expand của panel — đo hộp flex qua `closest('.wpanel')` từ chính
// viewport element. Mọi comment "vì sao" (WP_*, CHAT_FLOOR, lỗi observer loop)
// sống trong composable, không nhân bản lại đây.
const { dock, onSetDock, expanded, canExpand, onToggleExpand } = useBrowserPanelSizing({
  viewport: viewportEl,
})

// View Browser vừa được đưa lên mặt mà card PiP đang giữ view → card nhường
// NGAY: người dùng đã nói "tôi muốn xem ở panel" bằng chính việc mở view, đừng
// bắt họ bấm "Hiện ở đây" thêm một lần trên placeholder elsewhere. closePip trước
// rồi takeOver để claim trực tiếp; lời detach
// trễ của PiP lúc unmount đã được chặn bởi guard owner trong syncOnce/detachNow.
//
// `nextTick` trước takeOver: watcher bắn TRƯỚC khi Vue gỡ `display:none`/bind
// viewportEl (immediate chạy giữa setup, el còn null). sync ở thời điểm đó thấy
// `onScreen` false ⇒ `!wanted` ⇒ vừa nhả claim vừa `api.detach()` — mà
// `detachFrom` ở main park MỌI tab của cửa sổ, tức đạp luôn view PiP đang cầm:
// panel không attach được mà card cũng mất trang, cả hai trông "kẹt".
const pip = useBrowserPip()
watch(
  () => props.active !== false,
  async (v) => {
    if (!v || !pip.open.value) return
    pip.closePip()
    await nextTick()
    void takeOver()
  },
  { immediate: true },
)

// Project của session SỞ HỮU panel này → root tuyệt đối để lưu ảnh chụp trang.
// Đọc từ prop chứ không phải `sessions.active`: panel ngủ trong KeepAlive vẫn
// thuộc về session của nó.
const project = computed(() => props.session.project)
const { root } = useWorkspaceData(project)

// "Ở chỗ khác" cụ thể là ở đâu: `shownElsewhere` (main báo) ⇒ cửa sổ popout/app
// khác; còn chỉ `!isOwner` thì là instance dock kia TRONG CÙNG cửa sổ này đang
// giữ view (panel docked ở hai mép cùng lúc).
const elsewhereWhere = computed<'dock' | 'window'>(() =>
  activeTab.value?.shownElsewhere ? 'window' : 'dock',
)

// Bấm card pin ở empty-state: có tab trắng sẵn thì navigate luôn tab đó (đừng
// sinh thêm tab trắng thừa), không có tab nào thì `open` ở main tự tạo.
const onEmptyOpen = (url: string): Promise<void> => {
  urlDraft.value = url
  return submitUrl()
}

// Đóng view Browser (không phải đóng cả panel): đi qua đúng cầu nối mà status bar
// dùng, nên SessionDetail vẫn là nơi duy nhất sở hữu danh sách view đang mở.
const { toggleView } = useWorkspacePanel()
const onClose = (): void => toggleView('Browser')

// Chuột phải lên tab của strip (đóng trái/phải/khác/tất cả + reload/duplicate).
// Không `adopt`: tab mới/nhân bản tự active qua con trỏ scope của bề mặt này.
const {
  menuPos: tabMenuPos,
  items: tabMenuItems,
  open: openTabMenu,
  closeMenu: closeTabMenu,
  onSelect: onTabMenuSelect,
} = useBrowserTabMenu({
  tabs: () => tabs.value,
  newTab,
  closeTab,
  reloadTab,
  shownTabId: () => activeTabId.value,
  focus: (id) => selectTab(id),
})
const onTabMenu = (p: { tab: AwogBrowserTab; ev: MouseEvent }): void => openTabMenu(p.ev, p.tab)
</script>
