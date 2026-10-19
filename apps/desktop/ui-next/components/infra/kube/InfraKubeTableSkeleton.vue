<template>
  <!-- Khung xương của bảng Pods/Deployments trong lúc nạp.
       Vì sao cần: thân bảng trước đây để TRỐNG khi đang nạp, nên một lần nạp chậm
       trông y hệt "không có pod nào" — người dùng không phân biệt được "đang chờ"
       với "rỗng", và đó là lý do họ bấm ↻ liên tục.
       Hình dạng bám theo bảng thật (một cột tên rộng + bốn cột số) để lúc dữ liệu
       về không bị nhảy bố cục. -->
  <div class="flex flex-col" role="status" aria-busy="true" :aria-label="t('infra.kube.loading')">
    <div v-for="row in ROWS" :key="row" class="flex items-center gap-6 border-b p-2.5">
      <Skeleton class="h-2.5 shrink-0 rounded-sm" :style="{ width: `${nameWidth(row)}%` }" />
      <!-- Bốn ô số cùng chia khoảng trống còn lại (mỗi ô tự đẩy sang phải), nên nhóm
           số trải ngang gần giống bảng thật — lúc dữ liệu về bảng không nhảy bố cục. -->
      <Skeleton
        v-for="(w, i) in CELLS"
        :key="i"
        class="ml-auto h-2.5 shrink-0 rounded-sm"
        :style="{ width: `${w}px` }"
      />
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
