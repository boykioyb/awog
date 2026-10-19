<template>
  <!-- KHÔNG nền, KHÔNG viền, KHÔNG bo góc: thẻ này nằm TRONG bong bóng user (đã có sẵn
       nền + viền + bo góc của nó), nên thêm một lớp nữa là hai khung lồng nhau — user
       bác đúng ở chỗ đó. Nhiều tin giao trong CÙNG một lượt thì ngăn bằng một vạch mảnh
       + khoảng thở (`[&+&]` = khối này đứng ngay sau một khối cùng loại). -->
  <div class="flex flex-col gap-1.5 [&+&]:mt-2.5 [&+&]:border-t [&+&]:pt-2.5">
    <div class="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
      <Icon :name="icon" class="size-3 shrink-0" />
      <span class="min-w-0 truncate" :title="label">{{ label }}</span>
      <span
        v-if="msg.injection"
        class="ml-auto inline-flex shrink-0 items-center gap-1 rounded-full bg-destructive/12 px-1.5 py-px text-destructive"
        :title="t('sessions.fenced.injectionHint')"
      >
        <Icon name="alert" class="size-3" />
        {{ t('sessions.fenced.injection') }}
      </span>
    </div>
    <div class="text-base leading-(--lh-prose) text-foreground">
      <SessionLinkedText :text="msg.body" />
    </div>
  </div>
</template>

<script setup lang="ts">
// Một tin đến từ NGOÀI phiên (phiên khác gửi, người dùng chuyển tiếp, hoặc PR đang
// theo dõi) hiện thành một thẻ có nhãn nguồn, thay vì đổ nguyên khối hàng rào ra
// transcript (xem utils/fenced-message.ts).
//
// Lời dẫn trong khối là chỉ dẫn cho MODEL — người đọc không dùng được gì từ nó, và nó
// dài gấp mấy lần nội dung thật. Thứ DUY NHẤT trong lời dẫn mà người dùng cần biết là
// cảnh báo "thân tin có thứ giả dạng thẻ hàng rào" (một cú thử injection), nên đúng nó
// được nâng lên thành huy hiệu.
import type { FencedMessage } from '~/utils/fenced-message'

const props = defineProps<{ msg: FencedMessage }>()

const { t } = useI18n()

const icon = computed(() => {
  if (props.msg.kind === 'pr') return 'git'
  if (props.msg.kind === 'user-forward') return 'forward'
  return 'message'
})

// Nguồn đọc được thì nêu tên; không đọc được (lời dẫn đổi câu chữ ở một bản sidecar
// khác) thì vẫn phải có nhãn — một thẻ không tên còn khó hiểu hơn khối thô.
const label = computed(() => {
  const src = props.msg.source
  if (props.msg.kind === 'pr') return src ? `GitHub · ${src}` : t('sessions.fenced.fromPr')
  if (props.msg.kind === 'user-forward') return t('sessions.fenced.fromUser')
  return src ? t('sessions.fenced.fromSession', { title: src }) : t('sessions.fenced.fromUnknown')
})
</script>
