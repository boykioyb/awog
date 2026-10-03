<template>
  <input
    ref="el"
    v-model="modelValue"
    :class="
      cn(
        props.unstyled
          ? 'w-full bg-transparent outline-none'
          : 'flex h-[var(--ctrl-h)] w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50',
        props.class,
      )
    "
  />
</template>

<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { computed, useTemplateRef } from 'vue'
import { cn } from '~/lib/utils'

const props = defineProps<{
  modelValue?: string | number | null
  class?: HTMLAttributes['class']
  /** Nhúng trong vỏ bọc đã mang viền/nền riêng (.srch, .gsearch…) — bỏ hết
   *  chrome của Input, chỉ giữ class truyền vào. */
  unstyled?: boolean
}>()

// Call sites replacing a raw <input ref> still need imperative focus/select —
// forward the element so `ref.value.focus()` keeps working after the swap.
const el = useTemplateRef<HTMLInputElement>('el')
defineExpose({
  el,
  focus: () => el.value?.focus(),
  select: () => el.value?.select(),
  blur: () => el.value?.blur(),
})

// DOM input.value is always string — emit string so handlers/assignments can
// stay string-typed. The prop still accepts number|null for bound models.
const emits = defineEmits<(e: 'update:modelValue', payload: string) => void>()

const modelValue = computed({
  get: () => props.modelValue ?? '',
  set: (v) => emits('update:modelValue', String(v)),
})
</script>
