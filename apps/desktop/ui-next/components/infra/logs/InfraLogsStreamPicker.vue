<template>
  <div class="lsp">
    <div class="lsp-head">
      <span class="lsp-title">{{ t('infra.logs.streams.title') }}</span>
      <span class="lsp-count">{{ t('infra.logs.streams.count', { n: streams.length }) }}</span>
    </div>

    <div v-if="error" class="lsp-error">{{ error }}</div>

    <div v-else class="lsp-cloud" role="listbox" aria-label="log streams">
      <!-- "Tất cả stream" = gộp mọi stream (filter-log-events không kèm --log-stream-names).
           Luôn đứng đầu và là mặc định khi mới bấm vào group. -->
      <button
        class="lsp-chip"
        :class="{ on: active === '' }"
        type="button"
        role="option"
        :aria-selected="active === ''"
        @click="emit('select', '')"
      >
        <Icon name="layers" class="lsp-chip-ic" />
        <span class="lsp-chip-name">{{ t('infra.logs.streams.all') }}</span>
      </button>

      <button
        v-for="s in streams"
        :key="s.name"
        class="lsp-chip"
        :class="{ on: active === s.name }"
        type="button"
        role="option"
        :aria-selected="active === s.name"
        :title="chipTitle(s)"
        @click="emit('select', s.name)"
      >
        <Icon :name="active === s.name ? 'eye' : 'file'" class="lsp-chip-ic" />
        <span class="lsp-chip-name">{{ s.name }}</span>
      </button>

      <p v-if="!loading && streams.length === 0" class="lsp-empty">
        {{ t('infra.logs.streams.empty') }}
      </p>
      <p v-else-if="loading" class="lsp-empty">{{ t('infra.logs.streams.loading') }}</p>
    </div>
  </div>
</template>

<script setup lang="ts">
// Chọn LOG STREAM của group đang xem (tầng giữa CloudWatch: group → stream → event,
// Mốc 2 việc 2.9). Bấm một chip = thu hẹp tail về stream đó; chip "Tất cả stream" =
// gộp mọi stream. Chỉ ĐỌC metadata (describe-log-streams) — mở không tốn GB quét.
import type { AwsLogStream } from '~/composables/useAwsLogsApi'

defineProps<{
  streams: AwsLogStream[]
  /** Stream đang xem; '' = tất cả. */
  active: string
  loading: boolean
  error: string
}>()

const emit = defineEmits<{ select: [name: string] }>()

const { t } = useI18n()

/** Byte ⇒ đơn vị đọc được (giữ tại chỗ như GroupPicker — cùng một phép). */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KiB`
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MiB`
  return `${(bytes / 1024 ** 3).toFixed(2)} GiB`
}

function chipTitle(s: AwsLogStream): string {
  const parts = [s.name, formatBytes(s.storedBytes)]
  if (s.lastEventAt)
    parts.push(
      t('infra.logs.streams.lastEvent', { when: new Date(s.lastEventAt).toLocaleString() }),
    )
  return parts.join('\n')
}
</script>

<style scoped>
.lsp {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-height: 0;
}

.lsp-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
}

.lsp-title {
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  font-weight: 600;
}

.lsp-count {
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--textDim);
  font-variant-numeric: tabular-nums;
}

.lsp-error {
  padding: 6px 8px;
  border: 1px solid var(--danger);
  border-radius: var(--r-sm);
  color: var(--danger);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
}

/* Cao tối đa rồi cuộn — danh sách stream có thể tới 50 mục. */
.lsp-cloud {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  align-content: flex-start;
  max-height: 160px;
  overflow-y: auto;
  padding: 1px;
}

.lsp-empty {
  margin: 0;
  padding: 8px;
  color: var(--textDim);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
}

.lsp-chip {
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

.lsp-chip:hover {
  border-color: var(--borderStrong);
  color: var(--text);
}

/* Trạng thái chọn = accent-tint (KHÔNG nền xám). */
.lsp-chip.on {
  border-color: var(--accentBorder);
  background: var(--accentDim);
  color: var(--accent);
}

.lsp-chip-ic {
  width: var(--icon-xs);
  height: var(--icon-xs);
  flex: 0 0 auto;
}

.lsp-chip-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 240px;
  /* mono-ok: tên log stream là định danh tài nguyên */
  font-family: var(--code);
}
</style>
