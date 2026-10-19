<template>
  <!-- Khung danh sách whitelist dùng chung cho 4 picker của agent (skills / tools / MCP /
       repo). Cột auto-fill: một cột dài lãng phí bề ngang trên màn rộng (catalogue skill
       có tới hàng trăm dòng). -->
  <div
    class="grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] content-start gap-0.5 rounded-lg border bg-muted p-1.5"
  >
    <slot />
    <div v-if="isEmpty" class="col-span-full py-3 text-center text-sm text-faint">
      {{ emptyText }}
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{ isEmpty: boolean; emptyText: string }>()
</script>
