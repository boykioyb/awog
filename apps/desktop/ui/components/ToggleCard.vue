<template>
  <button
    class="rounded p-3 text-left transition"
    :style="{
      background: value ? t.bgElevated : t.bgInput,
      border: `1px solid ${value ? t.borderStrong : t.border}`,
    }"
    @click="emit('toggle')"
  >
    <div class="text-[1em] uppercase tracking-wider font-medium mb-1" :style="{ color: t.textDim }">
      {{ label }}
    </div>
    <div class="flex items-center gap-2">
      <span class="w-2 h-2 rounded-full" :style="{ background: value ? '#22c55e' : t.textFaint }" />
      <span class="text-[1em] font-mono" :style="{ color: t.text }">
        {{ value ? 'enabled' : 'disabled' }}
      </span>
    </div>
  </button>
</template>

<script setup lang="ts">
defineProps<{ label: string; value: boolean }>()
const emit = defineEmits<{ toggle: [] }>()
const { t } = useTheme()
</script>
