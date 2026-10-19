<template>
  <!-- Hạn mức namespace (`kubectl get resourcequota`).

       VÌ SAO NÓ CÓ DẢI CHỨ KHÔNG PHẢI CHIP NHƯ CÁC KHỐI KHÁC. Quota là thứ duy
       nhất trong báo cáo mà "đã dùng / trần" là một TỈ LỆ có ý nghĩa đọc bằng mắt:
       `7200m/8` và `12Gi/16Gi` là hai đơn vị khác nhau, nhưng 90% và 75% thì so
       được ngay. Và khi chạm trần, pod tiếp theo bị API server từ chối THẲNG —
       không có pod `Pending` nào để mà nhìn, nên đây là chỗ duy nhất báo trước.

       Rỗng vẫn nói một câu: namespace không đặt hạn mức là một kết quả, không phải
       khối trống. -->
  <div class="flex min-w-0 flex-col gap-1.5">
    <div class="flex flex-wrap items-baseline gap-2">
      <span class="text-xs text-muted-foreground">{{ title }}</span>
      <span v-if="list.length" class="text-xs text-faint">{{ list.length }}</span>
    </div>

    <p v-if="gap" class="flex flex-col gap-0.5 text-sm text-foreground">
      {{ t('infra.kube.report.gapRead') }}
      <span class="text-xs text-faint">{{ gap }}</span>
    </p>
    <span v-else-if="list.length === 0" class="text-xs text-faint">{{ empty }}</span>

    <template v-else>
      <div v-for="q in list" :key="q.name" class="flex min-w-0 flex-col gap-1">
        <!-- mono-ok: tên quota là thứ dán vào kubectl -->
        <code class="font-mono text-xs text-foreground" :title="q.name">{{ q.name }}</code>
        <div
          v-for="entry in q.entries"
          :key="entry.resource"
          class="flex min-w-0 items-center gap-2"
        >
          <span
            class="w-33 shrink-0 truncate text-xs text-muted-foreground"
            :title="entry.resource"
          >
            {{ entry.resource }}
          </span>
          <div class="h-1.5 min-w-0 flex-[1_1_5rem] overflow-hidden rounded-full bg-border">
            <span
              class="block h-full rounded-full"
              :class="FILL[usageRate(entry.pct)] ?? 'bg-success'"
              :style="{ width: widthOf(entry.pct) }"
            />
          </div>
          <span
            class="shrink-0 text-xs tabular-nums"
            :class="PCT_TEXT[usageRate(entry.pct)] ?? 'text-foreground'"
          >
            {{ pctOf(entry.pct) }}
          </span>
          <span class="shrink-0 text-xs text-faint tabular-nums">
            {{ entry.used }}/{{ entry.hard }}
          </span>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { usageRate } from '~/composables/useInfraKubeReport'
import type { QuotaStat } from '~/utils/kube-report'

defineProps<{
  title: string
  list: QuotaStat[]
  /** Câu hiện khi namespace không đặt hạn mức nào. */
  empty: string
  /** Lý do không đọc được bảng quota (rỗng = đọc được). */
  gap: string
}>()

const { t } = useI18n()

const FILL: Record<string, string> = {
  warn: 'bg-warning',
  bad: 'bg-destructive',
}
const PCT_TEXT: Record<string, string> = {
  warn: 'text-warning',
  bad: 'text-destructive',
}

/** Dải của một dòng không đọc được tỉ lệ thì để TRỐNG, không vẽ 0% — 0% là một
 *  con số, còn cái ta có là không có con số nào. */
function widthOf(value: number | null): string {
  return value === null ? '0%' : `${Math.min(100, Math.max(0, value))}%`
}

function pctOf(value: number | null): string {
  return value === null ? '—' : `${Math.round(value)}%`
}
</script>
