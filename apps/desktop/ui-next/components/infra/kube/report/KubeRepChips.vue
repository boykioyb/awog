<template>
  <!-- Một nhóm đối tượng "tên + một con số + ổn hay không": StatefulSet, DaemonSet,
       Job, PVC, Service, Ingress. Năm chỗ dùng chung MỘT hình dạng, nên hình dạng
       đó sống ở đây — năm bản copy là năm chỗ để lệch nhau ở lần sửa đầu tiên.

       CHIP CHỨ KHÔNG PHẢI BẢNG. Mỗi nhóm thường có 1–6 phần tử và chỉ có hai cột
       thật (tên, trạng thái); một bảng có tiêu đề cột cho ngần đó dữ liệu tốn ba
       dòng để nói một dòng.

       Nhóm RỖNG vẫn hiện một câu. "Không có Job nào" là một KẾT QUẢ — im lặng thì
       người đọc không phân biệt được với "chưa đọc được". -->
  <div class="flex min-w-0 flex-col gap-1.5">
    <div class="flex flex-wrap items-baseline gap-2">
      <span class="text-xs text-muted-foreground">{{ title }}</span>
      <span v-if="items.length" class="text-xs text-faint">{{ items.length }}</span>
    </div>

    <p v-if="gap" class="flex flex-col gap-0.5 text-sm text-foreground">
      {{ t('infra.kube.report.gapRead') }}
      <span class="text-xs text-faint">{{ gap }}</span>
    </p>
    <span v-else-if="items.length === 0" class="text-xs text-faint">{{ empty }}</span>

    <ul v-else class="flex flex-wrap gap-1.5">
      <li
        v-for="item in items"
        :key="item.name"
        class="inline-flex max-w-full items-center gap-1.5 rounded-full border bg-card px-2 py-1"
        :class="RATE_BORDER[item.rate]"
      >
        <span class="size-2 shrink-0 rounded-full" :class="RATE_DOT[item.rate]" />
        <!-- mono-ok: tên object là thứ dán vào kubectl -->
        <code class="truncate font-mono text-xs text-foreground" :title="item.name">
          {{ item.name }}
        </code>
        <span v-if="item.value" class="text-xs text-muted-foreground tabular-nums">
          {{ item.value }}
        </span>
      </li>
    </ul>
  </div>
</template>

<script setup lang="ts">
import type { ChipItem } from '~/composables/useInfraKubeReport'

defineProps<{
  title: string
  items: ChipItem[]
  /** Câu hiện khi nhóm rỗng — mỗi loại nói một câu khác nhau. */
  empty: string
  /** Lý do không đọc được nhóm này (rỗng = đọc được). */
  gap: string
}>()

const { t } = useI18n()

/** Viền chip theo mức: `ok` giữ viền thường, chỉ chỗ có chuyện mới đổi màu. */
const RATE_BORDER: Record<string, string> = {
  warn: 'border-warning/40',
  bad: 'border-destructive/40',
}
const RATE_DOT: Record<string, string> = {
  ok: 'bg-success',
  warn: 'bg-warning',
  bad: 'bg-destructive',
}
</script>
