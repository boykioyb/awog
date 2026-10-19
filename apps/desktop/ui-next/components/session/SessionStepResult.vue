<template>
  <!-- Result chip (proto step-row idiom): bordered micro-pill; "+N" tints
       success, "−N"/"-N" tint destructive, everything else muted. Splitting on
       whitespace (kept as tokens) preserves the original spacing. -->
  <span
    v-if="parts.length"
    class="inline-flex shrink-0 items-center rounded-sm border px-1 text-xs text-muted-foreground tabular-nums"
  >
    <span v-for="(p, i) in parts" :key="i" :class="p.cls">{{ p.s }}</span>
  </span>
</template>

<script setup lang="ts">
const props = defineProps<{ text?: string }>()

function clsOf(token: string): string {
  if (token.startsWith('+')) return 'text-success'
  if (token.startsWith('−') || token.startsWith('-')) return 'text-destructive'
  return ''
}

const parts = computed(() =>
  (props.text || '')
    .split(/(\s+)/)
    .filter(Boolean)
    .map((s) => ({ s, cls: clsOf(s) })),
)
</script>
