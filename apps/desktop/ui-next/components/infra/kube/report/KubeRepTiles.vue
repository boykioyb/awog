<template>
  <!-- Lưới ô số của màn Báo cáo. Ba khối (khối lượng chạy · tài nguyên · node) đều
       hiện số theo cùng một hình dạng, nên hình dạng đó sống ở ĐÂY — ba bản copy
       trong ba khối là ba chỗ để lệch nhau.

       Màu đi theo `rate` của từng ô, không theo cả khối: trong cùng một hàng, "13/13
       pod sẵn sàng" là tin tốt còn "2 lần khởi động lại" là tin phải xem — tô cả
       hàng một màu là bắt người đọc tự tách lại.

       Ô số nằm TRONG card của khối nên KHÔNG có khung riêng: một hàng ô viền trong
       một card viền là hai khung lồng nhau quanh cùng một nền. Ranh giới giữa các ô
       do khoảng cách lo; "ô này có chuyện" do MÀU SỐ nói. -->
  <div class="flex flex-wrap gap-x-6 gap-y-2">
    <div
      v-for="tile in tiles"
      :key="tile.key"
      class="flex min-w-31 flex-[1_1_7.75rem] flex-col gap-0.5"
    >
      <span class="text-xs text-muted-foreground">{{ tile.label }}</span>
      <span
        class="text-xl font-semibold tabular-nums"
        :class="RATE_TEXT[tile.rate ?? 'none'] ?? 'text-foreground'"
      >
        {{ tile.value }}
      </span>
      <span v-if="tile.sub" class="text-xs text-faint">{{ tile.sub }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { KubeRepTile } from '~/composables/useInfraKubeReport'

defineProps<{ tiles: KubeRepTile[] }>()

const RATE_TEXT: Record<string, string> = {
  ok: 'text-success',
  warn: 'text-warning',
  bad: 'text-destructive',
}
</script>
