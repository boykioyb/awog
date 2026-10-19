<template>
  <PopoverRoot v-model:open="open">
    <PopoverTrigger as-child>
      <slot />
    </PopoverTrigger>
    <!-- v-if: phần thân (ô tìm, tab, lưới emoji) chỉ dựng khi mở. Mỗi tin nhắn có một
         picker; dựng sẵn cả trăm cái lưới chỉ để chờ một cái được bấm là phí. -->
    <PopoverPortal v-if="open">
      <PopoverContent
        data-slack-overlay
        side="top"
        align="end"
        :side-offset="6"
        class="z-180 flex h-90 w-80 flex-col gap-2 rounded-lg border border-border bg-popover p-2 text-popover-foreground shadow-md"
        @open-auto-focus.prevent
      >
        <SlackEmojiPickerPanel :team-id="teamId" :custom-url="customUrl" @pick="pick" />
      </PopoverContent>
    </PopoverPortal>
  </PopoverRoot>
</template>

<script setup lang="ts">
// Nút mở bảng chọn emoji cho reaction. Nội dung bảng ở SlackEmojiPickerPanel.
// Khung CAO CỐ ĐỊNH (h-90 = 360px): trước đây cao theo nội dung ⇒ đổi sang tab rỗng
// (Tuỳ chỉnh không có emoji) làm khung co lại và reka lật popover trên/dưới loạn xạ.
import { ref } from 'vue'
import { PopoverContent, PopoverPortal, PopoverRoot, PopoverTrigger } from 'reka-ui'

defineProps<{ teamId: string; customUrl: (name: string) => string | null }>()
const emit = defineEmits<{ pick: [name: string] }>()

const open = ref(false)

function pick(name: string): void {
  emit('pick', name)
  open.value = false
}
</script>
