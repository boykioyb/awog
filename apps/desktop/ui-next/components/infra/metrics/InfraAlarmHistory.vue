<template>
  <!-- Da card dùng chung của khu hạ tầng — Card shadcn, không tự khai viền/nền/bóng. -->
  <Card class="min-h-0 gap-1 overflow-y-auto px-3 py-2.5">
    <div class="flex items-center justify-between gap-2">
      <span class="text-base font-semibold">{{ t('infra.monitoring.alarm.history') }}</span>
      <Button
        variant="ghost"
        size="iconSm"
        class="text-dim"
        :title="t('infra.monitoring.alarm.cancel')"
        :aria-label="t('infra.monitoring.alarm.cancel')"
        @click="emit('close')"
      >
        <Icon name="x" />
      </Button>
    </div>

    <!-- mono-ok: tên alarm là định danh người dùng copy sang AWS CLI/console -->
    <code class="font-mono text-xs break-all text-muted-foreground">{{ name }}</code>

    <p v-if="loading" class="mt-1.5 text-xs text-faint">{{ t('infra.monitoring.loading') }}</p>
    <p v-else-if="entries.length === 0" class="mt-1.5 text-xs text-faint">
      {{ t('infra.monitoring.alarm.historyEmpty') }}
    </p>
    <ol v-else class="mt-1 flex list-none flex-col gap-1.5 p-0">
      <li
        v-for="(e, i) in entries"
        :key="`${e.type}${String(i)}`"
        class="grid grid-cols-[auto_auto_1fr] items-baseline gap-1.5 border-b pb-1.5 last:border-b-0 last:pb-0"
      >
        <span class="text-xs text-faint tabular-nums">{{ atOf(e.at) }}</span>
        <span class="text-xs text-dim">{{ e.type }}</span>
        <!-- Lý do của AWS là văn xuôi dài; nó là NỘI DUNG của mục này, không phải
             chú thích, nên nó được xuống dòng thay vì bị cắt bằng ellipsis. -->
        <span class="text-xs break-words text-muted-foreground">{{ e.summary }}</span>
      </li>
    </ol>
  </Card>
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
