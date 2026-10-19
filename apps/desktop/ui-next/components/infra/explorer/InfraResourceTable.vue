<template>
  <!-- Khung bảng dùng chung của Explorer (task 3.1).
       Ba thứ nằm ở đây chứ không ở màn: thanh công cụ (tìm · nạp lúc · nạp thêm),
       bảng, và các trạng thái rỗng/lỗi. Màn chỉ bind state vào. -->
  <div class="flex min-h-0 flex-1 flex-col">
    <div class="flex items-center gap-2 pb-2">
      <div class="relative min-w-0 flex-1">
        <Icon
          name="search"
          class="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-dim"
        />
        <Input
          class="h-ctrl-sm pl-8"
          :model-value="search"
          :placeholder="t('infra.explorer.search.placeholder')"
          @update:model-value="$emit('update:search', $event)"
        />
      </div>
      <Button
        type="button"
        :disabled="loading"
        variant="outline"
        size="sm"
        @click="$emit('reload')"
      >
        <Icon name="refresh" />
        {{ t('infra.explorer.reload') }}
      </Button>
      <!-- Nhãn này là một phần của hợp đồng: "nạp lúc HH:MM" để không ai đọc số
           cũ như thể nó đang sống. Không có mốc giờ thì không có gì để tin. -->
      <span v-if="loadedAtLabel" class="ml-auto text-xs text-faint tabular-nums">
        {{ loadedAtLabel }}
      </span>
    </div>

    <!-- Tìm ở đây lọc TRÊN TRANG ĐÃ NẠP, không phải trên cả tài khoản. Nói thẳng
         ra thay vì để người dùng tin rằng họ vừa tìm khắp nơi. -->
    <p v-if="search.trim()" class="mb-1.5 text-xs text-dim">
      {{ t('infra.explorer.search.localOnly') }}
    </p>

    <!-- Khung cuộn = card. Chính phần tử này là `scroller` của cửa sổ ảo hoá. -->
    <div
      ref="scroller"
      class="min-h-0 flex-1 overflow-auto rounded-xl border bg-card shadow-sm"
      @scroll="onScroll"
    >
      <p v-if="loading && !rows.length" :class="STATE">{{ t('infra.explorer.loading') }}</p>
      <p v-else-if="error" :class="[STATE, 'text-destructive']">{{ error }}</p>
      <p v-else-if="!rows.length" :class="STATE">
        {{ search.trim() ? t('infra.explorer.emptyFiltered') : t('infra.explorer.empty') }}
      </p>

      <!-- `<table>` trần thay cho `Table`: `Table` bọc bảng trong một div
           `overflow-auto` riêng, mà sticky header bám theo khung cuộn GẦN NHẤT — tức
           cái div không bao giờ cuộn đó — nên tiêu đề cột sẽ trôi mất. Khung cuộn
           phải là `scroller` phía trên (cửa sổ ảo hoá đọc `scrollTop` của nó). -->
      <table v-else class="w-full border-collapse text-sm">
        <TableHeader>
          <TableRow class="hover:bg-transparent">
            <TableHead
              v-for="col in columns"
              :key="col.key"
              :style="col.width ? { width: col.width } : undefined"
              :class="[HEAD, col.align === 'right' && 'text-right tabular-nums']"
            >
              {{ t(col.label) }}
            </TableHead>
            <TableHead :class="[HEAD, 'w-[1%]']" />
          </TableRow>
        </TableHeader>
        <TableBody>
          <tr v-if="padTop" aria-hidden="true">
            <td :colspan="columns.length + 1" class="p-0" :style="{ height: `${padTop}px` }" />
          </tr>
          <TableRow
            v-for="row in slice"
            :key="row['id'] || row['name']"
            class="cursor-pointer hover:bg-accent data-[state=selected]:bg-selected"
            :data-state="isSelected(row) ? 'selected' : undefined"
            tabindex="0"
            @click="$emit('row', row)"
            @keydown.enter.prevent="$emit('row', row)"
          >
            <!-- Một ARN hay một chuỗi tag dài phải cắt bằng ellipsis chứ không được
                 đẩy bảng cuộn ngang; cột `wide` là lối thoát cho cột cố ý cho dài. -->
            <TableCell
              v-for="col in columns"
              :key="col.key"
              class="truncate px-2.5 py-1.5"
              :class="[
                col.wide ? 'max-w-none' : 'max-w-80',
                col.align === 'right' && 'text-right tabular-nums',
              ]"
            >
              {{ row[col.key] || '—' }}
            </TableCell>
            <TableCell class="px-2.5 py-1" @click.stop>
              <div class="flex justify-end gap-1">
                <!-- Nút ghi bị ẨN khi dò quyền nói chắc chắn thiếu (task 3.3); lý do
                     nằm ở tooltip của hàng, không phải một hộp thoại lỗi sau cú bấm. -->
                <Button
                  v-for="a in visibleActions"
                  :key="a.id"
                  :class="{ 'text-destructive': a.danger }"
                  type="button"
                  :disabled="actionDenied(a.id)"
                  :title="actionDenied(a.id) ? t('infra.explorer.denied') : t(a.consequence)"
                  variant="outline"
                  size="sm"
                  @click="$emit('action', { action: a, row })"
                >
                  {{ t(a.label) }}
                </Button>
                <Button
                  v-if="hasConsole"
                  type="button"
                  :title="t('infra.explorer.console')"
                  :aria-label="t('infra.explorer.console')"
                  variant="outline"
                  size="iconMd"
                  @click="$emit('console', row)"
                >
                  <Icon name="external" />
                </Button>
                <Button
                  type="button"
                  :title="t('infra.explorer.ask')"
                  :aria-label="t('infra.explorer.ask')"
                  variant="outline"
                  size="iconMd"
                  @click="$emit('ask', row)"
                >
                  <Icon name="sparkles" />
                </Button>
              </div>
            </TableCell>
          </TableRow>
          <tr v-if="padBottom" aria-hidden="true">
            <td :colspan="columns.length + 1" class="p-0" :style="{ height: `${padBottom}px` }" />
          </tr>
        </TableBody>
      </table>
    </div>

    <div v-if="nextToken" class="flex justify-center pt-2">
      <Button
        type="button"
        :disabled="loading"
        variant="outline"
        size="sm"
        @click="$emit('load-more')"
      >
        <Icon name="chev" />
        {{ t('infra.explorer.loadMore') }}
      </Button>
    </div>
  </div>
