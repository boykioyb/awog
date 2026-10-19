<template>
  <!-- "Sắp hỏng" — các `ReportItem` kind `risk`: hạn mức sắp hết, autoscaler đã kịch
       trần, PDB chặn drain, node đã đặt chỗ gần hết.

       KHÔNG CÓ NÚT Ở ĐÂY, khác hẳn khối "Đang ảnh hưởng người dùng". Không việc nào
       trong nhóm này sửa được bằng một cú bấm (sửa quota là sửa YAML, nới HPA là
       đổi manifest), nên một hàng nút chỉ làm hai khối trông giống nhau trong khi
       chúng đòi hai mức khẩn cấp khác nhau.

       Rỗng thì vẫn nói MỘT câu: im lặng thì người đọc không phân biệt được "không
       có rủi ro nào" với "chưa đọc được bảng nào". -->
  <div class="flex min-w-0 flex-col">
    <p v-if="items.length === 0" class="text-xs text-faint">
      {{ t('infra.kube.report.riskClear') }}
    </p>

    <ul v-else class="flex flex-col">
      <li
        v-for="item in items"
        :key="item.key"
        class="flex min-w-0 flex-wrap items-baseline gap-2 py-2 first:pt-0 not-first:border-t"
      >
        <Badge
          variant="outline"
          class="shrink-0 border-warning/40 bg-warning/10 font-normal text-warning"
        >
          {{ item.label }}
        </Badge>
        <!-- mono-ok: tên object là thứ dán vào kubectl -->
        <code class="max-w-full truncate font-mono text-xs text-foreground" :title="item.object">
          {{ item.object }}
        </code>
        <span class="text-sm text-muted-foreground">{{ item.text }}</span>
      </li>
    </ul>
  </div>
</template>

<script setup lang="ts">
import type { ReportItem } from '~/composables/useInfraKubeReport'

defineProps<{ items: ReportItem[] }>()

const { t } = useI18n()
</script>
