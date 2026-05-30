<template>
  <div class="flex items-center gap-2">
    <span
      class="text-[0.71em] uppercase tracking-wider font-medium flex-shrink-0"
      :style="{ color: t.textDim, minWidth: '56px' }"
    >
      {{ label }}
    </span>
    <select
      :value="modelValue"
      class="flex-1 rounded px-2 py-1 text-[0.79em]"
      :style="{
        background: t.bgInput,
        border: `1px solid ${t.border}`,
        color: t.text,
        outline: 'none',
      }"
      @change="emit('update:modelValue', ($event.target as HTMLSelectElement).value)"
    >
      <option v-for="o in options" :key="o.value" :value="o.value">{{ o.label }}</option>
    </select>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  label: string
  modelValue: string
  options: { value: string; label: string }[]
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

const { t } = useTheme()
</script>
