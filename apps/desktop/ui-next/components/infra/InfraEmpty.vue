<template>
  <!-- Trạng thái rỗng CHẶN ĐƯỜNG — dùng cho những ô trống mà người dùng phải làm gì
       đó mới đi tiếp được (chưa chọn profile, chưa có cảnh báo nào…).

       KHÔNG dùng cho ô trống lành tính ("không có lần chạy nào thất bại", "không có
       sự kiện trong khoảng này"): ở đó rỗng CHÍNH LÀ câu trả lời, và treo một nút
       hành động lên nó là bịa ra một việc phải làm.

       Luật 6 của infra-README: nói ra vấn đề thì phải nói luôn cách sửa, và cách sửa
       phải bấm được. Trước 2026-09-16 mỗi màn tự viết một câu, nên cùng một vấn đề
       "chưa chọn profile" có ba lời khuyên khác nhau và BA trong số đó chỉ sang
       "Cài đặt → Hạ tầng" — một màn mà lúc đó không tồn tại, và nay tồn tại nhưng là
       màn ma trận quyền, không phải chỗ chọn profile. -->
  <div class="flex flex-col items-start gap-1.5 py-3">
    <p class="m-0 text-base text-foreground">{{ title }}</p>
    <p v-if="hint" class="m-0 max-w-[62ch] text-sm leading-relaxed text-dim">{{ hint }}</p>
    <Button
      v-if="action && actionLabel"
      type="button"
      class="mt-0.5"
      variant="default"
      size="sm"
      @click="onAction"
    >
      {{ actionLabel }}
    </Button>
  </div>
</template>

<script setup lang="ts">
// Ô trống + một cú bấm đưa tới đúng chỗ sửa được nó.
import { useInfraTabOpen, type InfraTab } from '~/composables/useInfraTabOpen'
import Button from '~/components/ui/button/Button.vue'

const props = defineProps<{
  title: string
  hint?: string
  /** Tab sẽ mở khi bấm. Vắng ⇒ không có nút (ô trống không sửa được từ đây). */
  action?: InfraTab
  actionLabel?: string
}>()

const { request } = useInfraTabOpen()

function onAction(): void {
  if (props.action) request(props.action)
}
</script>
