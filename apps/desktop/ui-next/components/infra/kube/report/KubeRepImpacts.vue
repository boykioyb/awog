<template>
  <!-- Danh sách việc ĐANG chạm tới người dùng — mỗi phần tử là một `ReportItem`
       kind `impact` do `useInfraKubeReport()` xếp sẵn theo mức nặng.

       VÌ SAO KHỐI NÀY CÓ NÚT, CÒN "Nên xem" THÌ KHÔNG. Một dòng "pod X
       CrashLoopBackOff" mà không mở được log của nó là một dòng bắt người trực đi
       gõ lại tên pod vào terminal — đúng lúc họ vội nhất. Ba nút ở đây là ba thứ
       người ta làm tiếp theo trong 100% trường hợp: đọc log lần chạy TRƯỚC (log
       lần này thường trống vì container vừa restart), xem describe, hoặc vào
       thẳng terminal của pod.

       Component chỉ HIỂN THỊ: nó không biết `kube` là gì, chỉ bắn sự kiện lên cho
       `InfraKubeReport.vue` gọi controller.

       Các việc ngăn nhau bằng hairline, không bằng khung riêng: khối này đã nằm
       trong một card, thêm khung nữa là hai đường viền lồng nhau quanh cùng một nền. -->
  <div class="flex min-w-0 flex-col">
    <div
      v-for="item in items"
      :key="item.key"
      class="flex min-w-0 flex-col gap-1.5 py-2.5 first:pt-0 not-first:border-t"
    >
      <div class="flex min-w-0 flex-wrap items-baseline gap-2">
        <!-- Màu chip đi theo `kind`, không phải theo component: cùng một hàng dùng
             cho ba nhóm (đang ảnh hưởng · sắp hỏng · nên xem), và tô đỏ hết thì
             "lệch phiên bản kubelet" hét ngang với "pod đang chết". -->
        <Badge
          variant="outline"
          class="shrink-0 font-semibold"
          :class="KIND_TONE[item.kind] ?? 'bg-card text-muted-foreground'"
        >
          {{ item.label }}
        </Badge>
        <!-- mono-ok: tên object là thứ dán vào kubectl -->
        <code
          v-if="item.object"
          class="max-w-full truncate font-mono text-xs text-foreground"
          :title="item.object"
        >
          {{ item.object }}
        </code>
        <span class="text-sm text-muted-foreground">{{ item.text }}</span>
      </div>

      <div v-if="item.pod" class="flex flex-wrap gap-1.5">
        <Button type="button" variant="outline" size="sm" @click="emit('open-logs', item.pod)">
          {{ t('infra.kube.report.act.prevLogs') }}
        </Button>
        <Button type="button" variant="outline" size="sm" @click="emit('open-describe', item.pod)">
          {{ t('infra.kube.report.act.describe') }}
        </Button>
        <Button type="button" variant="outline" size="sm" @click="emit('open-terminal', item.pod)">
          {{ t('infra.kube.report.act.terminal') }}
        </Button>
      </div>

      <!-- Lệnh chép được đi CÙNG dòng việc chứ không nằm trong một khối "lệnh gợi
           ý" riêng: nó chỉ có nghĩa với đúng đối tượng ngay phía trên. -->
      <div v-if="item.command" class="flex min-w-0 flex-wrap items-center gap-2">
        <!-- mono-ok: đây là lệnh để dán vào terminal -->
        <code
          class="min-w-0 flex-[1_1_16.25rem] truncate rounded-sm border bg-card px-2 py-1 font-mono text-xs text-foreground"
        >
          {{ item.command }}
        </code>
        <Button
          type="button"
          :title="t('infra.kube.report.act.copyCmd')"
          variant="outline"
          size="sm"
          @click="emit('copy-cmd', item.command)"
        >
          <Icon name="copy" />
          {{ t('infra.kube.report.act.copyCmd') }}
        </Button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { ReportItem } from '~/composables/useInfraKubeReport'
import Button from '~/components/ui/button/Button.vue'

defineProps<{ items: ReportItem[] }>()

const emit = defineEmits<{
  (e: 'open-logs' | 'open-describe' | 'open-terminal', pod: string): void
  (e: 'copy-cmd', command: string): void
}>()

const { t } = useI18n()

const KIND_TONE: Record<string, string> = {
  impact: 'border-destructive/40 bg-destructive/10 text-destructive',
  risk: 'border-warning/40 bg-warning/10 text-warning',
}
</script>
