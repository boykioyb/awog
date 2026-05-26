<template>
  <div class="flex-1 flex items-center justify-center h-full">
    <div class="text-center">
      <component
        :is="icon"
        :size="28"
        class="mx-auto mb-2"
        :stroke-width="1.5"
        :style="{ color: t.textFaint }"
      />
      <div class="text-sm" :style="{ color: t.textDim }">{{ title }}</div>
      <div v-if="description" class="text-xs mt-1" :style="{ color: t.textFaint }">
        {{ description }}
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  icon: unknown
  title: string
  description?: string
}>()

const { t } = useTheme()
</script>
