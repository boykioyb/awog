<template>
  <!-- Chỉ báo trạng thái phiên cho hàng gọn (Explorer Sessions, popover ▾, ⌘K).
       Ô cố định 14px để tiêu đề các hàng thẳng cột dù trạng thái là chấm hay icon.
       Mỗi trạng thái một HÌNH khác nhau, không chỉ khác màu: trước đây "xong" và
       "chưa đọc" cùng là chấm xanh 7px, còn "đang chờ" dùng chung spinner với
       "đang chạy" ⇒ không đọc được list. Key theo trạng thái ⇒ đổi trạng thái có
       hiệu ứng nảy (pop) để mắt bắt được phiên vừa xong. -->
  <span
    class="relative inline-flex size-3.5 flex-none items-center justify-center"
    role="img"
    :aria-label="label"
    :title="label"
  >
    <!-- Thời lượng khai TƯỜNG MINH: phần tử rời đi (spinner) mang animation vô hạn,
         để Vue tự đo thì nó lấy chu kỳ dài nhất (1.6s) làm thời lượng rời ⇒ ô trống
         hơn một giây ngay lúc phiên vừa xong. -->
    <Transition name="ssd-swap" mode="out-in" :duration="{ enter: 320, leave: 100 }">
      <!-- Đang chạy: cung xoay + quầng thở. px-ok: nét vòng 1.5px là hình vẽ. -->
      <span
        v-if="state === 'streaming'"
        key="streaming"
        class="ssd-run box-border size-2.5 rounded-full border-[1.5px] border-current border-t-transparent text-primary"
      />
      <span
        v-else-if="state === 'awaiting'"
        key="awaiting"
        class="ssd-ping relative inline-flex rounded-full text-warning"
      >
        <CircleHelp class="size-3.5 stroke-[2.25]" />
      </span>
      <span
        v-else-if="state === 'error'"
        key="error"
        class="relative inline-flex rounded-full text-destructive"
        :class="{ 'ssd-ping': props.unread }"
      >
        <CircleX class="size-3.5 stroke-[2.25]" />
      </span>
      <!-- Chưa đọc: chấm đặc + vòng loang. -->
      <span
        v-else-if="state === 'unread'"
        key="unread"
        class="ssd-ping relative size-2 rounded-full bg-success text-success"
      />
      <!-- Đã đọc: vòng rỗng mờ — "xong rồi, không có gì mới". Nháp: vòng đứt nét.
           px-ok: nét vòng 1.5px là hình vẽ. -->
      <span
        v-else-if="state === 'read'"
        key="read"
        class="box-border size-2 rounded-full border-[1.5px] border-faint opacity-70"
      />
      <span
        v-else
        key="idle"
        class="box-border size-2 rounded-full border-[1.5px] border-dashed border-faint opacity-50"
      />
    </Transition>
  </span>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { CircleHelp, CircleX } from 'lucide-vue-next'
import type { SessionStatus } from '~/composables/useSessionsData'
import { useI18n } from '~/composables/useI18n'

const props = withDefaults(defineProps<{ status: SessionStatus; unread?: boolean }>(), {
  unread: false,
})

const { t } = useI18n()

// `done` tách đôi theo đã đọc/chưa đọc — đó là thông tin duy nhất còn đáng nhìn ở
// một phiên đã xong (mọi phiên có tin nhắn đều là `done` sau khi khởi động lại).
const state = computed(() => {
  if (props.status === 'done') return props.unread ? 'unread' : 'read'
  return props.status
})

const label = computed(() => {
  const base = t(`sessions.status.${props.status}`)
  return props.unread ? `${base} · ${t('sessions.item.unread')}` : base
})
</script>

<style scoped>
/* style-ok: keyframes riêng (xoay + thở, vòng loang, nảy) không có trong tw-animate-css;
   vòng loang là `::after` lấy màu từ currentColor (đặt bằng class text-* ở template);
   `.ssd-swap-*` là class do <Transition name="ssd-swap"> sinh ra. */
.ssd-run {
  animation:
    ssd-spin 0.8s linear infinite,
    ssd-glow 1.6s ease-in-out infinite;
}

/* Vòng loang — báo "có việc cho bạn" (chưa đọc / đang chờ / lỗi chưa xem). */
.ssd-ping::after {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: 50%;
  box-shadow: 0 0 0 0 color-mix(in srgb, currentColor 60%, transparent);
  animation: ssd-ping 1.6s ease-out infinite;
}

/* Đổi trạng thái: nảy lên từ nhỏ. */
.ssd-swap-enter-active {
  animation: ssd-pop 0.32s cubic-bezier(0.34, 1.56, 0.64, 1);
}
.ssd-swap-leave-active {
  transition:
    opacity 0.1s ease,
    transform 0.1s ease;
}
.ssd-swap-leave-to {
  opacity: 0;
  transform: scale(0.5);
}

@keyframes ssd-spin {
  to {
    rotate: 360deg;
  }
}
@keyframes ssd-glow {
  0%,
  100% {
    box-shadow: 0 0 0 0 color-mix(in srgb, currentColor 0%, transparent);
  }
  50% {
    box-shadow: 0 0 0 3px color-mix(in srgb, currentColor 22%, transparent);
  }
}
@keyframes ssd-ping {
  0% {
    box-shadow: 0 0 0 0 color-mix(in srgb, currentColor 60%, transparent);
  }
  70%,
  100% {
    box-shadow: 0 0 0 6px color-mix(in srgb, currentColor 0%, transparent);
  }
}
@keyframes ssd-pop {
  0% {
    opacity: 0;
    transform: scale(0.3);
  }
  100% {
    opacity: 1;
    transform: scale(1);
  }
}

@media (prefers-reduced-motion: reduce) {
  .ssd-run {
    animation: ssd-spin 1.6s linear infinite;
  }
  .ssd-ping::after,
  .ssd-swap-enter-active {
    animation: none;
  }
}
</style>
