<template>
  <div class="grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-3">
    <div
      v-for="tile in tiles"
      :key="tile.key"
      class="flex min-w-0 flex-col gap-0.5 rounded-xl border bg-card px-3 py-2.5 shadow-sm"
      :class="{ 'border-dashed': tile.state === 'unavailable' }"
    >
      <span class="text-xs text-dim">{{ tile.label }}</span>
      <span class="text-xl font-semibold text-foreground tabular-nums">{{ tile.value }}</span>
      <!-- Mốc so sánh nằm NGAY DƯỚI con số, không phải trong tooltip: một con số trần
           không nói lên điều gì — "p95 = 0,42 s" chỉ có nghĩa khi biết bình thường là bao nhiêu. -->
      <!-- Hai nhánh PHỦ HẾT: `tiles` luôn đặt `baseline` khi chuỗi có điểm và đặt
           `note` khi không. Nhánh thứ ba trước đây gọi một khoá i18n đã bị gỡ, tức
           là nó sẽ in ra chính chuỗi khoá nếu có ngày nào đó với tới được. -->
      <span v-if="tile.baseline" class="text-xs text-faint tabular-nums">{{ tile.baseline }}</span>
      <span v-else-if="tile.note" class="text-xs text-faint">{{ tile.note }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
// Hàng ô số của màn Giám sát. Component thuần trình bày — mọi con số và mốc so sánh
// đã tính ở `useInfraMetrics`, và số lượng ô bám theo bộ biểu đồ của loại tài nguyên
// đang chọn, không còn là một hàng bốn ô cố định.
//
// Ô KHÔNG CÓ SỐ NÓI THẲNG LÀ KHÔNG CÓ SỐ. Một chuỗi không có điểm nào hiện ra là
// "thiếu dữ liệu" kèm viền đứt, KHÔNG phải số 0 — hai thứ đó là hai kết luận khác
// hẳn nhau về hệ thống. Lý do hiện ngay trong ô, không giấu vào tooltip.
import type { MonitorTile } from '~/composables/useInfraMetrics'

defineProps<{ tiles: MonitorTile[] }>()
</script>
