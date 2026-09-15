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
      <span v-if="tile.baseline" class="imt-b">{{ tile.baseline }}</span>
      <span v-else-if="tile.note" class="imt-n">{{ tile.note }}</span>
      <span v-else class="imt-n">{{ t('infra.monitoring.tile.noBaseline') }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
// Bốn ô số của màn Giám sát (Mốc 6, 6.3). Component thuần trình bày — mọi con số và
// mốc so sánh đã tính ở `useInfraMetrics`.
//
// Ô CHƯA CÓ NGUỒN NÓI THẲNG LÀ CHƯA CÓ NGUỒN. Hai ô (sẵn sàng 30 ngày, chi phí
// tháng) không có dữ liệu trong mốc này; hiện "0" hoặc "—" trần là để người dùng
// đọc thành một phép đo. Lý do hiện ngay trong ô, không giấu vào tooltip.
import type { MonitorTile } from '~/composables/useInfraMetrics'

defineProps<{ tiles: MonitorTile[] }>()

const { t } = useI18n()
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
