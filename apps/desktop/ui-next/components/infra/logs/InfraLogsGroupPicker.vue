<template>
  <div class="lgp">
    <div class="lgp-head">
      <span class="lgp-title">{{ t('infra.logs.groups.title') }}</span>
      <span v-if="mode === 'multi'" class="lgp-count">
        {{ t('infra.logs.groups.picked', { n: picked.length, max: maxGroups }) }}
      </span>
      <span v-else class="lgp-count">
        {{ t('infra.logs.groups.available', { n: shown.length }) }}
      </span>
    </div>

    <div class="lgp-field">
      <Icon name="search" class="lgp-field-ic" />
      <input
        :value="pattern"
        class="lgp-search"
        type="search"
        spellcheck="false"
        autocomplete="off"
        :placeholder="t('infra.logs.groups.searchPh')"
        @input="onSearch"
        @keydown.enter="emit('reload')"
      />
      <button class="btn sm" type="button" :disabled="loading" @click="emit('reload')">
        {{ loading ? t('infra.logs.groups.loading') : t('infra.logs.groups.reload') }}
      </button>
    </div>

    <!-- Nhóm dùng gần đây lên trước khi CHƯA bấm nhóm nào — lối tắt vào việc hay làm. -->
    <div v-if="recent.length > 0 && !activeMarked" class="lgp-recent">
      <span class="lgp-recent-lbl">{{ t('infra.logs.groups.recent') }}</span>
      <button
        v-for="name in recent"
        :key="name"
        class="lgp-chip"
        type="button"
        :title="name"
        @click="pick(name)"
      >
        <span class="lgp-chip-name">{{ shortName(name) }}</span>
      </button>
    </div>

    <div v-if="error" class="lgp-error">{{ error }}</div>

    <p v-else-if="shown.length === 0 && !loading" class="lgp-empty">
      {{ t('infra.logs.groups.empty') }}
    </p>

    <!-- Danh sách nhóm là CHIP, không phải hàng hai dòng có byte/hạn lưu: bấm một
         chip là tail nhóm đó ngay (mode tail), hoặc tick chọn (mode multi). Số đo
         dung lượng chuyển vào tooltip để chip mỏng, giảm mật độ. -->
    <div v-else class="lgp-cloud" role="listbox" :aria-multiselectable="mode === 'multi'">
      <button
        v-for="g in shown"
        :key="g.name"
        class="lgp-chip"
        :class="{ on: isOn(g.name) }"
        type="button"
        role="option"
        :aria-selected="isOn(g.name)"
        :title="chipTitle(g)"
        :disabled="mode === 'multi' && !picked.includes(g.name) && picked.length >= maxGroups"
        @click="pick(g.name)"
      >
        <Icon :name="chipIcon(g.name)" class="lgp-chip-ic" />
        <span class="lgp-chip-name">{{ shortName(g.name) }}</span>
        <Icon v-if="mode === 'multi' && picked.includes(g.name)" name="x" class="lgp-chip-x" />
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
// Chọn nhóm log dưới dạng CHIP (Mốc 2 việc 2.1). Chỉ đọc metadata — mở không tốn
// một xu CloudWatch nào.
//
// Hai chế độ trên CÙNG một hình dáng chip:
//   · `tail`  (mặc định của màn) — bấm một chip = xem dòng mới nhất của nhóm đó ngay
//     (`filter-log-events`, rẻ). Chỉ một nhóm "đang xem" tại một thời điểm.
//   · `multi` (chế độ Insights nâng cao) — bấm để tick/bỏ, chọn nhiều nhóm cho một
//     truy vấn Insights. Trần `maxGroups` khớp `MAX_LOG_GROUPS` của sidecar.
import type { AwsLogGroup } from '~/composables/useAwsLogsApi'

const props = withDefaults(
  defineProps<{
    groups: AwsLogGroup[]
    mode?: 'tail' | 'multi'
    /** Nhóm đang tick (mode multi). */
    picked?: string[]
    /** Nhóm đang xem (mode tail). */
    active?: string
    recent: string[]
    pattern: string
    loading: boolean
    error: string
    maxGroups?: number
  }>(),
  { mode: 'tail', picked: () => [], active: '', maxGroups: 25 },
)

const emit = defineEmits<{
  toggle: [name: string]
  tail: [name: string]
  reload: []
  'update:pattern': [value: string]
}>()

const { t } = useI18n()
const maxGroups = computed(() => props.maxGroups)

