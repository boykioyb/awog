<template>
  <div class="relative w-full">
    <!-- appearance-none strips the OS control so the box honors padding/height
         the same way AppInput does — in WKWebView a native <select> ignores
         vertical padding and renders shorter than sibling inputs. The chevron
         below replaces the OS arrow we just removed. -->
    <select
      :value="modelValue"
      :disabled="disabled"
      class="w-full appearance-none [-webkit-appearance:none] rounded pl-2 pr-7 py-1.5 text-[1em] outline-none transition"
      :class="{
        'cursor-not-allowed opacity-60': disabled,
        'cursor-pointer': !disabled,
        'font-mono': mono,
      }"
      :style="style"
      @change="onChange"
    >
      <slot />
    </select>
    <ChevronDown
      :size="13"
      class="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2"
      :style="{ color: t.textDim }"
    />
  </div>
</template>

<script setup lang="ts" generic="T extends string | number = string">
import { computed } from 'vue'
import { ChevronDown } from 'lucide-vue-next'

type Props = {
  modelValue: T
  disabled?: boolean
  // Render the value text in the monospace font (ids, slugs, paths).
  mono?: boolean
  invalid?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  disabled: false,
  mono: false,
  invalid: false,
})

const emit = defineEmits<{
  'update:modelValue': [value: T]
}>()

const { t } = useTheme()
const { input: glassInput } = useGlass()

const style = computed(() => ({
  background: glassInput.value.background,
  color: t.value.text,
  border: `1px solid ${props.invalid ? t.value.danger : glassInput.value.borderColor}`,
}))

// The native value is always a string; cast back to the bound model type (T is
// constrained to string | number, so every concrete option value is a string).
const onChange = (e: Event) => {
  emit('update:modelValue', (e.target as HTMLSelectElement).value as T)
}
</script>
