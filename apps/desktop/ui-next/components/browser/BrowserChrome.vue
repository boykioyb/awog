<template>
  <div class="bch">
    <!-- Hàng 1 — tab strip bên trái, nhóm nút "cửa sổ" bên phải. Nhóm phải là
         KHỐI CỐ ĐỊNH: strip co lại và cuộn ngang, nút không bao giờ bị bóp. -->
    <div class="bch-tabs">
      <div class="bch-tablist">
        <button
          v-for="tab in tabs"
          :key="tab.tabId"
          type="button"
          class="bch-tab"
          :class="{ on: tab.tabId === activeTabId }"
          :title="tab.url || tabLabel(tab)"
          @click="emit('select-tab', tab.tabId)"
        >
          <Icon
            v-if="tab.loading"
            name="refresh"
            class="bch-spin"
            style="width: var(--icon-xs); height: var(--icon-xs)"
          />
          <span class="bch-tabname">{{ tabLabel(tab) }}</span>
          <span class="x" @click.stop="emit('close-tab', tab.tabId)">×</span>
        </button>
        <button
          type="button"
          class="bch-act"
          :title="t('sessions.workspace.browser.newTab')"
          @click="emit('new-tab')"
        >
          <Icon name="plus" style="width: var(--icon-sm); height: var(--icon-sm)" />
        </button>
      </div>

      <div class="bch-grp">
        <!-- Split-view: đổi mép dock của view Browser (chỉ có nghĩa trong panel). -->
        <button
          v-if="isPanel"
          type="button"
          class="bch-act"
          :title="t('sessions.workspace.dock.change')"
          @click.stop="openDock"
        >
          <Icon :name="`dock-${dock}`" style="width: var(--icon-sm); height: var(--icon-sm)" />
        </button>
        <!-- ⋮ — sprite chỉ có bộ 3 chấm NGANG, quay 90° thành dọc. -->
        <button
          type="button"
          class="bch-act"
          :title="t('browser.menu.title')"
          @click.stop="openOverflow"
        >
          <Icon
            name="dots"
            class="bch-vdots"
            style="width: var(--icon-sm); height: var(--icon-sm)"
          />
        </button>
        <button
          v-if="isPanel"
          type="button"
          class="bch-act"
          :title="t('sessions.workspace.browser.popout')"
          @click="emit('popout')"
        >
          <Icon name="external" style="width: var(--icon-sm); height: var(--icon-sm)" />
        </button>
        <button
          v-if="isPanel"
          type="button"
          class="bch-act"
          :title="expanded ? t('browser.shrink') : t('browser.expand')"
          @click="emit('toggle-expand')"
        >
          <Icon
            :name="expanded ? 'fullscreen-exit' : 'fullscreen'"
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

    <!-- Hàng 2 — điều hướng + ô URL + hành động trên trang. Hai nhóm CỐ ĐỊNH kẹp
         một ô co giãn, và hàng được phép XUỐNG DÒNG: panel kéo được tới 240px, ở
         đó một hàng đơn bóp ô URL còn 41px (đo được) — một ô nhập không hiện được
         gì. Basis của ô URL vì thế là SỐ HỌC, xem comment ở .bch-url. -->
    <div class="bch-bar">
      <div class="bch-grp">
        <button
          type="button"
          class="bch-act"
          :disabled="!activeTab?.canGoBack"
          :title="t('sessions.workspace.browser.back')"
          @click="emit('back')"
        >
          <Icon name="chev-left" style="width: var(--icon-sm); height: var(--icon-sm)" />
        </button>
        <button
          type="button"
          class="bch-act"
          :disabled="!activeTab?.canGoForward"
          :title="t('sessions.workspace.browser.forward')"
          @click="emit('forward')"
        >
          <Icon name="chev-right" style="width: var(--icon-sm); height: var(--icon-sm)" />
        </button>
        <button
          type="button"
          class="bch-act"
          :title="t('sessions.workspace.browser.reload')"
          @click="emit('reload')"
        >
          <Icon name="refresh" style="width: var(--icon-sm); height: var(--icon-sm)" />
        </button>
      </div>

      <input
        v-model="url"
        class="bch-url"
        type="text"
        spellcheck="false"
        :placeholder="t('sessions.workspace.browser.urlPlaceholder')"
        @keydown.enter.prevent="emit('submit-url')"
      />

      <div class="bch-grp">
        <button
          type="button"
          class="bch-act"
          :class="{ on: currentPinned }"
          :disabled="!currentUrl"
          :title="
            currentPinned
              ? t('sessions.workspace.browser.unpin')
              : t('sessions.workspace.browser.pin')
          "
          @click="onTogglePin"
        >
          <Icon name="pin" style="width: var(--icon-sm); height: var(--icon-sm)" />
        </button>
        <button
          type="button"
          class="bch-act"
          :disabled="!currentUrl"
          :title="t('sessions.workspace.browser.copyUrl')"
          @click="onCopyUrl"
        >
          <Icon
            :name="copied ? 'check' : 'copy'"
            style="width: var(--icon-sm); height: var(--icon-sm)"
          />
        </button>
        <!-- Dịch phần người dùng bôi đen TRONG trang. Text lấy qua bridge (không
             phải selection của renderer) rồi đi đúng đường selection-to-translate. -->
        <button
          type="button"
          class="bch-act"
          :disabled="!hasSelection"
          :title="hasSelection ? t('translate.action') : t('browser.noSelection')"
          @click="onTranslate"
        >
          <Icon name="book" style="width: var(--icon-sm); height: var(--icon-sm)" />
        </button>
        <button
          type="button"
          class="bch-act"
          :disabled="!hasSelection"
          :title="hasSelection ? t('browser.quote') : t('browser.noSelection')"
          @click="browserCtx.quoteSelectionToChat()"
        >
          <Icon name="quote" style="width: var(--icon-sm); height: var(--icon-sm)" />
        </button>
        <button
          type="button"
          class="bch-act"
          :title="t('browser.pick')"
          @click="browserCtx.pickToChat()"
        >
          <Icon name="inspect" style="width: var(--icon-sm); height: var(--icon-sm)" />
        </button>
      </div>
    </div>

    <BrowserPinStrip :current-url="currentUrl" @open="emit('new-tab', $event)" />

    <BrowserTranslateStrip />

    <!-- Menu split-view: đổi mép dock của view Browser. -->
    <ContextMenu
      :open="dockAt !== null"
      :position="dockAt ?? { x: 0, y: 0 }"
      :items="dockItems"
      @close="dockAt = null"
      @select="onDockSelect"
    />
    <BrowserOverflowMenu
      :open="overflowAt !== null"
      :position="overflowAt ?? { x: 0, y: 0 }"
      :root="root"
      :tab-id="activeTabId"
      @close="overflowAt = null"
    />
  </div>
