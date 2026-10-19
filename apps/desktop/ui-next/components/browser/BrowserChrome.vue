<template>
  <div class="flex shrink-0 flex-col">
    <!-- Hàng 1 — tab strip bên trái, nhóm nút "cửa sổ" bên phải. Nhóm phải là
         KHỐI CỐ ĐỊNH: strip co lại và cuộn ngang, nút không bao giờ bị bóp.
         Hairline dưới bằng inset shadow (không border) để không ăn 1px chiều cao. -->
    <div class="flex items-center gap-1.5 px-2 py-1.5 shadow-[inset_0_-1px_0_var(--color-border)]">
      <BrowserTabs
        :tabs="tabs"
        :active-tab-id="activeTabId"
        @select-tab="emit('select-tab', $event)"
        @close-tab="emit('close-tab', $event)"
        @new-tab="emit('new-tab')"
        @tab-menu="emit('tab-menu', $event)"
      />

      <!-- Nhóm cửa sổ còn ĐÚNG HAI nút (session-ui-refactor §3.6). Dock · popout ·
           phóng to đã chuyển xuống menu `⋯` ở hàng dưới: đây là panel rộng 322px,
           trước đó 15 nút chen nhau tới mức thanh phải xuống dòng. -->
      <div class="flex flex-none items-center gap-1">
        <!-- ⋮ — sprite chỉ có bộ 3 chấm NGANG, quay 90° thành dọc. Nút ở đây nhưng
             menu render trong NavBar (giữ cùng chỗ với hai menu kia) → gọi qua
             ref, forward nguyên MouseEvent để neo đúng vị trí nút. -->
        <Button
          variant="ghost"
          size="iconSm"
          class="text-muted-foreground"
          :title="t('browser.menu.title')"
          :aria-label="t('browser.menu.title')"
          @pointerenter="prefetchBrowserFrame"
          @pointerdown="prefetchBrowserFrame"
          @click.stop="navBarEl?.openOverflow($event)"
        >
          <Icon name="dots" class="rotate-90" />
        </Button>
        <Button
          variant="ghost"
          size="iconSm"
          class="text-muted-foreground"
          :title="isPanel ? t('browser.close') : t('browser.closeWindow')"
          :aria-label="isPanel ? t('browser.close') : t('browser.closeWindow')"
          @click="emit('close')"
        >
          <Icon name="x" />
        </Button>
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
      :scope="scope"
      @back="emit('back')"
      @forward="emit('forward')"
      @reload="emit('reload')"
      @submit-url="emit('submit-url')"
      @popout="emit('popout')"
      @set-dock="emit('set-dock', $event)"
      @toggle-expand="emit('toggle-expand')"
      @open-url="onOpenUrl"
    />

    <BrowserTranslateStrip />
  </div>
</template>

<script setup lang="ts">
// Chrome của trình duyệt nhúng (ADR 0086) — GHÉP MẢNG, không còn chi tiết:
//   BrowserTabs     — hàng tab + nút "+" (emit intent lên)
//   BrowserNavBar   — nav + ô URL + ⋯ + cả ba menu (overflow/dock/actions)
//   BrowserTranslateStrip — dải phụ dưới chrome (thanh bookmark nằm trong NavBar)
// DÙNG CHUNG cho hai bề mặt qua `surface`: view Browser của workspace panel và
// cửa sổ popout (pages/browser.vue).
//
// Component này KHÔNG giữ view native và không biết hình học của nó: chủ sở hữu
// (`useEmbeddedBrowser`) sống ở bề mặt, vì rect gắn với khung placeholder của bề
// mặt đó. Hợp đồng props/emits giữ nguyên như trước refactor — hai bề mặt không
// cần đổi gì.
import type { AwogBrowserTab } from '~/types/awog-bridge'
import type { WorkspaceDockSide } from '~/stores/settings'
import { prefetchBrowserFrame } from '~/composables/useEmbeddedBrowser'

// 'panel' = view của workspace panel (có dock/expand/popout), 'window' = cửa sổ
// popout (những nút đó vô nghĩa: OS lo, và nó đã ở cửa sổ riêng rồi),
// 'main' = tab trình duyệt trên main strip của session (session-main-tabs):
// không dock/expand (nó KHÔNG nằm trong dock) nhưng vẫn có PiP/popout.
export type BrowserChromeSurface = 'panel' | 'window' | 'main'

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
    // Scope sở hữu bề mặt (engineId phiên; vắng = pool global) — để thanh bookmark và
    // hồ sơ đúng ngay cả khi CHƯA có tab nào.
    scope?: string
  }>(),
  {
    root: null,
    project: undefined,
    selectionText: '',
    surface: 'panel',
    expanded: false,
    canExpand: true,
    dock: 'right',
    scope: undefined,
  },
)

const emit = defineEmits<{
  'select-tab': [tabId: string]
  'close-tab': [tabId: string]
  'new-tab': [url?: string]
  // Chuột phải trên tab của strip — forward lên bề mặt chứa (WorkspaceBrowser /
  // popout), nơi useBrowserTabMenu + AppContextMenu sống.
  'tab-menu': [payload: { tab: AwogBrowserTab; ev: MouseEvent }]
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
// Bookmark bấm từ thanh / ☆ / menu: 'new' = tab mới (agent sở hữu tab nên không bao giờ
// "quay lại tab cũ"); 'current' = điều hướng tab đang xem qua đúng đường gõ URL.
const onOpenUrl = (target: string, mode: 'current' | 'new'): void => {
  if (mode === 'new') {
    emit('new-tab', target)
    return
  }
  url.value = target
  emit('submit-url')
}

// Nút ⋮ ở hàng 1 nhưng menu ⋮ sống trong NavBar (giữ cùng chỗ với menu dock +
// menu ⋯): chrome gọi `openOverflow` qua ref, forward nguyên MouseEvent để menu
// neo đúng mép nút.
const navBarEl = useTemplateRef<{ openOverflow: (ev: MouseEvent) => void }>('navBarEl')
</script>
