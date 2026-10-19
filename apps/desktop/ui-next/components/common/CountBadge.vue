<template>
  <!-- Badge đếm đè góc trên-phải của một nút icon (chuông thông báo, dải view của
       Explorer…). Cha phải `relative`. Kích thước px CỐ ĐỊNH, không scale theo
       Appearance: hộp 14px + line-height 14px thì số nằm đúng giữa theo chiều dọc;
       ring cắt viên badge khỏi icon bên dưới theo nền thanh (bg-sidebar).
       Màu nền truyền qua `class` (mặc định bg-primary). -->
  <!-- px-ok: badge đếm 14px / chữ 10px cố định -->
  <span
    :class="
      cn(
        'pointer-events-none absolute -top-1 -right-1.5 z-10 grid h-[14px] min-w-[14px] place-items-center rounded-full bg-primary px-1 text-[10px] leading-[14px] font-semibold text-primary-foreground tabular-nums ring-2 ring-sidebar',
        props.class,
      )
    "
  >
    <slot />
  </span>
</template>

<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { cn } from '~/lib/utils'

const props = defineProps<{ class?: HTMLAttributes['class'] }>()
</script>
