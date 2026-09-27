<template>
  <div class="bch">
    <!-- Hàng 1 — tab strip bên trái, nhóm nút "cửa sổ" bên phải. Nhóm phải là
         KHỐI CỐ ĐỊNH: strip co lại và cuộn ngang, nút không bao giờ bị bóp. -->
    <div class="bch-tabs">
      <BrowserTabs
        :tabs="tabs"
        :active-tab-id="activeTabId"
        @select-tab="emit('select-tab', $event)"
        @close-tab="emit('close-tab', $event)"
        @new-tab="emit('new-tab')"
      />

      <!-- Nhóm cửa sổ còn ĐÚNG HAI nút (session-ui-refactor §3.6). Dock · popout ·
           phóng to đã chuyển xuống menu `⋯` ở hàng dưới: đây là panel rộng 322px,
           trước đó 15 nút chen nhau tới mức thanh phải xuống dòng. -->
      <div class="bch-grp">
        <!-- ⋮ — sprite chỉ có bộ 3 chấm NGANG, quay 90° thành dọc. Nút ở đây nhưng
             menu render trong NavBar (giữ cùng chỗ với hai menu kia) → gọi qua
             ref, forward nguyên MouseEvent để neo đúng vị trí nút. -->
        <button
          type="button"
          class="bch-act"
          :title="t('browser.menu.title')"
          @click.stop="navBarEl?.openOverflow($event)"
        >
          <Icon
            name="dots"
            class="bch-vdots"
            style="width: var(--icon-sm); height: var(--icon-sm)"
          />
        </button>
        <button
          type="button"
          class="bch-act"
          :title="isPanel ? t('browser.close') : t('browser.closeWindow')"
          @click="emit('close')"
        >
          <Icon name="x" style="width: var(--icon-sm); height: var(--icon-sm)" />
        </button>
      </div>
    </div>

    <BrowserNavBar
      ref="navBarEl"
      v-model:url="url"
      :tab="activeTab"
      :tab-id="activeTabId"
      :root="root"
      :project="project"
      :selection-text="selectionText"
      :surface="surface"
      :expanded="expanded"
      :can-expand="canExpand"
      :dock="dock"
      @back="emit('back')"
      @forward="emit('forward')"
      @reload="emit('reload')"
      @submit-url="emit('submit-url')"
      @popout="emit('popout')"
      @set-dock="emit('set-dock', $event)"
      @toggle-expand="emit('toggle-expand')"
    />

    <BrowserPinStrip :current-url="currentUrl" @open="emit('new-tab', $event)" />

    <BrowserTranslateStrip />
  </div>
</template>

<script setup lang="ts">
// Chrome của trình duyệt nhúng (ADR 0086) — GHÉP MẢNG, không còn chi tiết:
//   BrowserTabs     — hàng tab + nút "+" (emit intent lên)
//   BrowserNavBar   — nav + ô URL + ⋯ + cả ba menu (overflow/dock/actions)
//   BrowserPinStrip / BrowserTranslateStrip — dải phụ dưới chrome
// DÙNG CHUNG cho hai bề mặt qua `surface`: view Browser của workspace panel và
// cửa sổ popout (pages/browser.vue).
//
// Component này KHÔNG giữ view native và không biết hình học của nó: chủ sở hữu
// (`useEmbeddedBrowser`) sống ở bề mặt, vì rect gắn với khung placeholder của bề
// mặt đó. Hợp đồng props/emits giữ nguyên như trước refactor — hai bề mặt không
// cần đổi gì.
import type { AwogBrowserTab } from '~/types/awog-bridge'
import type { WorkspaceDockSide } from '~/stores/settings'

// 'panel' = view của workspace panel (có dock/expand/popout), 'window' = cửa sổ
// popout (những nút đó vô nghĩa: OS lo, và nó đã ở cửa sổ riêng rồi).
export type BrowserChromeSurface = 'panel' | 'window'

const props = withDefaults(
  defineProps<{
    tabs: AwogBrowserTab[]
    activeTabId: string | null
    // Root tuyệt đối của workspace — đích ghi ảnh chụp trang. null ⇒ món đó tắt.
    root?: string | null
    // Tên project để giải LLM default cho bản dịch (giống SessionDetail).
    project?: string
    // Text người dùng đang bôi đen TRONG trang ('' = không có).
    selectionText?: string
    surface?: BrowserChromeSurface
    // Panel đang ở cỡ tối đa? (đổi icon expand ⇄ restore)
    expanded?: boolean
    // Cửa sổ còn đủ chỗ để mở rộng không? Hết chỗ ⇒ nút tắt, chứ không phải bấm
    // vào rồi không có gì xảy ra.
    canExpand?: boolean
    dock?: WorkspaceDockSide
  }>(),
  {
    root: null,
    project: undefined,
    selectionText: '',
    surface: 'panel',
    expanded: false,
    canExpand: true,
    dock: 'right',
  },
)

const emit = defineEmits<{
  'select-tab': [tabId: string]
  'close-tab': [tabId: string]
  'new-tab': [url?: string]
  back: []
  forward: []
  reload: []
  'submit-url': []
  popout: []
  'set-dock': [side: WorkspaceDockSide]
  'toggle-expand': []
  close: []
}>()

// Ô URL là thứ người dùng đang GÕ (khác `activeTab.url` = URL đang tải thật), nên
// nó thuộc về bề mặt (composable đồng bộ lại mỗi lần agent điều hướng) → v-model.
const url = defineModel<string>('url', { required: true })

const { t } = useI18n()

const isPanel = computed(() => props.surface === 'panel')
const activeTab = computed<AwogBrowserTab | null>(
  () => props.tabs.find((tab) => tab.tabId === props.activeTabId) ?? null,
)
// URL đang TẢI THẬT — dải pin đánh dấu "đang mở" trên trang thật, không phải
// draft trong ô nhập.
const currentUrl = computed(() => activeTab.value?.url ?? '')

// Nút ⋮ ở hàng 1 nhưng menu ⋮ sống trong NavBar (giữ cùng chỗ với menu dock +
// menu ⋯): chrome gọi `openOverflow` qua ref, forward nguyên MouseEvent để menu
// neo đúng mép nút.
const navBarEl = useTemplateRef<{ openOverflow: (ev: MouseEvent) => void }>('navBarEl')
</script>

<style scoped>
.bch {
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
}
.bch-tabs {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  box-shadow: inset 0 -1px 0 var(--border);
}
.bch-grp {
  display: flex;
  align-items: center;
  gap: 4px;
  flex: 0 0 auto;
}
.bch-act {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 4px;
  border-radius: var(--r-sm);
  background: transparent;
  border: none;
  color: var(--textDim);
  cursor: pointer;
}
.bch-act:hover:not(:disabled) {
  background: var(--bgHover);
  color: var(--text);
}
.bch-act:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}
.bch-vdots {
  transform: rotate(90deg);
}
</style>
