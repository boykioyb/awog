<template>
  <div class="cap-root">
    <div v-if="!cap.available.value" class="cap-empty cap-center">
      {{ t('capture.unavailable') }}
    </div>

    <template v-else>
      <div class="cap-views">
        <Tabs v-model="cap.view.value">
          <TabsList class="h-9 justify-start gap-0.5 rounded-none bg-transparent p-0">
            <TabsTrigger
              v-for="v in VIEWS"
              :key="v"
              :value="v"
              class="h-9 gap-1.5 rounded-none border-b-2 border-transparent px-3 text-xs text-muted-foreground data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:shadow-none"
            >
              {{ t(`capture.view.${v}`) }}
              <Badge v-if="badge(v) > 0" variant="secondary" class="tnum px-1.5 py-0">
                {{ badge(v) }}
              </Badge>
            </TabsTrigger>
          </TabsList>
        </Tabs>
        <span class="cap-grow" />
        <span class="cap-privacy" :title="t('capture.privacyHint')">
          <Icon name="lock" class="cap-ic" />
          {{ t('capture.privacy') }}
        </span>
      </div>

      <template v-if="cap.view.value === 'requests'">
        <CaptureToolbar />
        <div ref="splitEl" class="cap-split">
          <CaptureTable class="cap-main" />
          <template v-if="cap.selectedId.value">
            <div
              class="cap-resizer"
              role="separator"
              aria-orientation="vertical"
              tabindex="0"
              :title="t('capture.resize')"
              @pointerdown="startResize"
              @keydown.left.prevent="nudge(24)"
              @keydown.right.prevent="nudge(-24)"
            />
            <CaptureDetail :style="{ flex: `0 0 ${detailW}px` }" />
          </template>
        </div>
      </template>
      <CaptureRepeater v-else-if="cap.view.value === 'repeater'" />
      <CaptureFindings v-else-if="cap.view.value === 'findings'" />
      <CapturePentest v-else />
    </template>

    <!-- Host cho useConfirm() — trang này layout:false nên AppGlobalHosts của
         layout mặc định không chạy tới (confirm() treo nếu thiếu host). -->
    <ConfirmDialogHost />
  </div>
</template>

<script setup lang="ts">
// Cửa sổ Network Capture (docs/features/network-capture.md) — route SPA mà cửa sổ
// inspector của trình duyệt nhúng load: `network-capture?tabId=<id>&scope=<scope>`.
// Không có app chrome. State nằm hết ở `useNetworkCapture`; các component con lấy
// controller qua provide/inject nên template ở đây chỉ còn bố cục.
import { onMounted, provide, ref } from 'vue'
import CaptureDetail from '~/components/capture/CaptureDetail.vue'
import CaptureFindings from '~/components/capture/CaptureFindings.vue'
import CapturePentest from '~/components/capture/CapturePentest.vue'
import CaptureRepeater from '~/components/capture/CaptureRepeater.vue'
import CaptureTable from '~/components/capture/CaptureTable.vue'
import CaptureToolbar from '~/components/capture/CaptureToolbar.vue'
import ConfirmDialogHost from '~/components/common/ConfirmDialogHost.vue'
import {
  NETWORK_CAPTURE_KEY,
  useNetworkCapture,
  type CaptureView,
} from '~/composables/useNetworkCapture'

definePageMeta({ layout: false, keepalive: false })
defineOptions({ name: 'NetworkCapturePage' })

const VIEWS: CaptureView[] = ['requests', 'repeater', 'findings', 'security']
const DETAIL_MIN = 320
const TABLE_MIN = 240
const STORAGE_KEY = 'awog.captureDetailWidth'

const { t } = useI18n()
const cap = useNetworkCapture()
provide(NETWORK_CAPTURE_KEY, cap)
// Title của cửa sổ inspector: app.head đặt "AWOG" cho mọi trang nên tiêu đề main đặt
// lúc mở cửa sổ bị ghi đè — đặt lại theo host của tab để phân biệt nhiều cửa sổ.
useHead({
  title: computed(() =>
    cap.pageHost.value ? t('capture.windowTitle', { host: cap.pageHost.value }) : 'Network',
  ),
})

const badge = (v: CaptureView): number =>
  v === 'requests'
    ? cap.total.value
    : v === 'repeater'
      ? cap.repeaterHistory.value.length
      : cap.findings.value.length

