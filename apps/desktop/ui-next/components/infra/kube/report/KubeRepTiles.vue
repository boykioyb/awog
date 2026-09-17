<template>
  <!-- Lưới ô số của màn Báo cáo. Ba khối (khối lượng chạy · tài nguyên · node) đều
       hiện số theo cùng một hình dạng, nên hình dạng đó sống ở ĐÂY — ba bản copy
       trong ba khối là ba chỗ để lệch nhau.

       Màu đi theo `rate` của từng ô, không theo cả khối: trong cùng một hàng, "13/13
       pod sẵn sàng" là tin tốt còn "2 lần khởi động lại" là tin phải xem — tô cả
       hàng một màu là bắt người đọc tự tách lại. -->
  <div class="ikrt">
    <div v-for="tile in tiles" :key="tile.key" class="ikrt-i" :class="`rt-${tile.rate ?? 'none'}`">
      <span class="ikrt-k">{{ tile.label }}</span>
      <span class="ikrt-v">{{ tile.value }}</span>
      <span v-if="tile.sub" class="ikrt-s">{{ tile.sub }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { KubeRepTile } from '~/composables/useInfraKubeReport'

defineProps<{ tiles: KubeRepTile[] }>()
</script>

<style scoped>
/* Ô số nằm TRONG card của khối (`.ikrep-sec.icard`), nên chúng KHÔNG có khung
   riêng: ở theme sáng `--bgEl` == `--bgPanel`, một hàng ô viền trong một card
   viền là hai khung lồng nhau quanh cùng một nền trắng. Ranh giới giữa các ô do
   khoảng cách lo; "ô này có chuyện" do MÀU SỐ nói — cùng cách một bảng điều khiển
   bình thường làm. */
.ikrt {
  display: flex;
  gap: 8px 24px;
  flex-wrap: wrap;
}
.ikrt-i {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 124px;
  flex: 1 1 124px;
}
.ikrt-k {
  color: var(--textMuted);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
}
.ikrt-v {
  color: var(--text);
  font-size: var(--fs-xl);
  font-weight: 600;
  line-height: var(--lh-xl);
  font-variant-numeric: tabular-nums;
}
.rt-warn .ikrt-v {
  color: var(--amber);
}
.rt-bad .ikrt-v {
  color: var(--danger);
}
.rt-ok .ikrt-v {
  color: var(--green);
}
.ikrt-s {
  color: var(--textFaint);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
}
</style>
