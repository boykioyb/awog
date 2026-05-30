<template>
  <button
    class="w-full rounded px-3 py-2 text-left flex items-center justify-between transition"
    :style="{
      background: t.bgInput,
      border: `1px solid ${t.border}`,
    }"
    @click="emit('update:modelValue', !modelValue)"
  >
    <span class="text-[0.79em]" :style="{ color: t.textDim }">{{ label }}</span>
    <span class="text-[0.79em] font-mono inline-flex items-center gap-1.5" :style="{ color: t.text }">
      <span
        class="w-2 h-2 rounded-full"
        :style="{ background: modelValue ? '#22c55e' : t.textFaint }"
      />
      {{ modelValue ? 'on' : 'off' }}
    </span>
  </button>
</template>

<script setup lang="ts">
defineProps<{ modelValue: boolean; label: string }>()
const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>()
const { t } = useTheme()
</script>