</template>

<script setup lang="ts">
// Bảng ảo hoá chỉ bật khi THẬT SỰ dài (>200 dòng, `virtual` từ controller): dựng
// cửa sổ cho một bảng 20 dòng chỉ làm mất `Ctrl+F` của trình duyệt mà không được gì.
import { computed, ref, useTemplateRef } from 'vue'
import Button from '~/components/ui/button/Button.vue'
import Input from '~/components/ui/input/Input.vue'
import type {
  InfraActionDescriptor,
  InfraColumn,
  InfraResourceRow,
} from '~/composables/useInfraResourcesApi'

const props = defineProps<{
  columns: readonly InfraColumn[]
  rows: readonly InfraResourceRow[]
  actions: readonly InfraActionDescriptor[]
  loading: boolean
  error: string
  /** Epoch ms của lần nạp gần nhất; null = chưa nạp lần nào. */
  loadedAt: number | null
  virtual: boolean
  hasDetail: boolean
  hasConsole: boolean
  nextToken: string | null
  selectedId: string
  search: string
  /** `true` ⇒ nút đó bị dò quyền từ chối và phải VẮNG MẶT. */
  actionDenied: (id: string) => boolean
}>()

defineEmits<{
  (e: 'update:search', v: string): void
  (e: 'row', row: InfraResourceRow): void
  (e: 'action', payload: { action: InfraActionDescriptor; row: InfraResourceRow }): void
  (e: 'ask', row: InfraResourceRow): void
  (e: 'console', row: InfraResourceRow): void
  (e: 'reload'): void
  (e: 'load-more'): void
}>()

const { t } = useI18n()

/** Câu "đang tải" / "rỗng" / "lỗi" đứng THAY CHỖ bảng nên chiếm chiều cao của một bảng. */
const STATE = 'px-3.5 py-5.5 text-center text-sm text-dim'
/** Tiêu đề cột dính khi cuộn, nền đục — bảng dài hơn khung mà mất nhãn cột là bảng mù. */
const HEAD = 'sticky top-0 z-1 h-auto bg-muted px-2.5 py-1.5 text-xs font-medium whitespace-nowrap'

function isSelected(row: InfraResourceRow): boolean {
  const id = props.selectedId
  return !!id && (row['id'] === id || row['name'] === id)
}

/** Nút bị từ chối thì không dựng ra nữa — ẩn thật, không phải disable. */
const visibleActions = computed(() => props.actions.filter((a) => !props.actionDenied(a.id)))

const loadedAtLabel = computed(() => {
  if (props.loadedAt == null) return ''
  const d = new Date(props.loadedAt)
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return t('infra.explorer.loadedAt', { time: `${hh}:${mm}` })
})

// ── Cửa sổ ảo hoá ─────────────────────────────────────────────────────────
const ROW_H = 32
/** Số dòng dựng thật một lúc; dư ra một quãng để cuộn nhanh không thấy trắng. */
const WINDOW = 40
const OVERSCAN = 10
const scroller = useTemplateRef<HTMLElement>('scroller')
const scrollTop = ref(0)

function onScroll(): void {
  if (props.virtual && scroller.value) scrollTop.value = scroller.value.scrollTop
}

const start = computed(() =>
  props.virtual ? Math.max(0, Math.floor(scrollTop.value / ROW_H) - OVERSCAN) : 0,
)
const end = computed(() =>
  props.virtual ? Math.min(props.rows.length, start.value + WINDOW) : props.rows.length,
)
const slice = computed(() => props.rows.slice(start.value, end.value))
const padTop = computed(() => (props.virtual ? start.value * ROW_H : 0))
const padBottom = computed(() => (props.virtual ? (props.rows.length - end.value) * ROW_H : 0))
</script>
