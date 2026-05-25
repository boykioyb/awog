<template>
  <div class="rounded p-2.5" :style="{ background: t.bgElevated, border: `1px solid ${t.border}` }">
    <div
      class="text-[10px] uppercase tracking-wider font-medium mb-1 inline-flex items-center gap-1"
      :style="{ color: t.textDim }"
    >
      <component :is="icon" :size="10" />
      {{ label }}
    </div>
    <div
      class="text-[12px]"
      :style="{
        color: t.text,
        fontFamily: mono ? 'ui-monospace, monospace' : 'inherit',
      }"
    >
      <template v-if="value">{{ value }}</template>
      <span v-else :style="{ color: t.textFaint }">—</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { Component } from 'vue'

withDefaults(
  defineProps<{
    icon: Component
    label: string
    value: string
    mono?: boolean
  }>(),
  { mono: false },
)

const { t } = useTheme()
</script>
