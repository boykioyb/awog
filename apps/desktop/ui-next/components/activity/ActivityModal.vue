<template>
  <Dialog :open="open" @update:open="(v) => !v && closeActivity()">
    <!-- Modal phân tích một pane — rộng hơn modal mặc định để 3 thẻ và bảng 7 cột theo
         model có chỗ. Nút đóng mặc định của DialogContent bị ẩn: dùng nút riêng có
         tooltip i18n. -->
    <DialogContent
      class="flex h-[84vh] w-260 max-w-[94vw] flex-col gap-0 overflow-hidden bg-popover p-0 sm:max-w-[94vw] sm:rounded-xl [&>button:last-child]:hidden"
    >
      <DialogTitle class="sr-only">{{ t('activity.title') }}</DialogTitle>
      <div class="flex shrink-0 justify-end px-3 pt-2.5">
        <Button
          :title="t('common.close')"
          :aria-label="t('common.close')"
          variant="outline"
          size="iconSm"
          @click="closeActivity"
        >
          <Icon name="x" />
        </Button>
      </div>
      <!-- Vùng cuộn; kéo lên -1.5 để tiêu đề của ActivityView nằm ngang nút đóng. -->
      <div class="-mt-1.5 min-h-0 flex-auto overflow-y-auto px-5 pb-5.5">
        <ActivityView v-if="open" />
      </div>
    </DialogContent>
  </Dialog>
</template>

<script setup lang="ts">
// Activity dạng modal (Dialog shadcn) — mở từ footer sidebar, giống SettingsModal.
// Nội dung nằm ở ActivityView; đây chỉ là vỏ: dải nút đóng + thân cuộn. ActivityView
// đã có tiêu đề + bộ lọc nên dải trên chỉ giữ nút đóng. ActivityView chỉ mount khi
// `open` để useActivity (fetch sidecar) chỉ chạy lúc modal hiện. Esc / bấm nền do
// Dialog lo.
const { t } = useI18n()
const { open, closeActivity } = useActivityModal()
</script>
