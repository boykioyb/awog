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
      />

      <div v-if="error" class="wsbr-err">{{ error }}</div>

      <!-- Khung xem. Element này CHỈ là placeholder: trang web là một view native
           do main process đặt đúng lên hình chữ nhật này (ADR 0086) — vì thế không
           có iframe nào ở đây, và hộp phải giữ kích thước ổn định. Hai state phụ
           thuộc sự thật của view: "đang hiện chỗ khác" (elsewhere) thắng trước,
           rồi tới "tab trắng" (empty) — tab trắng không bao giờ được attach nên
           DOM ở đây thật sự nhìn thấy. -->
      <div ref="viewportEl" class="wsbr-view">
        <BrowserElsewhere v-if="elsewhere" :where="elsewhereWhere" @takeover="takeOver" />
        <BrowserEmptyState v-else-if="empty" @open="onEmptyOpen" />
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
// Sau refactor file này chỉ còn ghép: chrome + viewport + ba state (unavailable /
// elsewhere / empty). Cục sizing/dock/expand sống ở `useBrowserPanelSizing`.
import { useEmbeddedBrowser } from '~/composables/useEmbeddedBrowser'
import { useBrowserPanelSizing } from '~/composables/useBrowserPanelSizing'
import { useWorkspaceData } from '~/composables/useWorkspaceData'
import { useWorkspacePanel } from '~/composables/useWorkspacePanel'
import { useSessionsStore } from '~/stores/sessions'

const props = defineProps<{ active?: boolean }>()

const { t } = useI18n()
const sessions = useSessionsStore()
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

// Sizing/dock/expand của panel — đo hộp flex qua `closest('.wpanel')` từ chính
// viewport element. Mọi comment "vì sao" (WP_*, CHAT_FLOOR, lỗi observer loop)
// sống trong composable, không nhân bản lại đây.
const { dock, onSetDock, expanded, canExpand, onToggleExpand } = useBrowserPanelSizing({
  viewport: viewportEl,
})

// Project của session đang xem → root tuyệt đối để lưu ảnh chụp trang. Panel không
// truyền `session` xuống view này, nên lấy từ store: view Browser chỉ render bên
// trong session đang hiển thị, và `active` chính là session đó.
const project = computed(() => sessions.active?.project)
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
</style>
