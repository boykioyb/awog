<template>
  <!-- Hạn mức namespace (`kubectl get resourcequota`).

       VÌ SAO NÓ CÓ DẢI CHỨ KHÔNG PHẢI CHIP NHƯ CÁC KHỐI KHÁC. Quota là thứ duy
       nhất trong báo cáo mà "đã dùng / trần" là một TỈ LỆ có ý nghĩa đọc bằng mắt:
       `7200m/8` và `12Gi/16Gi` là hai đơn vị khác nhau, nhưng 90% và 75% thì so
       được ngay. Và khi chạm trần, pod tiếp theo bị API server từ chối THẲNG —
       không có pod `Pending` nào để mà nhìn, nên đây là chỗ duy nhất báo trước.

       Rỗng vẫn nói một câu: namespace không đặt hạn mức là một kết quả, không phải
       khối trống. -->
  <div class="ikrq">
    <div class="ikrq-head">
      <span class="ikrq-t">{{ title }}</span>
      <span v-if="list.length" class="ihint">{{ list.length }}</span>
    </div>

    <p v-if="gap" class="ikrq-gap">
      {{ t('infra.kube.report.gapRead') }}
      <span class="ihint">{{ gap }}</span>
    </p>
    <span v-else-if="list.length === 0" class="ihint">{{ empty }}</span>

    <template v-else>
      <div v-for="q in list" :key="q.name" class="ikrq-q">
        <code class="ikrq-name" :title="q.name">{{ q.name }}</code>
        <div v-for="entry in q.entries" :key="entry.resource" class="ikrq-row">
          <span class="ikrq-res" :title="entry.resource">{{ entry.resource }}</span>
          <div class="ikrq-bar">
            <span
              class="ikrq-fill"
              :class="`q-${usageRate(entry.pct)}`"
              :style="{ width: widthOf(entry.pct) }"
            />
          </div>
          <span class="ikrq-pct" :class="`q-${usageRate(entry.pct)}`">{{ pctOf(entry.pct) }}</span>
          <span class="ikrq-abs ihint">{{ entry.used }}/{{ entry.hard }}</span>
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

/** Dải của một dòng không đọc được tỉ lệ thì để TRỐNG, không vẽ 0% — 0% là một
 *  con số, còn cái ta có là không có con số nào. */
function widthOf(value: number | null): string {
  return value === null ? '0%' : `${Math.min(100, Math.max(0, value))}%`
}

function pctOf(value: number | null): string {
  return value === null ? '—' : `${Math.round(value)}%`
}
</script>

<style scoped>
.ikrq {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}
.ikrq-head {
  display: flex;
  align-items: baseline;
  gap: 8px;
  flex-wrap: wrap;
}
.ikrq-t {
  color: var(--textMuted);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
}
.ikrq-gap {
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
  color: var(--text);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
}
.ikrq-q {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}
.ikrq-name {
  color: var(--text);
  font-family: var(--code); /* mono-ok: tên quota là thứ dán vào kubectl */
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
}
.ikrq-row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.ikrq-res {
  flex: 0 0 132px;
  color: var(--textMuted);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ikrq-bar {
  flex: 1 1 80px;
  height: 6px;
  min-width: 0;
  overflow: hidden;
  border-radius: var(--r-full);
  background: var(--bgActive);
}
.ikrq-fill {
  display: block;
  height: 100%;
  border-radius: var(--r-full);
  background: var(--green);
}
.ikrq-fill.q-warn {
  background: var(--amber);
}
.ikrq-fill.q-bad {
  background: var(--danger);
}
.ikrq-pct {
  flex: 0 0 auto;
  color: var(--text);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  font-variant-numeric: tabular-nums;
}
.ikrq-pct.q-warn {
  color: var(--amber);
}
.ikrq-pct.q-bad {
  color: var(--danger);
}
.ikrq-abs {
  flex: 0 0 auto;
  font-variant-numeric: tabular-nums;
}
</style>