</template>

<script setup lang="ts">
// Chrome của trình duyệt nhúng (ADR 0086) — tab strip + URL bar + menu ⋮, DÙNG CHUNG
// cho hai bề mặt: view Browser của workspace panel và cửa sổ popout (pages/browser.vue).
//
// Component này KHÔNG giữ view native và không biết hình học của nó: chủ sở hữu
// (`useEmbeddedBrowser`) sống ở bề mặt, vì rect gắn với khung placeholder của bề mặt
// đó. Ở đây chỉ có (a) trạng thái tab/URL do bề mặt truyền vào + intent emit ra, và
// (b) những việc thuần "trình duyệt" tự lo được: ghim trang, copy URL, menu ⋮, dịch
// phần bôi đen, đẩy trang sang chat.
//
// i18n: chuỗi đã có sống ở `sessions.workspace.browser.*` (một key một chuỗi — không
// nhân bản sang browser.json); chỉ chuỗi MỚI của bản này nằm ở `browser.*`.
import type { AwogBrowserTab } from '~/types/awog-bridge'
import type { MenuItem } from '~/composables/useContextMenu'
import type { WorkspaceDockSide } from '~/stores/settings'
import { useBrowserContext } from '~/composables/useBrowserContext'
import { useBrowserPins } from '~/composables/useBrowserPins'
import { useSelectionTranslate } from '~/composables/useSelectionTranslate'
import { pushActionToast } from '~/composables/useActionToasts'

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
    dock?: WorkspaceDockSide
  }>(),
  {
    root: null,
    project: undefined,
    selectionText: '',
    surface: 'panel',
    expanded: false,
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
const translate = useSelectionTranslate()

const isPanel = computed(() => props.surface === 'panel')
const bridge = computed(() =>
  typeof window === 'undefined' ? null : (window.awog?.browser ?? null),
)
const activeTab = computed<AwogBrowserTab | null>(
  () => props.tabs.find((tab) => tab.tabId === props.activeTabId) ?? null,
)
const hasSelection = computed(() => !!props.selectionText?.trim())
// Tab trắng chưa có title/url: gọi nó là "New tab" thay vì phơi id nội bộ.
const tabLabel = (tab: AwogBrowserTab): string =>
  tab.title || tab.url || t('sessions.workspace.browser.newTab')

// ── Ghim + copy ─────────────────────────────────────────────────────────────

// Danh sách pin là state cấp module (localStorage), nên nút ghim ở đây và dải chip
// trong BrowserPinStrip nhìn cùng một sự thật.
const { isPinned, toggle } = useBrowserPins()

// URL đang TẢI THẬT, không phải `url` (ô nhập). Ghim và copy phải tác động lên
// trang đang trước mắt người dùng.
const currentUrl = computed(() => activeTab.value?.url ?? '')
const currentPinned = computed(() => isPinned(currentUrl.value))

const onTogglePin = (): void => {
  if (!currentUrl.value) return
  toggle({ url: currentUrl.value, title: activeTab.value?.title ?? '' })
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

// ── Trang → chat / bản dịch ─────────────────────────────────────────────────

const fail = (err: unknown): void => {
  pushActionToast(
    t('browser.toast.failed', { message: err instanceof Error ? err.message : String(err) }),
    'error',
  )
}

const onTranslate = async (ev: MouseEvent): Promise<void> => {
  const api = bridge.value
  // Rect phải đo TRƯỚC await: currentTarget bị xoá khi event kết thúc dispatch.
  const rect = (ev.currentTarget as HTMLElement).getBoundingClientRect()
  if (!api) return
  try {
    const sel = await api.selection(props.activeTabId ?? undefined)
    const text = sel.text.trim()
    if (!text) return
    // Nguồn 'browser': kết quả render trong chrome (BrowserTranslateStrip), KHÔNG
    // phải popover nổi — popover sẽ nằm dưới view native, và cách duy nhất để
    // thấy nó là ẩn trang đi, đúng thứ phá việc đang làm.
    translate.open(text, rect, props.project, 'browser')
  } catch (err) {
    fail(err)
  }
}

// Trang → chat: chọn một element, hoặc trích đoạn đang bôi đen. Cả hai đều thuộc
// `useBrowserContext` (nó sở hữu định dạng khối context + draft của session) và tự
// báo lỗi bằng toast, nên ở đây chỉ còn việc bind.
const browserCtx = useBrowserContext()

// ── Menu (⋮ và split-view) ──────────────────────────────────────────────────

// Rộng xấp xỉ của .smenu — chỉ dùng để căn phải dưới nút; ContextMenu tự kẹp lại
// vào trong viewport sau khi đo thật.
const MENU_W = 216
const anchorOf = (ev: MouseEvent): { x: number; y: number } => {
  const r = (ev.currentTarget as HTMLElement).getBoundingClientRect()
  return { x: Math.max(8, r.right - MENU_W), y: r.bottom + 4 }
}

const overflowAt = ref<{ x: number; y: number } | null>(null)
const dockAt = ref<{ x: number; y: number } | null>(null)
const openOverflow = (ev: MouseEvent): void => {
  overflowAt.value = anchorOf(ev)
}
const openDock = (ev: MouseEvent): void => {
  dockAt.value = anchorOf(ev)
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
    active: opt.side === props.dock,
  })),
)
const onDockSelect = (id: string): void => {
  emit('set-dock', id as WorkspaceDockSide)
}
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
.bch-tablist {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 4px;
  overflow-x: auto;
}
/* Tab đang chọn = accent-tint (không nền xám đặc — quy ước segmented control). */
.bch-tab {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 6px;
  max-width: 180px;
  padding: 4px 8px;
  border-radius: var(--r-sm);
  background: transparent;
  border: 1px solid transparent;
  color: var(--textDim);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  cursor: pointer;
}
.bch-tab:hover {
  background: var(--bgHover);
  color: var(--text);
}
.bch-tab.on {
  background: var(--accentDim);
  border-color: var(--accentBorder);
  color: var(--text);
}
.bch-tabname {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.bch-tab .x {
  opacity: 0;
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
}
.bch-tab:hover .x {
  opacity: 0.7;
}
.bch-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
  padding: 6px 8px;
  box-shadow: inset 0 -1px 0 var(--border);
}
/* Hai nhóm đi thành KHỐI, nên panel hẹp đẩy cả nhóm xuống dòng dưới thay vì gọt
   mỗi nút một pixel. */
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
.bch-act:disabled {
  opacity: 0.35;
  cursor: default;
}
/* Đã ghim = accent-tint, đúng quy ước selection (không fill xám). */
.bch-act.on {
  background: var(--accentDim);
  color: var(--accent);
}
.bch-vdots {
  transform: rotate(90deg);
}
.bch-url {
  /* Basis CHÍNH LÀ ngưỡng xuống dòng, nên nó là số học chứ không phải khẩu vị:
     hàng còn một dòng khi nav (74) + basis + actions (126) + gap (8) + padding
     (16) ≤ bề rộng panel. 5 nút hành động (pin · copy · dịch · trích · chọn phần
     tử) làm nhóm phải nặng thêm 30px so với bản 4 nút, nên basis tụt 110 → 96 để
     panel mặc định 322px VẪN một dòng (322 − 224 = 98 ≥ 96); dưới ~320px nhóm
     hành động xuống dòng riêng, chỗ mà ô URL lẽ ra bị bóp còn 41px. */
  flex: 1 1 96px;
  min-width: 0;
  padding: 4px 10px;
  border-radius: var(--r-btn);
  background: var(--bgInput);
  border: 1px solid var(--border);
  color: var(--text);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
}
.bch-url:focus {
  outline: none;
  border-color: var(--accentBorder);
}
.bch-spin {
  animation: bch-spin 1s linear infinite;
}
@keyframes bch-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
