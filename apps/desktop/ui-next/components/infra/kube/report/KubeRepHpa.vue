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
  <div class="flex min-w-0 flex-col gap-1.5">
    <div class="flex flex-wrap items-baseline gap-2">
      <span class="text-xs text-muted-foreground">{{ t('infra.kube.report.hpa') }}</span>
      <span v-if="list.length" class="text-xs text-faint">{{ list.length }}</span>
    </div>

    <p v-if="gap" class="flex flex-col gap-0.5 text-sm text-foreground">
      {{ t('infra.kube.report.gap.hpa') }}
      <span class="text-xs text-faint">{{ gap }}</span>
    </p>
    <span v-else-if="list.length === 0" class="text-xs text-faint">
      {{ t('infra.kube.report.hpaNone') }}
    </span>

    <ul v-else class="flex flex-col gap-1.5">
      <li
        v-for="h in list"
        :key="h.name"
        class="grid min-w-0 grid-cols-[minmax(0,1fr)_3.875rem_minmax(3.125rem,5.625rem)_auto] items-center gap-2.5"
      >
        <!-- mono-ok: tên HPA là thứ dán vào kubectl -->
        <code class="truncate font-mono text-xs text-foreground" :title="h.reference">
          {{ h.name }}
        </code>
        <span class="inline-flex items-baseline gap-1 text-xs tabular-nums">
          <b :class="rateOf(h) === 'bad' ? 'text-destructive' : 'text-foreground'">
            {{ h.replicas ?? '—' }}
          </b>
          <span class="text-faint">{{ h.min ?? '—' }}–{{ h.max ?? '—' }}</span>
        </span>
        <!-- Dải: số bản sao hiện tại nằm ở đâu giữa min và max. Một cụm đang giãn
             tới 9/10 nhìn ra ngay, không phải đọc hai con số rồi tự chia. -->
        <div class="h-1.5 overflow-hidden rounded-full bg-border">
          <span class="block h-full" :class="FILL[rateOf(h)]" :style="{ width: fillOf(h) }" />
        </div>
        <span
          class="truncate text-right text-xs"
          :class="h.unknown ? 'text-warning' : 'text-muted-foreground'"
        >
          {{ h.targets || '—' }}
        </span>
      </li>
    </ul>
  </div>
</template>

<script setup lang="ts">
import type { HpaStat } from '~/utils/kube-report'

defineProps<{ list: HpaStat[]; gap: string }>()

const { t } = useI18n()

type HpaRate = 'ok' | 'warn' | 'bad'

/** Chạm trần = hỏng; TARGETS `<unknown>` = HPA đang mù (cảnh báo). */
function rateOf(h: HpaStat): HpaRate {
  if (h.atMax) return 'bad'
  return h.unknown ? 'warn' : 'ok'
}

const FILL: Record<HpaRate, string> = {
  ok: 'bg-success',
  warn: 'bg-warning',
  bad: 'bg-destructive',
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
