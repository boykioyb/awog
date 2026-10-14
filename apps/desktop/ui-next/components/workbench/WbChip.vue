<template>
  <!-- Status-bar chip (sbi): 20px inline button, accent khi `.on`.
       NGOẠI LỆ trong workbench-ui rule: `<button>` thô — Button iconSm 28px
       quá cao cho status bar 26px. Dùng chung cho mọi chip ở
       WorkbenchStatusBar + status bar khác. -->
  <button
    class="wb-chip"
    :class="{ on: active }"
    :title="title"
    :disabled="disabled"
    v-bind="$attrs"
  >
    <slot />
  </button>
</template>

<script setup lang="ts">
defineOptions({ inheritAttrs: false })
defineProps<{
  title?: string
  active?: boolean
  disabled?: boolean
}>()
</script>

<style scoped>
.wb-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 20px;
  padding: 0 7px;
  border: 0;
  background: transparent;
  border-radius: var(--r-xs);
  color: inherit;
  font: inherit;
  cursor: pointer;
  white-space: nowrap;
  flex: none;
}
.wb-chip:hover {
  background: var(--bgHover);
  color: var(--text);
}
.wb-chip.on {
  color: var(--accent);
}
.wb-chip:disabled {
  opacity: 0.5;
  cursor: default;
}
</style>
