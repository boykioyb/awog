<template>
  <aside class="iah icard">
    <div class="iah-head">
      <span class="iah-title">{{ t('infra.monitoring.alarm.history') }}</span>
      <button
        type="button"
        class="iah-x"
        :title="t('infra.monitoring.alarm.cancel')"
        :aria-label="t('infra.monitoring.alarm.cancel')"
        @click="emit('close')"
      >
        <Icon name="x" class="iah-ic" />
      </button>
    </div>

    <code class="iah-name">{{ name }}</code>

    <p v-if="loading" class="ihint">{{ t('infra.monitoring.loading') }}</p>
    <p v-else-if="entries.length === 0" class="ihint">
      {{ t('infra.monitoring.alarm.historyEmpty') }}
    </p>
    <ol v-else class="iah-list">
      <li v-for="(e, i) in entries" :key="`${e.type}${String(i)}`" class="iah-row">
        <span class="iah-at">{{ atOf(e.at) }}</span>
        <span class="iah-type">{{ e.type }}</span>
        <!-- Lý do của AWS là văn xuôi dài; nó là NỘI DUNG của mục này, không phải
             chú thích, nên nó được xuống dòng thay vì bị cắt bằng ellipsis. -->
        <span class="iah-sum">{{ e.summary }}</span>
      </li>
    </ol>
  </aside>
</template>

<script setup lang="ts">
// Lịch sử một cảnh báo (Mốc 6, 6.4). Danh sách đã sắp MỚI NHẤT TRƯỚC ở sidecar —
// câu hỏi của khung này luôn là "vừa rồi nó làm gì", không phải "nó ra đời thế nào".
import type { WireAlarmHistoryEntry } from '~/composables/useInfraMetrics'
import { formatAxisTime } from '~/composables/useInfraMetrics'

defineProps<{
  name: string
  entries: WireAlarmHistoryEntry[]
  loading: boolean
}>()

const emit = defineEmits<{ close: [] }>()

const { t } = useI18n()

/** Mục không có mốc thời gian vẫn phải nằm đúng chỗ trong danh sách — hiện "—" chứ
 *  không bịa một mốc, và cũng không bị đẩy xuống cuối. */
function atOf(at: number | null): string {
  return at === null ? '—' : formatAxisTime(at, 86400)
}
</script>

<style scoped>
.iah {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-height: 0;
  overflow-y: auto;
  padding: 10px 12px;
  /* Da (viền, bo góc, nền, đổ bóng) do `.icard` cấp — xem app-shell.css. Bốn khối
     của màn này TỪNG tự khai lại cùng một bộ, với ba nền khác nhau (`--bgSubtle`,
     `--bgEl`), nên chúng đọc ra thành ba loại bề mặt trong cùng một màn. */
}

.iah-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.iah-title {
  font-size: var(--fs-md);
  line-height: var(--lh-md);
  font-weight: 650;
}

.iah-x {
  display: grid;
  place-items: center;
  padding: 4px;
  border: 1px solid transparent;
  border-radius: var(--r-xs);
  background: transparent;
  color: var(--textDim);
  cursor: pointer;
}

.iah-x:hover {
  background: var(--bgHover);
  color: var(--text);
}

.iah-ic {
  width: var(--icon-sm);
  height: var(--icon-sm);
}

.iah-name {
  /* mono-ok: tên alarm là định danh người dùng copy sang AWS CLI/console */
  font-family: var(--code);
  color: var(--textMuted);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  word-break: break-all;
}

.iah-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 4px 0 0;
  padding: 0;
  list-style: none;
}

.iah-row {
  display: grid;
  grid-template-columns: auto auto 1fr;
  gap: 6px;
  align-items: baseline;
  padding-bottom: 6px;
  border-bottom: 1px solid var(--border);
}

.iah-row:last-child {
  border-bottom: none;
  padding-bottom: 0;
}

.iah-at {
  color: var(--textFaint);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  font-variant-numeric: tabular-nums;
}

.iah-type {
  color: var(--textDim);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
}

.iah-sum {
  color: var(--textMuted);
  font-size: var(--fs-xs);
  line-height: var(--lh-sm);
  word-break: break-word;
}
</style>
