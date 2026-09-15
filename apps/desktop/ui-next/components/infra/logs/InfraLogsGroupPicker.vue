<template>
  <div class="lgp">
    <div class="lgp-head">
      <span class="lgp-title">{{ t('infra.logs.groups.title') }}</span>
      <span class="lgp-count">
        {{ t('infra.logs.groups.picked', { n: picked.length, max: maxGroups }) }}
      </span>
    </div>

    <div v-if="picked.length > 0" class="lgp-chips">
      <button
        v-for="name in picked"
        :key="name"
        class="lgp-chip on"
        type="button"
        :title="t('infra.logs.groups.remove')"
        @click="emit('toggle', name)"
      >
        <span class="lgp-chip-name">{{ name }}</span>
        <Icon name="x" class="lgp-chip-x" />
      </button>
    </div>

    <div v-if="recent.length > 0 && picked.length === 0" class="lgp-recent">
      <span class="lgp-recent-lbl">{{ t('infra.logs.groups.recent') }}</span>
      <button
        v-for="name in recent"
        :key="name"
        class="lgp-chip"
        type="button"
        @click="emit('toggle', name)"
      >
        {{ name }}
      </button>
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

    <div v-if="error" class="lgp-error">{{ error }}</div>

    <div v-else class="lgp-list" role="listbox" aria-multiselectable="true">
      <p v-if="groups.length === 0 && !loading" class="lgp-empty">
        {{ t('infra.logs.groups.empty') }}
      </p>
      <button
        v-for="g in groups"
        :key="g.name"
        class="lgp-row"
        :class="{ on: picked.includes(g.name) }"
        type="button"
        role="option"
        :aria-selected="picked.includes(g.name)"
        :disabled="!picked.includes(g.name) && picked.length >= maxGroups"
        @click="emit('toggle', g.name)"
      >
        <Icon :name="picked.includes(g.name) ? 'check' : 'layers'" class="lgp-row-ic" />
        <span class="lgp-row-name">{{ g.name }}</span>
        <span class="lgp-row-meta">{{ formatBytes(g.storedBytes) }}</span>
        <span v-if="g.retentionDays !== null" class="lgp-row-meta">
          {{ t('infra.logs.groups.retention', { d: g.retentionDays }) }}
        </span>
        <span v-else class="lgp-row-meta warn">{{ t('infra.logs.groups.noRetention') }}</span>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
// Chọn NHIỀU log group (Mốc 2 việc 2.1). Chỉ đọc metadata — mở màn này không tốn
// một xu CloudWatch Insights nào.
//
// Trần `maxGroups` khớp `MAX_LOG_GROUPS` của sidecar. Ở đây chặn để người dùng
// thấy ngay vì sao không tick thêm được, thay vì để họ bấm rồi nhận lỗi từ CLI.
import type { AwsLogGroup } from '~/composables/useAwsLogsApi'

const props = withDefaults(
  defineProps<{
    groups: AwsLogGroup[]
    picked: string[]
    recent: string[]
    pattern: string
    loading: boolean
    error: string
    maxGroups?: number
  }>(),
  { maxGroups: 25 },
)

const emit = defineEmits<{
  toggle: [name: string]
  reload: []
  'update:pattern': [value: string]
}>()

const { t } = useI18n()
const maxGroups = computed(() => props.maxGroups)

function onSearch(e: Event): void {
  emit('update:pattern', (e.target as HTMLInputElement).value)
}

/** Byte ⇒ đơn vị đọc được. Giữ ở đây (không dùng formatter chung) vì đây là
 *  con số chi phối quyết định bấm Chạy của người dùng. */
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

.lgp-chips,
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

.lgp-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  max-width: 100%;
  padding: 3px 8px;
  border: 1px solid var(--border);
  border-radius: var(--r-xs);
  background: transparent;
  color: var(--textMuted);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  cursor: pointer;
}

.lgp-chip.on {
  border-color: var(--accent);
  color: var(--accent);
  background: var(--bgHover);
}

.lgp-chip-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 260px;
}

.lgp-chip-x {
  width: var(--icon-xs);
  height: var(--icon-xs);
  flex: 0 0 auto;
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

.lgp-error {
  padding: 6px 8px;
  border: 1px solid var(--danger);
  border-radius: var(--r-sm);
  color: var(--danger);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
}

.lgp-list {
  flex: 1 1 auto;
  min-height: 96px;
  max-height: 208px;
  overflow-y: auto;
  border: 1px solid var(--border);
  border-radius: var(--r-sm);
  background: var(--bgEl);
}

.lgp-empty {
  margin: 0;
  padding: 12px;
  color: var(--textDim);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
}

.lgp-row {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 6px 9px;
  border: none;
  border-bottom: 1px solid var(--border);
  background: transparent;
  color: var(--textMuted);
  cursor: pointer;
  text-align: left;
}

.lgp-row:last-child {
  border-bottom: none;
}

.lgp-row.on {
  background: var(--bgHover);
  color: var(--text);
}

.lgp-row:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.lgp-row-ic {
  width: var(--icon-sm);
  height: var(--icon-sm);
  flex: 0 0 auto;
}

.lgp-row-name {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  /* mono-ok: tên log group là định danh tài nguyên, không phải câu văn */
  font-family: var(--code);
}

.lgp-row-meta {
  flex: 0 0 auto;
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  color: var(--textFaint);
  font-variant-numeric: tabular-nums;
}

.lgp-row-meta.warn {
  color: var(--amber);
}
</style>
