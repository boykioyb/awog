<template>
  <div class="dl" :class="line.cls">
    <span class="gn2">{{ line.n }}</span>
    <span class="dc">
      <template v-for="(tk, i) in line.tokens" :key="i">
        <span v-if="tk.cls" :class="tk.cls">{{ tk.text }}</span>
        <template v-else>{{ tk.text }}</template>
      </template>
    </span>
    <span
      v-if="line.cls === 'hunk' && line.hunk !== undefined"
      class="stagehunk"
      :title="t('git.diff.stageHunk')"
      @click.stop="emit('stage-hunk', line.hunk)"
    >
      {{ t('git.diff.hunk') }}
    </span>
  </div>
</template>

<script setup lang="ts">
// One diff line (.dl). Tokens render as <span class="t-*"> / text (no v-html). The .dc
// cell is white-space: pre, but Vue's default condense mode drops the newline-containing
// gaps between token elements, so adjacent tokens stay glued — token text is preserved
// verbatim via interpolation (leading indentation lives inside a plain token).
import type { DiffRow } from './git-types'

defineProps<{ line: DiffRow }>()

const emit = defineEmits<{ (e: 'stage-hunk', hunk: number): void }>()

const { t } = useI18n()
</script>