// Lọc client-side theo ô tìm để thu hẹp TỨC THÌ, không phải chờ `reload` gọi mạng.
// `reload` vẫn còn cho lần nạp danh sách khác (tiền tố khác hẳn / danh sách cũ).
const shown = computed<AwsLogGroup[]>(() => {
  const q = props.pattern.trim().toLowerCase()
  if (!q) return props.groups
  return props.groups.filter((g) => g.name.toLowerCase().includes(q))
})

const activeMarked = computed(() =>
  props.mode === 'multi' ? props.picked.length > 0 : props.active.length > 0,
)

function isOn(name: string): boolean {
  return props.mode === 'multi' ? props.picked.includes(name) : props.active === name
}

function chipIcon(name: string): string {
  if (props.mode === 'multi') return props.picked.includes(name) ? 'check' : 'layers'
  return props.active === name ? 'eye' : 'layers'
}

function pick(name: string): void {
  if (props.mode === 'multi') emit('toggle', name)
  else emit('tail', name)
}

function onSearch(e: Event): void {
  emit('update:pattern', (e.target as HTMLInputElement).value)
}

/**
 * Rút gọn tên hiển thị: bỏ tiền tố `/aws/<service>/` quen thuộc để lộ phần phân
 * biệt. Giữ nguyên tên gốc trong `title` (tooltip) — không đánh lừa người đọc.
 */
function shortName(name: string): string {
  const m = /^\/aws\/[^/]+\/(.+)$/.exec(name)
  return m && m[1] ? m[1] : name
}

function chipTitle(g: AwsLogGroup): string {
  const parts = [g.name, formatBytes(g.storedBytes)]
  parts.push(
    g.retentionDays !== null
      ? t('infra.logs.groups.retention', { d: g.retentionDays })
      : t('infra.logs.groups.noRetention'),
  )
  return parts.join('\n')
}

/** Byte ⇒ đơn vị đọc được (giữ tại chỗ: đây là con số chi phối quyết định chi phí). */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KiB`
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MiB`
  return `${(bytes / 1024 ** 3).toFixed(2)} GiB`
}
</script>

<style scoped>
.lgp {
  display: flex;
  flex-direction: column;
  gap: 8px;
  /* Lấp đầy phần còn lại của cột trái: danh sách nhóm cao hết cỡ rồi mới cuộn,
     không để trống khoảng dưới. */
  flex: 1 1 auto;
  min-height: 0;
}

.lgp-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
}

.lgp-title {
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  font-weight: 600;
}

.lgp-count {
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--textDim);
  font-variant-numeric: tabular-nums;
}

.lgp-field {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 8px;
  border: 1px solid var(--border);
  border-radius: var(--r-sm);
  background: var(--bgInput);
}

.lgp-field-ic {
  width: var(--icon-sm);
  height: var(--icon-sm);
  color: var(--textFaint);
  flex: 0 0 auto;
}

.lgp-search {
  flex: 1 1 auto;
  min-width: 0;
  border: none;
  outline: none;
  background: transparent;
  color: var(--text);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  font-family: var(--sans);
}

.lgp-recent {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  align-items: center;
}

.lgp-recent-lbl {
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--textDim);
}

.lgp-error {
  padding: 6px 8px;
  border: 1px solid var(--danger);
  border-radius: var(--r-sm);
  color: var(--danger);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
}

.lgp-empty {
  margin: 0;
  padding: 12px;
  color: var(--textDim);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
}

.lgp-cloud {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  align-content: flex-start;
  /* Cao hết phần còn lại của cột trái rồi mới cuộn (thay chốt cứng 168px). */
  flex: 1 1 auto;
  min-height: 96px;
  overflow-y: auto;
  padding: 1px;
}

.lgp-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  max-width: 100%;
  padding: 4px 9px;
  border: 1px solid var(--border);
  border-radius: var(--r-pill);
  background: transparent;
  color: var(--textMuted);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  cursor: pointer;
  transition:
    background 0.12s,
    border-color 0.12s,
    color 0.12s;
}

.lgp-chip:hover:not(:disabled) {
  border-color: var(--borderStrong);
  color: var(--text);
}

/* Trạng thái chọn = accent-tint (KHÔNG nền xám): --accentDim + --accentBorder. */
.lgp-chip.on {
  border-color: var(--accentBorder);
  background: var(--accentDim);
  color: var(--accent);
}

.lgp-chip:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.lgp-chip-ic {
  width: var(--icon-xs);
  height: var(--icon-xs);
  flex: 0 0 auto;
}

.lgp-chip-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 240px;
  /* mono-ok: tên log group là định danh tài nguyên, không phải câu văn */
  font-family: var(--code);
}

.lgp-chip-x {
  width: var(--icon-xs);
  height: var(--icon-xs);
  flex: 0 0 auto;
  opacity: 0.7;
}
</style>
