<template>
  <div class="lsp">
    <span class="lsp-title">{{ t('infra.logs.streams.title') }}</span>
    <span class="lsp-count">{{ t('infra.logs.streams.count', { n: streams.length }) }}</span>

    <span v-if="error" class="lsp-error">{{ error }}</span>
    <span v-else-if="loading && streams.length === 0" class="lsp-empty">
      {{ t('infra.logs.streams.loading') }}
    </span>
    <span v-else-if="streams.length === 0" class="lsp-empty">
      {{ t('infra.logs.streams.empty') }}
    </span>

    <!-- Một HÀNG cuộn ngang, không xuống dòng: dải này nằm giữa thanh công cụ và
         bảng kết quả, nên mỗi hàng nó chiếm là một hàng log bị đẩy khuất. Danh sách
         có thể tới 50 stream (trần của `describe-log-streams`) — cuộn ngang giữ
         chiều cao cố định bất kể số lượng. -->
    <div v-else class="lsp-row" role="listbox" aria-label="log streams">
      <!-- "Tất cả stream" luôn đứng đầu và là mặc định: bấm một nhóm log phải thấy
           dòng log NGAY, không phải chọn thêm một stream nữa. -->
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
/* Dải một hàng trong panel chính (trước 2026-09-17 là một khối dọc ở cột trái). */
.lsp {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  flex: 0 0 auto;
}

.lsp-title {
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  font-weight: 600;
  white-space: nowrap;
}

.lsp-count {
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--textDim);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.lsp-error {
  padding: 4px 8px;
  border: 1px solid var(--danger);
  border-radius: var(--r-sm);
  color: var(--danger);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
}

/* Cuộn NGANG, không xuống dòng — xem chú thích ở template. */
.lsp-row {
  display: flex;
  flex-wrap: nowrap;
  gap: 5px;
  flex: 1 1 auto;
  min-width: 0;
  overflow-x: auto;
  overflow-y: hidden;
  padding: 1px;
}

.lsp-empty {
  margin: 0;
  color: var(--textDim);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
}

.lsp-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  flex: 0 0 auto;
  max-width: 320px;
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
  /* mono-ok: tên log stream là định danh tài nguyên */
  font-family: var(--code);
}
</style>
