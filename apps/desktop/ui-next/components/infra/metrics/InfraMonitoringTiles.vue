<template>
  <div class="imt">
    <div
      v-for="tile in tiles"
      :key="tile.key"
      class="tile imt-t"
      :class="{ off: tile.state === 'unavailable' }"
    >
      <span class="imt-k">{{ tile.label }}</span>
      <span class="imt-v">{{ tile.value }}</span>
      <!-- Mốc so sánh nằm NGAY DƯỚI con số, không phải trong tooltip: một con số trần
           không nói lên điều gì — "p95 = 0,42 s" chỉ có nghĩa khi biết bình thường là bao nhiêu. -->
      <!-- Hai nhánh PHỦ HẾT: `tiles` luôn đặt `baseline` khi chuỗi có điểm và đặt
           `note` khi không. Nhánh thứ ba trước đây gọi một khoá i18n đã bị gỡ, tức
           là nó sẽ in ra chính chuỗi khoá nếu có ngày nào đó với tới được. -->
      <span v-if="tile.baseline" class="imt-b">{{ tile.baseline }}</span>
      <span v-else-if="tile.note" class="imt-n">{{ tile.note }}</span>
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

<style scoped>
.imt {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 10px;
}

.imt-t {
  gap: 2px;
  padding: 10px 12px;
}

.imt-t.off {
  border-style: dashed;
}

.imt-k {
  color: var(--textDim);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
}

.imt-v {
  color: var(--text);
  font-size: var(--fs-xl);
  line-height: var(--lh-xl);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.imt-b {
  color: var(--textFaint);
  font-size: var(--fs-xs);
  line-height: var(--lh-xs);
  font-variant-numeric: tabular-nums;
}

.imt-n {
  color: var(--textFaint);
  font-size: var(--fs-xs);
  line-height: var(--lh-sm);
}
</style>
