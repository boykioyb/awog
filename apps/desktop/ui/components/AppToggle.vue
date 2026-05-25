<template>
  <button
    class="relative w-9 h-5 rounded-full transition"
    :style="{
      background: modelValue ? t.accent : t.bgInput,
      border: `1px solid ${modelValue ? t.accent : t.borderStrong}`,
    }"
    @click="emit('update:modelValue', !modelValue)"
  >
    <div
      class="absolute top-0.5 w-3.5 h-3.5 rounded-full transition-all"
      :style="{
        left: modelValue ? '18px' : '2px',
        background: modelValue ? t.accentText : t.textMuted,
      }"
    />
  </button>
</template>

<script setup lang="ts">
defineProps<{
  modelValue: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
}>()

const { t } = useTheme()
</script>
