<template>
  <div
    ref="scrollEl"
    class="cap-table"
    tabindex="0"
    role="grid"
    :aria-rowcount="rows.length"
    @scroll.passive="onScroll"
    @keydown="onKey"
  >
    <div class="cap-thead cap-grid" role="row">
      <button
        v-for="c in COLUMNS"
        :key="c.key"
        type="button"
        class="cap-th"
        :class="[c.cls, { num: c.num }]"
        role="columnheader"
        @click="cap.setSort(c.key)"
      >
        {{ t(`capture.col.${c.key}`) }}
        <span v-if="cap.sort.value.key === c.key" class="cap-caret" aria-hidden="true">
          {{ cap.sort.value.dir === 'asc' ? '▲' : '▼' }}
        </span>
      </button>
    </div>

    <div v-if="rows.length === 0" class="cap-empty">
      {{ cap.total.value === 0 ? t('capture.empty.none') : t('capture.empty.filtered') }}
    </div>

    <div v-else class="cap-body" :style="{ height: `${rows.length * ROW_H}px` }">
      <div class="cap-slice" :style="{ transform: `translateY(${start * ROW_H}px)` }">
        <div
          v-for="r in slice"
          :key="r.id"
          class="cap-row-r cap-grid"
          :class="[
            statusClass(r),
            { sel: r.id === cap.selectedId.value, pending: r.state === 'pending' },
          ]"
          role="row"
          @click="cap.select(r.id)"
        >
          <span class="num tnum cap-dim">{{ r.seq }}</span>
          <span class="cap-meth">{{ r.method }}</span>
          <span class="cap-st tnum" :title="r.error || r.blockedReason || r.statusText">
            {{ statusLabel(r) }}
          </span>
          <span class="cap-cut" :title="r.host">{{ r.host }}</span>
          <span class="cap-cut cap-code" :title="r.url">{{ r.path }}</span>
          <span class="cap-cut cap-dim">{{ r.resourceType }}</span>
          <span class="num tnum cap-dim">{{ sizeLabel(r) }}</span>
          <span class="num tnum cap-dim">{{ timeLabel(r) }}</span>
          <span class="num tnum cap-dim">{{ clock(r.startedAt) }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
// Bảng request ảo hoá: chỉ dựng cửa sổ dòng đang nhìn thấy (+ đệm) trên một thân cao
// cố định, nên 5000 dòng vẫn cuộn mượt. Chiều cao dòng là SỐ cố định vì việc tính
// cửa sổ cần nó — giữ khớp với `.cap-row-r` trong network-capture.vue.
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { CaptureSummary } from '~/types/network-capture'
import type { CaptureSortKey } from '~/utils/capture-filter'
import { useNetworkCaptureContext } from '~/composables/useNetworkCapture'
import { formatBytes } from '~/utils/format-bytes'

const ROW_H = 24
const OVERSCAN = 8

type Column = { key: CaptureSortKey; cls: string; num: boolean }
const COLUMNS: Column[] = [
  { key: 'seq', cls: '', num: true },
  { key: 'method', cls: '', num: false },
  { key: 'status', cls: '', num: false },
  { key: 'host', cls: '', num: false },
  { key: 'path', cls: '', num: false },
  { key: 'type', cls: '', num: false },
  { key: 'size', cls: '', num: true },
  { key: 'time', cls: '', num: true },
  { key: 'started', cls: '', num: true },
]

const { t } = useI18n()
const cap = useNetworkCaptureContext()
const rows = computed(() => cap.rows.value)

const scrollEl = ref<HTMLElement | null>(null)
const scrollTop = ref(0)
const viewH = ref(400)

const start = computed(() => Math.max(0, Math.floor(scrollTop.value / ROW_H) - OVERSCAN))
const end = computed(() =>
  Math.min(rows.value.length, Math.ceil((scrollTop.value + viewH.value) / ROW_H) + OVERSCAN),
)
const slice = computed(() => rows.value.slice(start.value, end.value))

const onScroll = (): void => {
  scrollTop.value = scrollEl.value?.scrollTop ?? 0
}

let ro: ResizeObserver | null = null
onMounted(() => {
  const el = scrollEl.value
  if (!el) return
  viewH.value = el.clientHeight
  ro = new ResizeObserver(() => {
    viewH.value = el.clientHeight
  })
  ro.observe(el)
})
onBeforeUnmount(() => ro?.disconnect())

// Đang nằm sát đáy (kiểu `tail -f`) thì dòng mới kéo theo; cuộn lên rồi thì đứng yên.
let stickBottom = true
watch(
  () => rows.value.length,
  async () => {
    const el = scrollEl.value
    if (!el || cap.sort.value.key !== 'seq' || cap.sort.value.dir !== 'asc') return
    stickBottom = el.scrollHeight - el.scrollTop - el.clientHeight < ROW_H * 2
    await nextTick()
    if (stickBottom && cap.selectedId.value === null) el.scrollTop = el.scrollHeight
  },
)

// Chọn bằng phím / từ Findings → cuộn dòng vào vùng nhìn thấy (trừ hàng tiêu đề sticky).
watch(
  () => cap.selectedId.value,
  async (id) => {
    const el = scrollEl.value
    if (!el || !id) return
    const i = rows.value.findIndex((r) => r.id === id)
    if (i < 0) return
    await nextTick()
    const head = ROW_H
    const top = i * ROW_H
    if (top < el.scrollTop) el.scrollTop = top
    else if (top + ROW_H > el.scrollTop + el.clientHeight - head) {
      el.scrollTop = top + ROW_H - el.clientHeight + head
    }
  },
)

function onKey(ev: KeyboardEvent): void {
  if (ev.key === 'ArrowDown') cap.moveSelection(1)
  else if (ev.key === 'ArrowUp') cap.moveSelection(-1)
  else if (ev.key === 'PageDown') cap.moveSelection(Math.floor(viewH.value / ROW_H))
  else if (ev.key === 'PageUp') cap.moveSelection(-Math.floor(viewH.value / ROW_H))
  else return
  ev.preventDefault()
}

function statusClass(r: CaptureSummary): string {
  if (r.state === 'failed') return 'st-failed'
  if (r.status === null) return ''
  if (r.status >= 500) return 'st-5xx'
  if (r.status >= 400) return 'st-4xx'
  if (r.status >= 300) return 'st-3xx'
  return 'st-2xx'
}
const statusLabel = (r: CaptureSummary): string =>
  r.state === 'failed' ? t('capture.status.failed') : r.status === null ? '…' : String(r.status)
const sizeLabel = (r: CaptureSummary): string =>
  r.encodedBytes === null ? '—' : formatBytes(r.encodedBytes)
const timeLabel = (r: CaptureSummary): string =>
  r.durationMs === null
    ? '—'
    : r.durationMs < 1000
      ? `${Math.round(r.durationMs)} ms`
      : `${(r.durationMs / 1000).toFixed(2)} s`
const clock = (ms: number): string =>
  new Date(ms).toLocaleTimeString([], { hour12: false }) +
  `.${String(Math.floor(ms) % 1000).padStart(3, '0')}`
</script>
