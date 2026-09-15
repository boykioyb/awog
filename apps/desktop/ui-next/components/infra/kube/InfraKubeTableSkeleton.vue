<template>
  <!-- Khung xương của bảng Pods/Deployments trong lúc nạp.
       Vì sao cần: thân bảng trước đây để TRỐNG khi đang nạp, nên một lần nạp chậm
       trông y hệt "không có pod nào" — người dùng không phân biệt được "đang chờ"
       với "rỗng", và đó là lý do họ bấm ↻ liên tục.
       Hình dạng bám theo bảng thật (một cột tên rộng + bốn cột số) để lúc dữ liệu
       về không bị nhảy bố cục. -->
  <div class="iks" role="status" aria-busy="true" :aria-label="t('infra.kube.loading')">
    <div v-for="row in ROWS" :key="row" class="iksrow">
      <div class="iksbar iksname" :style="{ width: `${nameWidth(row)}%` }" />
      <div v-for="(w, i) in CELLS" :key="i" class="iksbar ikscell" :style="{ width: `${w}px` }" />
    </div>
  </div>
</template>

<script setup lang="ts">
const { t } = useI18n()

// Số hàng = chiều cao một màn bảng thật; độ rộng lệch nhau để khung trông "thật"
// chứ không phải một loạt ô vuông giống hệt.
const ROWS = 7
const CELLS: readonly number[] = [48, 76, 32, 40]

function nameWidth(row: number): number {
  return [46, 38, 52, 34, 44, 40, 30][(row - 1) % 7] ?? 40
}
</script>

<style scoped>
.iks {
  display: flex;
  flex-direction: column;
}
.iksrow {
  display: flex;
  align-items: center;
  gap: 24px;
  padding: 10px;
  border-bottom: 1px solid var(--border);
}
/* Nhịp thở nhẹ: đủ để mắt thấy "đang chạy", không đủ để gây sốt ruột. */
.iksbar {
  height: 10px;
  border-radius: var(--r-xs);
  background: linear-gradient(90deg, var(--bgHover) 25%, var(--bgActive) 50%, var(--bgHover) 75%);
  background-size: 200% 100%;
  animation: iks-shimmer 1.5s ease-in-out infinite;
}
.iksname {
  flex: 0 0 auto;
}
/* Bốn ô số cùng chia khoảng trống còn lại (mỗi ô tự đẩy sang phải), nên nhóm số
   trải ngang gần giống bảng thật — lúc dữ liệu về bảng không nhảy bố cục. */
.ikscell {
  flex: 0 0 auto;
  margin-left: auto;
}
@keyframes iks-shimmer {
  0% {
    background-position: 200% 0;
  }
  100% {
    background-position: -200% 0;
  }
}
@media (prefers-reduced-motion: reduce) {
  .iksbar {
    animation: none;
    background: var(--bgHover);
  }
}
</style>