// ── Thanh kéo đổi bề rộng pane chi tiết ──────────────────────────────────────
const splitEl = ref<HTMLElement | null>(null)
const detailW = ref(520)

onMounted(() => {
  const saved = Number(localStorage.getItem(STORAGE_KEY))
  if (Number.isFinite(saved) && saved >= DETAIL_MIN) detailW.value = saved
})

function setWidth(w: number): void {
  const room = splitEl.value?.clientWidth ?? 1200
  detailW.value = Math.round(
    Math.min(Math.max(w, DETAIL_MIN), Math.max(DETAIL_MIN, room - TABLE_MIN)),
  )
  localStorage.setItem(STORAGE_KEY, String(detailW.value))
}
const nudge = (delta: number): void => setWidth(detailW.value + delta)

function startResize(ev: PointerEvent): void {
  const el = ev.currentTarget as HTMLElement
  el.setPointerCapture(ev.pointerId)
  const move = (e: PointerEvent): void => {
    const box = splitEl.value?.getBoundingClientRect()
    if (box) setWidth(box.right - e.clientX)
  }
  const up = (): void => {
    el.releasePointerCapture(ev.pointerId)
    el.removeEventListener('pointermove', move)
    el.removeEventListener('pointerup', up)
  }
  el.addEventListener('pointermove', move)
  el.addEventListener('pointerup', up)
}
</script>

<style>
/* Style dùng chung cho cây component `components/capture/*` — prefix `cap-` để không rò ra nơi
   khác. Cố ý KHÔNG scoped: bố cục/bảng/vùng đọc body dùng chung giữa nhiều component con. Nút,
   input, tab, badge dùng bộ shadcn (`components/ui/*`); `.cap-on` chỉ thêm accent-tint cho toggle. */
.cap-root {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: var(--bg);
  color: var(--text);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  overflow: hidden;
}
.cap-root *,
.cap-root *::before,
.cap-root *::after {
  box-sizing: border-box;
}
.cap-code {
  /* mono-ok: header, URL, cookie, body, JWT — nội dung người dùng copy-paste */
  font-family: var(--code);
}
.cap-dim {
  color: var(--textDim);
}
.cap-warn {
  color: var(--danger);
}
.cap-grow {
  flex: 1 1 auto;
}
.cap-cut {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}
.cap-wrap {
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}
.cap-ic {
  width: var(--icon-xs);
  height: var(--icon-xs);
  flex: none;
}
.cap-center {
  margin: auto;
}
.cap-empty {
  padding: 24px;
  text-align: center;
  color: var(--textDim);
}
.cap-note {
  padding: 6px 10px;
  color: var(--textDim);
}
.cap-note.warn {
  color: var(--amber);
}
.cap-note.bad {
  color: var(--danger);
  overflow-wrap: anywhere;
}

/* ── thanh view + hàng bố cục dùng chung ── */
.cap-views {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 0 8px;
  height: 36px;
  flex: none;
  box-shadow: inset 0 -1px 0 var(--border);
}
.cap-privacy {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--textDim);
}
.cap-row,
.cap-bar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
}
.cap-bar {
  padding: 6px 8px;
}
/* Trạng thái bật của Button outline (toggle, chip lọc, chế độ xem): accent-tint theo quy tắc
   selection của dự án — KHÔNG nền xám. Specificity 0,2,0+ để thắng hover của Button. */
.cap-root .cap-on,
.cap-root .cap-on:hover {
  background: var(--accentDim);
  border-color: var(--accentBorder);
  color: var(--text);
}
.cap-root .cap-on.st-2xx {
  color: var(--green);
}
.cap-root .cap-on.st-3xx {
  color: var(--blue);
}
.cap-root .cap-on.st-4xx {
  color: var(--amber);
}
.cap-root .cap-on.st-5xx,
.cap-root .cap-on.st-failed {
  color: var(--danger);
}

