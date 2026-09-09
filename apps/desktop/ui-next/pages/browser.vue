<template>
  <div class="bwin">
    <!-- Không có shell Electron (mở route này trong browser thường): không có
         Chromium nào để nhúng, nên nói thẳng thay vì hiện một cái chrome chết. -->
    <div v-if="!available" class="empty" style="padding: 30px">
      <div class="et">{{ t('sessions.workspace.browser.unavailable') }}</div>
    </div>

    <template v-else>
      <BrowserChrome
        v-model:url="urlDraft"
        :tabs="tabs"
        :active-tab-id="activeTabId"
        :selection-text="selectionText"
        surface="window"
        @select-tab="selectTab"
        @close-tab="closeTab"
        @new-tab="newTab"
        @back="back"
        @forward="forward"
        @reload="reload"
        @submit-url="submitUrl"
        @close="onClose"
      />

      <div v-if="error" class="bwin-err">{{ error }}</div>

      <!-- Khung xem — placeholder cho view native, y như trong panel. Cơ chế attach
           lấy cửa sổ đích từ `event.sender`, nên trang này tự nhận view vào rect
           của CHÍNH nó mà không cần kênh IPC nào thêm. -->
      <div ref="viewportEl" class="bwin-view">
        <div v-if="elsewhere" class="empty" style="padding: 24px">
          <div class="et">{{ t('sessions.workspace.browser.elsewhere') }}</div>
          <button type="button" class="bwin-takeover" @click="takeOver">
            {{ t('sessions.workspace.browser.takeOver') }}
          </button>
        </div>
        <div v-else-if="occluded" class="bwin-hint">
          {{ t('sessions.workspace.browser.hidden') }}
        </div>
      </div>
    </template>

    <!-- Bộ host modal/toast/popover mà app shell thường mount. Cửa sổ này không có
         shell nào cả, nên thiếu nó thì confirm() của "Xoá dữ liệu duyệt web", toast
         đường dẫn ảnh chụp và popover dịch đều im lặng. -->
    <AppGlobalHosts />
  </div>
</template>

<script setup lang="ts">
// Cửa sổ popout của trình duyệt nhúng (ADR 0086) — route SPA mà cửa sổ riêng của
// trình duyệt load. Không có app chrome: cùng `BrowserChrome` mà workspace panel
// dùng, cộng một khung placeholder chiếm hết phần còn lại của cửa sổ.
//
// Cửa sổ này KHÔNG cần biết mình là cửa sổ nào: `browser:attach|bounds|detach` lấy
// cửa sổ đích từ `event.sender` ở main, nên một renderer chỉ có thể lấp view vào
// chính nó (invariant #4 — renderer không địa chỉ hoá được cửa sổ khác).
//
// Trọng tài một-chủ trong `useEmbeddedBrowser` là cấp module, tức là PER RENDERER;
// giữa cửa sổ này và cửa sổ chính, thứ phân xử là `shownElsewhere` do main báo về —
// đúng mô hình hand-off của session popout.
import { useEmbeddedBrowser } from '~/composables/useEmbeddedBrowser'

definePageMeta({ layout: false, keepalive: false })
defineOptions({ name: 'BrowserWindowPage' })

const { t } = useI18n()
const viewportEl = useTemplateRef<HTMLElement>('viewportEl')

const {
  available,
  tabs,
  activeTabId,
  activeTab,
  urlDraft,
  error,
  occluded,
  elsewhere,
  selectionText,
  submitUrl,
  back,
  forward,
  reload,
  newTab,
  selectTab,
  closeTab,
  takeOver,
} = useEmbeddedBrowser({
  viewport: viewportEl,
  // Cả cửa sổ là một view Browser duy nhất — không có tab nào khác che nó.
  visible: () => true,
})

// Nút × đóng CỬA SỔ (khác panel: ở đó × đóng view). Main lấy cửa sổ từ sender, nên
// renderer không đóng được cửa sổ của người khác.
const onClose = async (): Promise<void> => {
  await window.awog?.closeSelf().catch(() => {
    // Shell cũ không có closeSelf — người dùng vẫn đóng bằng nút của OS.
  })
}

// Tiêu đề cửa sổ = tiêu đề trang đang xem, để nhiều cửa sổ phân biệt được trong
// danh sách cửa sổ của OS.
useHead({
  title: computed(() => {
    const label = activeTab.value?.title || activeTab.value?.url || ''
    return label ? `${label} — AWOG` : `${t('browser.window.title')} — AWOG`
  }),
})
</script>

<style scoped>
/* Ghim vào cả cửa sổ: khung xem tự lo phần còn lại, thân cửa sổ không bao giờ cuộn. */
.bwin {
  position: fixed;
  inset: 0;
  display: flex;
  flex-direction: column;
  background: var(--bg);
  color: var(--text);
  overflow: hidden;
}
.bwin-err {
  padding: 6px 10px;
  color: var(--danger);
  background: var(--dangerBg);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  flex-shrink: 0;
}
.bwin-view {
  flex: 1 1 auto;
  min-height: 0;
  position: relative;
  background: var(--bg);
  display: flex;
  align-items: center;
  justify-content: center;
}
.bwin-hint,
.bwin-takeover {
  color: var(--textDim);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
}
.bwin-takeover {
  margin-top: 10px;
  padding: 4px 12px;
  border-radius: var(--r-btn);
  background: transparent;
  border: 1px solid var(--border);
  cursor: pointer;
}
.bwin-takeover:hover {
  border-color: var(--accentBorder);
  color: var(--text);
}
</style>
