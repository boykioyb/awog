<template>
  <!-- Bộ tự co giãn (HorizontalPodAutoscaler).

       VÌ SAO NÓ ĐÁNG MỘT KHỐI RIÊNG thay vì một chip như các loại khác: HPA là chỗ
       DUY NHẤT mà "mọi pod đều Running" vẫn là một cụm đang hỏng. Chạm trần
       (`replicas == max`) nghĩa là tải đã vượt khả năng giãn, và mọi bảng khác
       trong báo cáo vẫn xanh. Ba con số của nó (hiện tại / min / max) phải đứng
       cạnh nhau mới đọc ra được điều đó, nên nó không gói vừa một chip.

       `<unknown>` ở cột TARGETS cũng là một trạng thái riêng: HPA đang KHÔNG lái gì
       cả (metrics-server không trả số), tức số bản sao đang đứng im vì mù, không
       phải vì tải thấp. -->
  <div class="ikrh">
    <div class="ikrh-head">
      <span class="ikrh-t">{{ t('infra.kube.report.hpa') }}</span>
      <span v-if="list.length" class="ihint">{{ list.length }}</span>
    </div>

    <p v-if="gap" class="ikrh-gap">
      {{ t('infra.kube.report.gap.hpa') }}
      <span class="ihint">{{ gap }}</span>
    </p>
    <span v-else-if="list.length === 0" class="ihint">
      {{ t('infra.kube.report.hpaNone') }}
    </span>

    <ul v-else class="ikrh-list">
      <li v-for="h in list" :key="h.name" class="ikrh-i" :class="rateOf(h)">
        <code class="ikrh-name" :title="h.reference">{{ h.name }}</code>
        <span class="ikrh-rep">
          <b>{{ h.replicas ?? '—' }}</b>
          <span class="ikrh-range">{{ h.min ?? '—' }}–{{ h.max ?? '—' }}</span>
        </span>
        <!-- Dải: số bản sao hiện tại nằm ở đâu giữa min và max. Một cụm đang giãn
             tới 9/10 nhìn ra ngay, không phải đọc hai con số rồi tự chia. -->
        <div class="ikrh-bar">
          <span class="ikrh-fill" :style="{ width: fillOf(h) }" />
        </div>
        <span class="ikrh-tg" :class="{ unk: h.unknown }">{{ h.targets || '—' }}</span>
      </li>
    </ul>
  </div>
</template>

<script setup lang="ts">
import type { HpaStat } from '~/utils/kube-report'

defineProps<{ list: HpaStat[]; gap: string }>()

const { t } = useI18n()

function rateOf(h: HpaStat): string {
  if (h.atMax) return 'h-bad'
  return h.unknown ? 'h-warn' : 'h-ok'
}

/** Vị trí của `replicas` trong khoảng min–max. Thiếu số ⇒ dải rỗng, không phải 0. */
function fillOf(h: HpaStat): string {
  if (h.replicas === null || h.min === null || h.max === null || h.max <= h.min) {
    return h.replicas !== null && h.max !== null && h.replicas >= h.max ? '100%' : '0%'
  }
  const pct = ((h.replicas - h.min) / (h.max - h.min)) * 100
  return `${Math.min(100, Math.max(0, pct))}%`
}
</script>

<style scoped>
.ikrh {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}
.ikrh-head {
  display: flex;
  align-items: baseline;
  gap: 8px;
  flex-wrap: wrap;
}
.ikrh-t {
  color: var(--textMuted);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
}
.ikrh-gap {
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
  color: var(--text);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
}
.ikrh-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.ikrh-i {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 62px minmax(50px, 90px) auto;
  align-items: center;
  gap: 10px;
  min-width: 0;
}
.ikrh-name {
  color: var(--text);
  font-family: var(--code); /* mono-ok: tên HPA là thứ dán vào kubectl */
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ikrh-rep {
  display: inline-flex;
  align-items: baseline;
  gap: 4px;
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  font-variant-numeric: tabular-nums;
}
.ikrh-rep b {
  color: var(--text);
}
.h-bad .ikrh-rep b {
  color: var(--danger);
}
.ikrh-range {
  color: var(--textFaint);
}
.ikrh-bar {
  height: 6px;
  overflow: hidden;
  border-radius: var(--r-full);
  background: var(--bgActive);
}
.ikrh-fill {
  display: block;
  height: 100%;
  background: var(--green);
}
.h-warn .ikrh-fill {
  background: var(--amber);
}
.h-bad .ikrh-fill {
  background: var(--danger);
}
.ikrh-tg {
  color: var(--textMuted);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  text-align: right;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ikrh-tg.unk {
  color: var(--amber);
}
</style>
