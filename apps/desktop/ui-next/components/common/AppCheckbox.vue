<template>
  <button
    type="button"
    role="checkbox"
    :aria-checked="indeterminate ? 'mixed' : checked"
    class="appcb"
    :class="{ on: checked || indeterminate }"
    @click.stop="toggle"
    @keydown.space.prevent="toggle"
  >
    <Minus v-if="indeterminate && !checked" class="appcb-ic" />
    <Check v-else-if="checked" class="appcb-ic" />
  </button>
</template>

<script setup lang="ts">
// Checkbox nhỏ theo token (hàng bulk-select trong CollectionList) — shadcn
// chưa có primitive Checkbox trong repo nên đây là button role=checkbox 16px,
// click không nổi lên row cha (stop).
import { Check, Minus } from 'lucide-vue-next'

const props = withDefaults(defineProps<{ checked?: boolean; indeterminate?: boolean }>(), {
  checked: false,
  indeterminate: false,
})
const emit = defineEmits<{ 'update:checked': [value: boolean] }>()

function toggle() {
  emit('update:checked', !props.checked)
}
</script>

<style scoped>
.appcb {
  display: inline-grid;
  place-items: center;
  width: 16px;
  height: 16px;
  padding: 0;
  border: 1px solid var(--input);
  border-radius: var(--r-xs);
  background: transparent;
  cursor: pointer;
  flex: 0 0 auto;
  transition:
    background-color 0.12s ease,
    border-color 0.12s ease;
}
.appcb:hover {
  border-color: var(--accent);
}
.appcb.on {
  background: var(--accent);
  border-color: var(--accent);
}
.appcb-ic {
  width: 12px;
  height: 12px;
  color: var(--accent-foreground, #fff);
}
.appcb:focus-visible {
  outline: none;
  box-shadow: 0 0 0 1px var(--ring);
}
</style>
