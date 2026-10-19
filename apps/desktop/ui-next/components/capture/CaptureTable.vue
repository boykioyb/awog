<template>
  <!-- Vùng cuộn ngoài là thứ được ảo hoá (scrollTop/clientHeight); container của Table bỏ
       overflow để header sticky bám đúng vùng cuộn này. Hàng cố định ROW_H = 24px (h-6) —
       giữ khớp hằng số trong script. Hairline của ô vẽ bằng inset shadow để không cộng
       thêm chiều cao vào bước nhảy 24px của cửa sổ ảo. -->
  <div
    ref="scrollEl"
    class="relative overflow-auto outline-0 [&_[data-slot=table-container]]:overflow-visible"
    tabindex="0"
    role="grid"
    :aria-rowcount="rows.length"
    @scroll.passive="onScroll"
    @keydown="onKey"
  >
    <Table
      class="min-w-200 table-fixed [&_td]:h-6 [&_td]:px-1 [&_td]:py-0 [&_td]:whitespace-nowrap [&_td]:shadow-[inset_0_-1px_0_var(--color-border)] [&_td:first-child]:pl-2 [&_td:last-child]:pr-2 [&_th]:px-1 [&_th:first-child]:pl-2 [&_th:last-child]:pr-2 [&_tr]:border-b-0"
    >
      <colgroup>
        <col class="w-13" />
        <col class="w-16" />
        <col class="w-16" />
        <col class="w-[12%]" />
        <col />
        <col class="w-21" />
        <col class="w-19" />
        <col class="w-19" />
        <col class="w-24" />
      </colgroup>
      <TableHeader class="sticky top-0 z-2 bg-sidebar shadow-[inset_0_-1px_0_var(--color-border)]">
        <TableRow class="hover:bg-transparent">
          <TableHead v-for="c in COLUMNS" :key="c.key" class="h-6" role="columnheader">
            <Button
              variant="ghost"
              size="xs"
              class="h-6 w-full rounded-none px-0 font-normal text-muted-foreground hover:bg-transparent hover:text-foreground"
              :class="c.num ? 'justify-end' : 'justify-start'"
              @click="cap.setSort(c.key)"
            >
              {{ t(`capture.col.${c.key}`) }}
              <span v-if="cap.sort.value.key === c.key" class="text-xs" aria-hidden="true">
                {{ cap.sort.value.dir === 'asc' ? '▲' : '▼' }}
              </span>
            </Button>
          </TableHead>
        </TableRow>
      </TableHeader>

      <TableBody>
        <TableRow v-if="rows.length === 0" class="hover:bg-transparent">
          <TableCell
            :colspan="COLUMNS.length"
            class="h-auto! p-6! text-center whitespace-normal! text-dim"
          >
            {{ cap.total.value === 0 ? t('capture.empty.none') : t('capture.empty.filtered') }}
          </TableCell>
        </TableRow>

        <template v-else>
          <!-- Đệm trên/dưới thay cho các dòng ngoài cửa sổ: tổng chiều cao thân bảng vẫn
               bằng rows × ROW_H nên thanh cuộn đúng tỉ lệ. -->
          <tr v-if="start > 0" aria-hidden="true" :style="{ height: `${start * ROW_H}px` }" />
          <TableRow
            v-for="r in slice"
            :key="r.id"
            class="h-6 cursor-default"
            :class="[
              r.id === cap.selectedId.value
                ? '[&>td:first-child]:shadow-[inset_2px_0_0_var(--color-primary),inset_0_-1px_0_var(--color-border)] bg-selected hover:bg-selected'
                : 'hover:bg-accent',
              r.state === 'pending' && 'text-dim',
            ]"
            @click="cap.select(r.id)"
          >
            <TableCell class="tnum text-right text-dim">{{ r.seq }}</TableCell>
            <TableCell>
              <Badge variant="outline" class="px-1.5 py-0 font-semibold">{{ r.method }}</Badge>
            </TableCell>
            <TableCell :title="r.error || r.blockedReason || r.statusText">
              <Badge
                v-if="statusVariant(r)"
                :variant="statusVariant(r)"
                class="tnum max-w-full truncate px-1.5 py-0"
              >
                {{ statusLabel(r) }}
              </Badge>
              <span v-else class="tnum">{{ statusLabel(r) }}</span>
            </TableCell>
            <TableCell class="truncate" :title="r.host">{{ r.host }}</TableCell>
            <!-- Path/URL là chuỗi người dùng copy ⇒ mono. -->
            <TableCell class="truncate font-mono" :title="r.url">{{ r.path }}</TableCell>
            <TableCell class="truncate text-dim">{{ r.resourceType }}</TableCell>
            <TableCell class="tnum text-right text-dim">{{ sizeLabel(r) }}</TableCell>
            <TableCell class="tnum text-right text-dim">{{ timeLabel(r) }}</TableCell>
            <TableCell class="tnum text-right text-dim">{{ clock(r.startedAt) }}</TableCell>
          </TableRow>
          <tr
            v-if="end < rows.length"
            aria-hidden="true"
            :style="{ height: `${(rows.length - end) * ROW_H}px` }"
          />
        </template>
      </TableBody>
    </Table>
  </div>
</template>

<script setup lang="ts">
// Bảng request ảo hoá: chỉ dựng cửa sổ dòng đang nhìn thấy (+ đệm) giữa hai hàng đệm
// cao cố định, nên 5000 dòng vẫn cuộn mượt. Chiều cao dòng là SỐ cố định vì việc tính
// cửa sổ cần nó — giữ khớp với `h-6` của hàng trong template.
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

// Màu badge trạng thái theo nhóm mã; chưa có mã (đang chờ) thì không badge.
type StatusVariant = 'success' | 'info' | 'warning' | 'destructive'
function statusVariant(r: CaptureSummary): StatusVariant | undefined {
  if (r.state === 'failed') return 'destructive'
  if (r.status === null) return undefined
  if (r.status >= 500) return 'destructive'
  if (r.status >= 400) return 'warning'
  if (r.status >= 300) return 'info'
  return 'success'
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
