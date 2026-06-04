<template>
  <div class="flex items-center gap-2">
    <!-- 0.857em ≈ 12px at the default 14px base; scales with the appearance font setting. -->
    <span
      class="text-[0.857em] uppercase tracking-wider font-medium flex-shrink-0 whitespace-nowrap"
      :style="{ color: t.textDim, width: '6rem' }"
    >
      {{ label }}
    </span>
    <!-- Wrapper owns the flex sizing; the native <select> only honors an explicit
         width:100% in WKWebView (a bare flex-1 select shrinks to its value text). -->
    <div class="flex-1 min-w-0">
      <select
        :value="modelValue"
        class="w-full rounded px-2 py-1 text-[1em] cursor-pointer"
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
