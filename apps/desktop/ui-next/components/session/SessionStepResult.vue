<template>
  <span class="sres">
    <span v-for="(p, i) in parts" :key="i" :class="p.cls">{{ p.s }}</span>
  </span>
</template>

<script setup lang="ts">
// Step-header result string (the `.sres` span). Diff counts like "+18 −4" get their
// +N token tinted green and −N token red; everything else stays faint. Splitting on
// whitespace (kept as tokens) preserves the original spacing.
const props = defineProps<{ text?: string }>()

function clsOf(token: string): string {
  if (token.startsWith('+')) return 'add'
  if (token.startsWith('−') || token.startsWith('-')) return 'del'
  return ''
}

const parts = computed(() =>
  (props.text || '')
    .split(/(\s+)/)
    .filter(Boolean)
    .map((s) => ({ s, cls: clsOf(s) })),
)
</script>

<style scoped>
.add {
  color: var(--add);
}
.del {
  color: var(--del);
}
</style>
