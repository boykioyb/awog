<template>
  <input
    :value="modelValue"
    :type="type"
    :placeholder="placeholder"
    :disabled="disabled"
    class="w-full rounded px-2 py-1.5 text-[1em] outline-none transition"
    :class="{ 'opacity-60 cursor-not-allowed': disabled }"
    :style="style"
    @input="onInput"
    @blur="emit('blur')"
    @focus="emit('focus')"
  />
</template>

<script setup lang="ts">
import { computed } from 'vue'

type Props = {
  modelValue: string
  type?: 'text' | 'email' | 'password' | 'number'
  placeholder?: string
  disabled?: boolean
  invalid?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  type: 'text',
  placeholder: '',
  disabled: false,
  invalid: false,
})

const emit = defineEmits<{
  'update:modelValue': [value: string]
  blur: []
  focus: []
}>()

const { t } = useTheme()
const { input: glassInput } = useGlass()

const style = computed(() => ({
  background: glassInput.value.background,
  color: t.value.text,
  border: `1px solid ${props.invalid ? t.value.danger : glassInput.value.borderColor}`,
}))

const onInput = (e: Event) => {
  emit('update:modelValue', (e.target as HTMLInputElement).value)
}
</script>
