<template>
  <div class="seg">
    <span
      v-for="(opt, i) in options"
      :key="optionValue(opt, i)"
      :class="{ on: optionValue(opt, i) === model }"
      @click="model = optionValue(opt, i)"
    >
      {{ optionLabel(opt) }}
    </span>
  </div>
</template>

<script setup lang="ts">
// Segmented toggle — ports seg(opts, on). Controlled via v-model. Options are
// plain strings (label === value) or { label, value } pairs when the stored value
// differs from the visible text (e.g. a model id vs its display name).
type SegOption = string | { label: string; value: string }

defineProps<{
  options: readonly SegOption[]
}>()

const model = defineModel<string>({ required: true })

const optionValue = (opt: SegOption, i: number): string =>
  typeof opt === 'string' ? opt : (opt.value ?? String(i))
const optionLabel = (opt: SegOption): string => (typeof opt === 'string' ? opt : opt.label)
</script>
