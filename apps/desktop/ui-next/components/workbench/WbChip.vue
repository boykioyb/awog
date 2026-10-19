<template>
  <!-- Status-bar chip (sbi): 20px inline button, accent khi `active`. Dùng chung cho
       mọi chip ở WorkbenchStatusBar + status bar khác. -->
  <!-- raw-ok: NGOẠI LỆ của workbench-ui rule — Button iconSm 28px quá cao cho status bar 26px -->
  <button
    class="inline-flex h-5 flex-none cursor-pointer items-center gap-1 whitespace-nowrap rounded-sm border-0 bg-transparent px-1.5 [font:inherit] hover:bg-accent hover:text-foreground disabled:cursor-default disabled:opacity-50"
    :class="active ? 'text-primary' : 'text-inherit'"
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
