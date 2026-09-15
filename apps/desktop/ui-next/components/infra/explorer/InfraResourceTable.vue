<template>
  <!-- Khung bảng dùng chung của Explorer (task 3.1).
       Ba thứ nằm ở đây chứ không ở màn: thanh công cụ (tìm · nạp lúc · nạp thêm),
       bảng, và các trạng thái rỗng/lỗi. Màn chỉ bind state vào. -->
  <div class="ixt">
    <div class="ixt-bar">
      <label class="srch">
        <Icon name="search" />
        <input
          :value="search"
          :placeholder="t('infra.explorer.search.placeholder')"
          @input="$emit('update:search', ($event.target as HTMLInputElement).value)"
        />
      </label>
      <button class="btn sm" type="button" :disabled="loading" @click="$emit('reload')">
        <Icon name="refresh" />
        {{ t('infra.explorer.reload') }}
      </button>
      <!-- Nhãn này là một phần của hợp đồng: "nạp lúc HH:MM" để không ai đọc số
           cũ như thể nó đang sống. Không có mốc giờ thì không có gì để tin. -->
      <span v-if="loadedAtLabel" class="ixt-when">{{ loadedAtLabel }}</span>
    </div>

    <!-- Tìm ở đây lọc TRÊN TRANG ĐÃ NẠP, không phải trên cả tài khoản. Nói thẳng
         ra thay vì để người dùng tin rằng họ vừa tìm khắp nơi. -->
    <p v-if="search.trim()" class="ixt-note">{{ t('infra.explorer.search.localOnly') }}</p>

    <div ref="scroller" class="ixt-scroll tblcard" @scroll="onScroll">
      <p v-if="loading && !rows.length" class="ixt-state">{{ t('infra.explorer.loading') }}</p>
      <p v-else-if="error" class="ixt-state err">{{ error }}</p>
      <p v-else-if="!rows.length" class="ixt-state">
        {{ search.trim() ? t('infra.explorer.emptyFiltered') : t('infra.explorer.empty') }}
      </p>

      <table v-else class="kt">
        <thead>
          <tr>
            <th
              v-for="col in columns"
              :key="col.key"
              :style="col.width ? { width: col.width } : undefined"
              :class="{ 'kt-num': col.align === 'right' }"
            >
              {{ t(col.label) }}
            </th>
            <th class="kt-act" />
          </tr>
        </thead>
        <tbody>
          <tr v-if="padTop" aria-hidden="true" class="ixt-pad">
            <td :colspan="columns.length + 1" :style="{ height: `${padTop}px` }" />
          </tr>
          <tr
            v-for="row in slice"
            :key="row['id'] || row['name']"
            class="kt-click"
            :class="{ on: selectedId && (row['id'] === selectedId || row['name'] === selectedId) }"
            tabindex="0"
            @click="$emit('row', row)"
            @keydown.enter.prevent="$emit('row', row)"
          >
            <td
              v-for="col in columns"
              :key="col.key"
              :class="{ 'kt-num': col.align === 'right', 'kt-wide': col.wide }"
            >
              {{ row[col.key] || '—' }}
            </td>
            <td class="ixt-acts" @click.stop>
              <!-- Nút ghi bị ẨN khi dò quyền nói chắc chắn thiếu (task 3.3); lý do
                   nằm ở tooltip của hàng, không phải một hộp thoại lỗi sau cú bấm. -->
              <button
                v-for="a in visibleActions"
                :key="a.id"
                class="btn sm"
                :class="{ danger: a.danger }"
                type="button"
                :disabled="actionDenied(a.id)"
                :title="actionDenied(a.id) ? t('infra.explorer.denied') : t(a.consequence)"
                @click="$emit('action', { action: a, row })"
              >
                {{ t(a.label) }}
              </button>
              <button
                v-if="hasConsole"
                class="btn sm"
                type="button"
                :title="t('infra.explorer.console')"
                @click="$emit('console', row)"
              >
                <Icon name="external" />
              </button>
              <button
                class="btn sm"
                type="button"
                :title="t('infra.explorer.ask')"
                @click="$emit('ask', row)"
              >
                <Icon name="sparkles" />
              </button>
            </td>
          </tr>
          <tr v-if="padBottom" aria-hidden="true" class="ixt-pad">
            <td :colspan="columns.length + 1" :style="{ height: `${padBottom}px` }" />
          </tr>
        </tbody>
      </table>
    </div>

    <div v-if="nextToken" class="ixt-more">
      <button class="btn sm" type="button" :disabled="loading" @click="$emit('load-more')">
        <Icon name="chev" />
        {{ t('infra.explorer.loadMore') }}
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
// Bảng ảo hoá chỉ bật khi THẬT SỰ dài (>200 dòng, `virtual` từ controller): dựng
// cửa sổ cho một bảng 20 dòng chỉ làm mất `Ctrl+F` của trình duyệt mà không được gì.
import { computed, ref, useTemplateRef } from 'vue'
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

<style scoped>
.ixt {
  display: flex;
  flex-direction: column;
  min-height: 0;
  flex: 1;
}

.ixt-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 0 8px;
}

.ixt-when {
  margin-left: auto;
  color: var(--textFaint);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  font-variant-numeric: tabular-nums;
}

.ixt-note {
  margin: 0 0 6px;
  color: var(--textDim);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
}

/* Skin card nằm ở `.tblcard` toàn cục (app-shell.css); đây chỉ còn bố cục. */
.ixt-scroll {
  flex: 1;
  min-height: 0;
  overflow: auto;
}

.ixt-state {
  margin: 0;
  padding: 22px 14px;
  color: var(--textDim);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  text-align: center;
}

.ixt-state.err {
  color: var(--red);
}

.kt {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--fs-sm);
}

.kt th {
  text-align: left;
  font-weight: 500;
  color: var(--textMuted);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  padding: 6px 10px;
  border-bottom: 1px solid var(--border);
  white-space: nowrap;
  position: sticky;
  top: 0;
  z-index: 1;
  background: var(--bgSubtle);
}

.kt td {
  padding: 7px 10px;
  border-bottom: 1px solid var(--border);
  color: var(--text);
  max-width: 320px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.kt-wide {
  max-width: none;
}

.kt-num {
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.kt-click {
  cursor: pointer;
}

.kt-click:hover td,
.kt-click.on td {
  background: var(--bgHover);
}

.kt-act {
  width: 1%;
}

.ixt-acts {
  display: flex;
  gap: 4px;
  justify-content: flex-end;
  padding: 4px 10px;
}

.ixt-acts .btn.danger {
  color: var(--red);
  border-color: var(--border);
}

.ixt-pad td {
  padding: 0;
  border: 0;
}

.ixt-more {
  padding: 8px 0 0;
  display: flex;
  justify-content: center;
}
</style>
