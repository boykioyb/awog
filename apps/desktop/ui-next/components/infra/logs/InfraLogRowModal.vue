<template>
  <!-- Dialog shadcn (reka) — tự portal ra body, khoá focus, Esc/bấm nền là đóng.
       `[role=dialog][data-state=open]` đã có trong OVERLAYS của trình duyệt nhúng. -->
  <Dialog :open="row !== null" @update:open="(v: boolean) => !v && emit('close')">
    <DialogContent
      v-if="row"
      class="flex max-h-[78vh] w-[calc(100vw-2rem)] max-w-225 flex-col gap-2.5 px-4 pt-3.5 pb-3 sm:rounded-xl"
    >
      <DialogHeader class="shrink-0 flex-row items-center gap-2 pr-8">
        <Icon name="file" class="size-3.5" />
        <DialogTitle class="text-base font-semibold">{{ t('infra.logs.row.title') }}</DialogTitle>
        <!-- mono-ok: mốc thời gian của CloudWatch, người dùng dán lại vào query -->
        <span v-if="stamp" class="flex-auto font-mono text-xs text-dim tabular-nums">
          {{ stamp }}
        </span>
      </DialogHeader>

      <InfraLogRowDetail
        :row="row"
        :copied="copied"
        @copy="emit('copy', $event)"
        @send-to-chat="emit('send-to-chat', $event)"
        @trace="emit('trace', $event)"
      >
        <template #actions>
          <span class="flex-auto" />
          <Button type="button" variant="outline" @click="emit('close')">
            {{ t('infra.logs.results.close') }}
          </Button>
        </template>
      </InfraLogRowDetail>
    </DialogContent>
  </Dialog>
</template>

<script setup lang="ts">
// Chi tiết MỘT dòng log trong một cửa sổ riêng — tuỳ chọn `pane` của hộp Tuỳ chọn.
//
// Trước 2026-09-17 khối này nằm inline dưới bảng và KHÔNG có cách nào đổi: nó ăn
// chiều cao của chính bảng đang đọc. Nay mở-trong-bảng là một lựa chọn ngang hàng
// (`inline`), còn đây là lựa chọn mặc định vì nó trả lại toàn bộ chiều cao cho bảng.
//
// Phần thân nằm ở `InfraLogRowDetail` dùng chung với chế độ inline.
import InfraLogRowDetail from '~/components/infra/logs/InfraLogRowDetail.vue'
import type { AwsInsightsRow } from '~/composables/useAwsLogsApi'
import Button from '~/components/ui/button/Button.vue'

const props = defineProps<{
  /** `null` = đóng. Truyền cả dòng chứ không chỉ id: bảng đã có sẵn dữ liệu. */
  row: AwsInsightsRow | null
  copied?: boolean
}>()

const emit = defineEmits<{
  close: []
  copy: [text: string]
  'send-to-chat': [text: string]
  trace: [id: string]
}>()

const { t } = useI18n()

useEscToClose(
  computed(() => props.row !== null),
  () => emit('close'),
)

const stamp = computed(() => props.row?.['@timestamp'] ?? '')
</script>
