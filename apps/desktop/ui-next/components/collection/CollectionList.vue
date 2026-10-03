<template>
  <!-- List-grid dùng chung (khuôn Multica ListGrid): header label mảnh sticky
       + body cuộn. Parent truyền `cols` (grid-template-columns) MỘT lần —
       header và mọi `.cl-row` slot cùng ăn var(--cl-cols). Row là 2-line
       identity 64px: [avatar | name+desc] | ...cột phụ... | kebab. -->
  <div class="cl" :style="{ '--cl-cols': cols }">
    <div v-if="$slots.head" class="cl-head">
      <slot name="head" />
    </div>
    <div class="cl-body">
      <slot />
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  // grid-template-columns — vd '24px minmax(220px,1fr) 140px 28px'
  cols: string
}>()
</script>

<style scoped>
.cl {
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-height: 0;
}
.cl-head {
  display: grid;
  grid-template-columns: var(--cl-cols);
  column-gap: 12px;
  align-items: center;
  padding: 0 16px;
  height: 34px;
  flex: 0 0 auto;
  border-bottom: 1px solid var(--border);
  background: var(--background);
  position: sticky;
  top: 0;
  z-index: 2;
}
.cl-head :slotted(> *) {
  font-size: 11px;
  font-weight: 500;
  color: var(--muted-foreground);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.cl-body {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  scrollbar-width: thin;
}
/* Row — định nghĩa ở đây để mọi page dùng chung qua slot. */
.cl-body :slotted(.cl-row) {
  display: grid;
  grid-template-columns: var(--cl-cols);
  column-gap: 12px;
  align-items: center;
  height: 64px;
  padding: 0 16px;
  border-bottom: 1px solid var(--border);
  cursor: pointer;
  transition: background 0.1s ease;
}
.cl-body :slotted(.cl-row:hover) {
  background: var(--accent-wash);
}
.cl-body :slotted(.cl-row.cur) {
  background: rgb(from var(--primary) r g b / 10%);
}
/* Các cell con co giãn + truncate mặc định. */
.cl-body :slotted(.cl-cell) {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--fs-sm);
  color: var(--muted-foreground);
  display: flex;
  align-items: center;
  gap: 8px;
}
</style>
