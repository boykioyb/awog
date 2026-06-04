<template>
  <div class="flex items-center gap-2">
    <!-- 0.857em ≈ 12px at the default 14px base; scales with the appearance font setting. -->
    <span
      class="text-[0.857em] uppercase tracking-wider font-medium flex-shrink-0 whitespace-nowrap"
      :style="{ color: t.textDim, width: '6rem' }"
    >
      {{ label }}
    </span>
    <!-- Wrapper owns the flex sizing; AppSelect fills it via width:100% (a bare
         flex child <select> shrinks to its value text in WKWebView). -->
    <div class="flex-1 min-w-0">
      <AppSelect
        :model-value="modelValue"
        @update:model-value="(v) => emit('update:modelValue', v)"
      >
        <option v-for="o in options" :key="o.value" :value="o.value">{{ o.label }}</option>
      </AppSelect>
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
