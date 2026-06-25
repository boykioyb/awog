<template>
  <div class="rounded-xl px-3.5 py-3" :style="elevated">
    <div
      class="text-[12px] uppercase tracking-wider font-mono font-medium mb-1.5 inline-flex items-center gap-1.5"
      :style="{ color: t.textDim }"
    >
      <component :is="icon" :size="12" />
      {{ label }}
    </div>
    <div
      class="text-[1em] truncate"
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
const { elevated } = useGlass()
</script>
