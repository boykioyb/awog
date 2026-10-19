<template>
  <!-- Hộp chọn LOẠI cho một bản báo cáo agent vừa viết (mốc 6.6 — điểm nối còn hở).
       Một host duy nhất: bên gọi nó là transcript, mà transcript có mặt ở cả cửa sổ
       chính lẫn cửa sổ phiên tách rời (AppGlobalHosts được mount ở cả hai).

       Hộp này KHÔNG sửa một chữ nào của bản báo cáo — nó chỉ trả lời "đây là loại
       nào", thứ mà transcript không mang theo. Sau khi chốt thì đóng hẳn và nhường
       cho hộp xuất, nơi có xem trước + lưu Wiki + gửi chat + xuất tệp. -->
  <Dialog :open="open" @update:open="(v) => !v && closeReportPublish()">
    <DialogContent class="gap-2.5 sm:max-w-xl">
      <DialogHeader>
        <DialogTitle class="flex items-center gap-2 text-base">
          <Icon name="file" class="size-4 flex-none text-primary" />
          {{ t('infra.report.publish.title') }}
        </DialogTitle>
        <DialogDescription class="leading-relaxed text-dim">
          {{ t('infra.report.publish.subtitle') }}
        </DialogDescription>
      </DialogHeader>

      <!-- Tiêu đề + độ dài: hai thứ duy nhất hộp này lấy từ lượt trả lời, nói ra
           để người dùng nhận ra mình đang cầm đúng bản nào. -->
      <div class="flex min-w-0 items-baseline gap-2 rounded-md border bg-muted px-2.5 py-2">
        <span class="min-w-0 flex-auto truncate text-sm text-foreground">
          {{ pending?.title }}
        </span>
        <span class="flex-none text-xs text-faint tabular-nums">
          {{ t('infra.report.publish.size', { n: pending?.body.length ?? 0 }) }}
        </span>
      </div>

      <p v-if="!sidecar.available" class="m-0 text-sm text-dim">
        {{ t('infra.report.noSidecar') }}
      </p>
      <p v-else-if="!kinds.length" class="m-0 text-sm text-dim">
        {{ t('infra.report.publish.loading') }}
      </p>

      <div v-else class="grid grid-cols-2 gap-2">
        <Button
          v-for="k in kinds"
          :key="k.kind"
          variant="outline"
          class="h-auto flex-col items-start gap-1 rounded-xl bg-card px-3 py-2.5 text-left whitespace-normal text-muted-foreground hover:border-selected-border"
          type="button"
          @click="chooseReportKind(k.kind)"
        >
          <span class="text-sm font-medium text-foreground">{{ t(k.labelKey) }}</span>
          <span class="text-xs leading-relaxed font-normal text-dim">{{ t(k.aboutKey) }}</span>
        </Button>
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" @click="closeReportPublish">
          {{ t('common.cancel') }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

<script setup lang="ts">
// Hộp chọn loại báo cáo trước khi xuất. Danh mục loại do SIDECAR cấp
// (`infra.report-kinds`, cùng nguồn với nhịp chạy) — màn này không tự khai loại thứ
// năm, đúng luật của `InfraReports.vue`.
import { onMounted } from 'vue'
import { useInfraReportPublish } from '~/composables/useInfraReportPublish'
import { useShareExport } from '~/composables/useShareExport'
import { useSidecar } from '~/composables/useSidecar'
import Button from '~/components/ui/button/Button.vue'

const { t } = useI18n()
const sidecar = useSidecar()
const { open, pending, chooseReportKind, closeReportPublish } = useInfraReportPublish()
const { kinds, loadReportKinds } = useShareExport()

onMounted(() => void loadReportKinds())

// Trạng thái mở nằm ở MỌC MODULE nên listener phải hỏi `open` chứ không thể dựa vào
// vòng đời của component này.
useEscToClose(
  () => open.value,
  () => closeReportPublish(),
)
</script>
