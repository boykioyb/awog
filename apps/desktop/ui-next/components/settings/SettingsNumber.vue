<template>
  <div class="keyrow">
    <input
      v-model="display"
      class="keyinp mono"
      type="number"
      :min="min"
      :max="max"
      :step="step"
      @change="commit"
      @blur="commit"
    />
  </div>
</template>

<script setup lang="ts">
// Bounded numeric input for settings.
//
// The field edits a local string (`display`) so typing is unconstrained —
// intermediate values below the min, or a momentarily empty field, are allowed
// while the cursor is in the box. Clamp + persist happen on commit (blur / Enter).
//
// Why not clamp inside a v-model setter on the store: once the clamped value
// equals the current model (you are sitting on the boundary), Vue skips the
// input patch and the field keeps showing whatever was typed (e.g. 9999999).
// Committing here always rewrites `display` to the canonical clamped string, so
// the DOM resyncs even in that boundary case.
import { ref, watch } from 'vue'

const props = withDefaults(
  defineProps<{
    modelValue: number
    min?: number
    max?: number
    step?: number
  }>(),
  { min: undefined, max: undefined, step: undefined },
)

const emit = defineEmits<{ 'update:modelValue': [value: number] }>()

// `type="number"` makes v-model cast the bound value to a number, so this ref
// may hold a number (valid input) or a string (empty / unparseable). Coerce
// with String() before any string op.
const display = ref<string | number>(props.modelValue)

// Reflect external changes (store reset, programmatic update) into the field.
watch(
  () => props.modelValue,
  (v) => {
    display.value = String(v)
  },
)

function clamp(value: number): number {
  let next = value
  if (props.min !== undefined) next = Math.max(props.min, next)
  if (props.max !== undefined) next = Math.min(props.max, next)
  return next
}

function commit(): void {
  const text = String(display.value).trim()
  const raw = Number(text)
  const next = clamp(text !== '' && Number.isFinite(raw) ? raw : props.modelValue)
  if (next !== props.modelValue) emit('update:modelValue', next)
  // Always rewrite the field to the canonical value — covers the boundary case
  // where `next === modelValue` and the watch above would not fire.
  display.value = String(next)
}
</script>
