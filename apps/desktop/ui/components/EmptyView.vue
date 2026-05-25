<template>
  <div class="flex-1 flex items-center justify-center">
    <div class="text-center max-w-md">
      <div
        class="w-12 h-12 mx-auto mb-4 rounded-lg flex items-center justify-center"
        :style="{ background: t.bgElevated, border: `1px solid ${t.border}` }"
      >
        <component :is="icon" :size="20" :style="{ color: t.textMuted }" />
      </div>
      <h2 class="text-base font-semibold mb-1" :style="{ color: t.text }">
        {{ title }}
      </h2>
      <p class="text-sm" :style="{ color: t.textMuted }">{{ description }}</p>
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  icon: unknown
  title: string
  description: string
}>()

const { t } = useTheme()
</script>