/* ── bảng request ── */
.cap-split {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
}
.cap-main {
  flex: 1 1 auto;
  min-width: 0;
}
.cap-table {
  position: relative;
  overflow: auto;
  outline: 0;
}
.cap-grid {
  display: grid;
  grid-template-columns: 52px 64px 64px minmax(110px, 1fr) minmax(160px, 2fr) 84px 76px 76px 96px;
  align-items: center;
  column-gap: 8px;
  min-width: 800px;
  padding: 0 8px;
}
.cap-thead {
  position: sticky;
  top: 0;
  z-index: 2;
  height: 24px;
  background: var(--bgPanel);
  box-shadow: inset 0 -1px 0 var(--border);
}
.cap-th {
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--textMuted);
  text-align: left;
  cursor: pointer;
  font: inherit;
  white-space: nowrap;
}
.cap-th.num,
.cap-grid .num {
  text-align: right;
}
.cap-th:hover {
  color: var(--text);
}
.cap-caret {
  font-size: var(--fs-xs);
}
.cap-body {
  position: relative;
}
.cap-slice {
  position: absolute;
  inset: 0 0 auto 0;
  min-width: 800px;
}
.cap-row-r {
  height: 24px;
  line-height: var(--lh-sm);
  cursor: default;
  box-shadow: inset 0 -1px 0 var(--border);
}
.cap-row-r:hover {
  background: var(--bgHover);
}
.cap-row-r.sel {
  background: var(--accentDim);
  box-shadow:
    inset 2px 0 0 var(--accent),
    inset 0 -1px 0 var(--border);
}
.cap-row-r.pending {
  color: var(--textDim);
}
.cap-meth {
  font-weight: 600;
}
.cap-st.tnum,
.cap-st {
  font-variant-numeric: tabular-nums;
}
.st-2xx .cap-st,
.cap-st.st-2xx {
  color: var(--green);
}
.st-3xx .cap-st,
.cap-st.st-3xx {
  color: var(--blue);
}
.st-4xx .cap-st,
.cap-st.st-4xx {
  color: var(--amber);
}
.st-5xx .cap-st,
.st-failed .cap-st,
.cap-st.st-5xx,
.cap-st.st-failed {
  color: var(--danger);
}

/* ── pane chi tiết ── */
.cap-resizer {
  flex: none;
  width: 5px;
  cursor: col-resize;
  background: var(--border);
  outline: 0;
}
.cap-resizer:hover,
.cap-resizer:focus-visible {
  background: var(--accentBorder);
}
.cap-detail {
  display: flex;
  flex-direction: column;
  min-width: 0;
  background: var(--bgPanel);
}
.cap-dhead {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  box-shadow: inset 0 -1px 0 var(--border);
}
.cap-dhead .cap-cut {
  flex: 1;
}
.cap-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  padding: 6px 8px;
}
.cap-tabbody {
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
}
.cap-tab {
  display: flex;
  flex-direction: column;
  padding-bottom: 12px;
}
.cap-sec {
  padding: 8px;
}
.cap-sec h4 {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 0 6px;
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  font-weight: 600;
  color: var(--textMuted);
}
.cap-sub {
  margin: 8px 0 2px;
  color: var(--textDim);
}
.cap-kv {
  width: 100%;
  border-collapse: collapse;
  table-layout: auto;
}
.cap-kv th,
.cap-kv td {
  padding: 2px 8px 2px 0;
  vertical-align: top;
  text-align: left;
  font-weight: 400;
  box-shadow: inset 0 -1px 0 var(--border);
}
.cap-kv th {
  color: var(--textMuted);
  white-space: nowrap;
  width: 1%;
}
.cap-kv thead th {
  color: var(--textDim);
}
.cap-scroll-x {
  overflow-x: auto;
}
.cap-cookies td,
.cap-cookies th {
  padding-right: 12px;
}
.cap-cookies td {
  min-width: 8ch;
}
.cap-pre {
  margin: 0;
  padding: 6px 8px;
  max-height: 60vh;
  overflow: auto;
  border-radius: var(--r-xs);
  background: var(--bgSubtle);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.cap-img {
  max-width: 100%;
  max-height: 60vh;
  align-self: flex-start;
  image-rendering: pixelated;
  background: var(--bgSubtle);
  border-radius: var(--r-xs);
}
.cap-body-view {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
/* ── repeater ── */
.cap-repeater {
  flex: 1 1 auto;
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
}
.cap-rep-col {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  overflow: auto;
}
.cap-rep-col + .cap-rep-col {
  box-shadow: inset 1px 0 0 var(--border);
}

/* ── findings ── */
.cap-findings {
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
}
</style>
