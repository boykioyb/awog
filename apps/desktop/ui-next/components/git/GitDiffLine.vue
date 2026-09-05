<template>
  <div class="dl" :class="line.cls">
    <span class="gn2">{{ line.n }}</span>
    <span class="dc">
      <template v-for="(tk, i) in line.tokens" :key="i">
        <span v-if="tk.cls" :class="tk.cls">{{ tk.text }}</span>
        <template v-else>{{ tk.text }}</template>
      </template>
    </span>
    <button
      v-if="line.cls === 'hunk' && line.hunk !== undefined"
      class="stagehunk"
      :title="staged ? t('git.diff.unstageHunk') : t('git.diff.stageHunk')"
      @click.stop="emit('hunk-action', line.hunk)"
    >
      <Icon :name="staged ? 'rewind' : 'plus'" style="width: 11px; height: 11px" />
      {{ staged ? t('git.diff.unstageHunkBtn') : t('git.diff.stageHunkBtn') }}
    </button>
  </div>
</template>

<script setup lang="ts">
// One diff line (.dl). Tokens render as <span class="t-*"> / text (no v-html). The .dc
// cell is white-space: pre, but Vue's default condense mode drops the newline-containing
// gaps between token elements, so adjacent tokens stay glued — token text is preserved
// verbatim via interpolation (leading indentation lives inside a plain token).
//
// Hunk header rows carry a real button: "Stage hunk" on the unstaged side,
// "Unstage hunk" on the staged side (`staged`). It emits a generic `hunk-action`;
// the viewer maps it to the right store call.
import type { DiffRow } from './git-types'

withDefaults(defineProps<{ line: DiffRow; staged?: boolean }>(), { staged: false })

const emit = defineEmits<{ (e: 'hunk-action', hunk: number): void }>()

const { t } = useI18n()
</script>

<style scoped>
/* The per-hunk affordance is a real (small) button, not bare text. accent-tinted
   pill that fills on hover. Overrides the prototype's text-only `.stagehunk`. */
.stagehunk {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-left: auto;
  flex: 0 0 auto;
  padding: 1px 8px;
  font-size: var(--fs-xs);
  color: var(--accent);
  background: var(--accentDim);
  border: 1px solid var(--accentBorder);
  border-radius: var(--r-xs);
  cursor: pointer;
  transition:
    background 0.12s,
    color 0.12s;
}
.stagehunk:hover {
  background: var(--accent);
  color: var(--accentText);
}
@media (prefers-reduced-motion: reduce) {
  .stagehunk {
    transition: none;
  }
}
</style>
