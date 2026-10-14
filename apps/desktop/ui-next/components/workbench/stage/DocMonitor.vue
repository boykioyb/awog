<template>
  <!-- Doc 'monitor' — Giám sát nhúng gọn: thanh scope + thẻ tổng (MonitorSummary)
       + bảng tiến trình top-10 theo CPU. useMonitorManager là per-instance nên
       doc này có vòng poll riêng — doc bị KeepAlive deactivate thì poll nằm yên
       (onDeactivated của composable), bật lại là số liệu đã sẵn. -->
  <div class="flex min-h-0 flex-1 flex-col">
    <div class="flex flex-none items-center gap-2 px-3 py-2 shadow-[inset_0_-1px_0_var(--border)]">
      <DocButtonGroup :options="scopeOptions" :active="scope" @select="scope = $event" />
      <span class="flex-1" />
      <span class="text-xs text-[var(--textFaint)]">{{ t('workbench.monitor.embedHint') }}</span>
    </div>
    <div
      v-if="error"
      class="mx-3 my-2 rounded-[var(--r-xs)] bg-[var(--dangerDim)] px-2.5 py-2 text-sm text-destructive"
    >
      {{ error }}
    </div>
    <div class="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
      <MonitorSummary
        :scope="scope"
        :totals="totals"
        :gpu="gpu"
        :core-count="coreCount"
        :total-mem-kb="totalMemKb"
        :warming-up="warmingUp"
        :top="topProcess"
      />
      <MonitorProcesses
        :title="t('monitor.processes.title')"
        :rows="top10"
        :killing="killing"
        :total-mem-kb="totalMemKb"
        :can-kill="canKill"
        :needs-force="needsForce"
        :session-titles="sessionTitles"
        @kill="kill"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useMonitorManager } from '~/composables/useMonitorManager'
import MonitorSummary from '~/components/monitor/MonitorSummary.vue'
import MonitorProcesses from '~/components/monitor/MonitorProcesses.vue'
import DocButtonGroup from '~/components/workbench/stage/DocButtonGroup.vue'

const { t } = useI18n()

const {
  totals,
  gpu,
  coreCount,
  totalMemKb,
  warmingUp,
  topProcess,
  processes,
  sessions,
  killing,
  canKill,
  needsForce,
  kill,
  error,
  scope,
} = useMonitorManager()

const scopeOptions = computed(() => [
  { id: 'awog' as const, label: t('monitor.scope.awog') },
  { id: 'machine' as const, label: t('monitor.scope.machine') },
])

const sessionTitles = computed(() => new Map(sessions.value.map((s) => [s.sessionId, s.title])))

// Top-10 theo CPU — `processes` của manager đã cắt theo scope; sortKey/sortDir
// là của trang, ở đây chỉ cần một lát cắt cố định theo CPU giảm dần.
const top10 = computed(() =>
  [...processes.value].sort((a, b) => (b.cpuPercent ?? 0) - (a.cpuPercent ?? 0)).slice(0, 10),
)
</script>
