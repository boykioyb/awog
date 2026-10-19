<template>
  <!-- data-set-row / data-set-label: hook cho SettingsModal (⌘K cuộn tới đúng dòng). -->
  <div
    data-set-row
    class="flex border-t py-3 first-of-type:border-t-0"
    :class="block ? 'flex-col items-stretch gap-2 [&>*:last-child]:w-full' : 'items-center gap-4'"
  >
    <div class="min-w-0 flex-1">
      <div data-set-label class="text-base font-medium">
        <slot name="name">{{ name }}</slot>
      </div>
      <div v-if="desc || $slots.desc" class="mt-0.5 text-sm text-muted-foreground">
        <slot name="desc">{{ desc }}</slot>
      </div>
    </div>
    <slot />
  </div>
</template>

<script setup lang="ts">
// Một dòng cài đặt: nhãn + mô tả muted bên trái, control ở default slot bên phải.
// `block` xếp control xuống dưới nhãn và kéo full-width (textarea / picker).
withDefaults(
  defineProps<{
    name?: string
    desc?: string
    block?: boolean
  }>(),
  { name: '', desc: '', block: false },
)
</script>
