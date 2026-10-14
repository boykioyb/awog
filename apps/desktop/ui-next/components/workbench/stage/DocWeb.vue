<template>
  <!-- Doc 'web' — tab trình duyệt embed (WebContentsView) gắn vào stage.
       Tái dùng nguyên useEmbeddedBrowser + BrowserNavBar (thanh bookmark nằm trong NavBar):
       `scope` undefined = pool global của workbench (cũng là nơi link "Mở trong
       AWOG" và PR từ explorer đổ vào), `pinnedTabId` khóa đúng tab mà doc này
       đại diện — đổi doc không bị con trỏ active của scope kéo trang đi. -->
  <div class="flex min-h-0 flex-1 flex-col">
    <div
      v-if="!available"
      class="grid min-h-0 flex-1 place-items-center text-sm text-[var(--textFaint)]"
    >
      {{ t('workbench.unavailable') }}
    </div>
    <template v-else>
      <BrowserNavBar
        v-model:url="urlDraft"
        :tab="tab"
        :tab-id="doc.browId ?? null"
        :selection-text="selectionText"
        surface="main"
        :can-expand="false"
        @back="back"
        @forward="forward"
        @reload="reload"
        @submit-url="submitUrl"
        @popout="popout"
        @set-dock="noop"
        @toggle-expand="noop"
        @open-url="onOpenUrl"
      />
      <div
        ref="viewportEl"
        class="relative flex min-h-0 flex-1 items-center justify-center bg-[var(--bg)]"
      >
        <img
          v-if="frozen"
          :src="frozen"
          alt=""
          class="pointer-events-none absolute inset-0 h-full w-full object-fill"
        />
        <div
          v-if="tabGone"
          class="absolute inset-0 grid place-items-center text-sm text-[var(--textFaint)]"
        >
          {{ t('workbench.web.tabGone') }}
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import type { WorkbenchDoc } from '~/types/workbench'
import { useWorkbenchDocs } from '~/composables/useWorkbenchDocs'
import { useEmbeddedBrowser } from '~/composables/useEmbeddedBrowser'
import BrowserNavBar from '~/components/browser/BrowserNavBar.vue'

const props = defineProps<{ doc: WorkbenchDoc }>()

const { t } = useI18n()
const wbDocs = useWorkbenchDocs()

// Viewport element của bề mặt này — mỗi DocWeb một ref riêng (composable là
// per-instance: giữ nhiều surface sống song song, owner arbitration ở main).
const viewportEl = useTemplateRef<HTMLElement>('viewportEl')

const {
  available,
  tabs,
  urlDraft,
  frozen,
  selectionText,
  submitUrl,
  back,
  forward,
  reload,
  popout,
} = useEmbeddedBrowser({
  viewport: viewportEl,
  // Doc web chỉ mounted khi là doc active (component:is + KeepAlive) —
  // isConnected + box ≥ 8px trong composable đã đủ gate attach/detach.
  visible: () => true,
  // Pool global: tab "Mở trong AWOG" + link PR từ explorer.
  scope: () => undefined,
  // Ghim đúng tab mà doc đại diện — KHÔNG bám theo activeTabId của pool,
  // nếu không mở doc web khác sẽ cướp trang của doc này.
  pinnedTabId: () => props.doc.browId ?? null,
})

const tab = computed(() => tabs.value.find((x) => x.tabId === props.doc.browId) ?? null)

// Tab native biến mất (agent đóng, user đóng trong popout) → đóng doc luôn,
// trừ khi chưa bao giờ thấy nó trong list (race lúc list chưa tải) — trường
// hợp đó chỉ hiện thông báo "tab không còn" sau khi đã probe.
const probed = ref(false)
const seen = ref(false)
const tabGone = computed(() => probed.value && !tab.value)
watch(
  () => !!tab.value,
  (has) => {
    if (has) {
      seen.value = true
      return
    }
    if (seen.value || probed.value) void wbDocs.requestCloseDoc(props.doc)
  },
  { immediate: true },
)
onMounted(() => {
  window.setTimeout(() => {
    probed.value = true
  }, 800)
})

// Tiêu đề doc theo title/url thật của tab — cùng hướng cập nhật với applyList.
watch(
  () => [tab.value?.title, tab.value?.url],
  () => {
    if (!tab.value) return
    const label = tab.value.title || tab.value.url || t('workbench.web.newTab')
    if (props.doc.title !== label) wbDocs.updateDocMeta(props.doc, { title: label })
  },
  { immediate: true },
)

const noop = () => {}

// Bookmark: 'new' mở doc web mới (tab thuộc pool global), 'current' điều hướng doc này.
const onOpenUrl = (url: string, mode: 'current' | 'new'): void => {
  if (mode === 'new') {
    void wbDocs.openNewWebDoc(url)
    return
  }
  urlDraft.value = url
  void submitUrl()
}
</script>
