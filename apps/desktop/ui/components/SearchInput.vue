<template>
  <div class="relative">
    <Search
      :size="13"
      class="absolute left-2 top-1/2 -translate-y-1/2 pointer-events-none"
      :style="{ color: t.textDim }"
    />
    <input
      ref="inputRef"
      :value="modelValue"
      :placeholder="placeholder"
      type="text"
      class="w-full rounded pl-7 pr-2 py-1.5 text-[1em] outline-none"
      :style="{
        background: glassInput.background,
        color: t.text,
        border: `1px solid ${glassInput.borderColor}`,
      }"
      @input="onInput"
    />
  </div>
</template>

<script setup lang="ts">
import { Search } from 'lucide-vue-next'
import { ref, onMounted } from 'vue'

type Props = { modelValue: string; placeholder?: string; autofocus?: boolean }
const props = withDefaults(defineProps<Props>(), {
  placeholder: 'Search...',
  autofocus: false,
})
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()

const { t } = useTheme()
const { input: glassInput } = useGlass()
const inputRef = ref<HTMLInputElement | null>(null)

const onInput = (e: Event) => emit('update:modelValue', (e.target as HTMLInputElement).value)

onMounted(() => {
  if (props.autofocus) inputRef.value?.focus()
})
</script>
