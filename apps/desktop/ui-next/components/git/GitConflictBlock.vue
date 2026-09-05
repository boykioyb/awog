<template>
  <div class="cblock" :class="{ chosen: choice !== undefined }">
    <div class="cbhead">
      <span class="cbtitle">
        {{ t('git.conflict.blockTitle', { i: index + 1, n: total, line }) }}
      </span>
      <span style="flex: 1" />
      <button
        class="cbtake"
        :class="{ on: choice === 'ours' }"
        type="button"
        @click="emit('pick', 'ours')"
      >
        {{ t('git.conflict.takeOurs') }}
      </button>
      <button
        class="cbtake"
        :class="{ on: choice === 'theirs' }"
        type="button"
        @click="emit('pick', 'theirs')"
      >
        {{ t('git.conflict.takeTheirs') }}
      </button>
    </div>
    <div class="cbpanes">
      <div class="cbpane" :class="{ on: choice === 'ours' }">
        <div class="cbpanehd">{{ oursLabel || t('git.conflict.ours') }}</div>
        <div v-if="oursRows.length" class="cbcode">
          <GitDiffLine v-for="(l, i) in oursRows" :key="`o${i}`" :line="l" />
        </div>
        <div v-else class="cbempty">{{ t('git.conflict.emptySide') }}</div>
      </div>
      <div class="cbpane" :class="{ on: choice === 'theirs' }">
        <div class="cbpanehd">{{ theirsLabel || t('git.conflict.theirs') }}</div>
        <div v-if="theirsRows.length" class="cbcode">
          <GitDiffLine v-for="(l, i) in theirsRows" :key="`t${i}`" :line="l" />
        </div>
        <div v-else class="cbempty">{{ t('git.conflict.emptySide') }}</div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
// One conflict block — a title row with per-block Take ours / Take theirs, plus two
// read-only panes (OURS as deletions, THEIRS as additions) rendered through the
// shared GitDiffLine so add/del theming is reused. An empty side shows the
// emptySide placeholder (add/add or delete/modify blocks). No hex color: chosen
// state borders via var(--accent), everything else via var(--border) (see <style>).
import type { DiffRow } from './git-types'
import { toDiffLines } from '~/composables/useConflictResolver'

const props = defineProps<{
  index: number
  total: number
  line: number
  ours: string[]
  theirs: string[]
  oursLabel: string
  theirsLabel: string
  choice: 'ours' | 'theirs' | undefined
}>()

const emit = defineEmits<{ (e: 'pick', choice: 'ours' | 'theirs'): void }>()

const { t } = useI18n()

// One plain token carrying the whole line — mirrors GitDiffViewer's `plain`.
const toRows = (lines: string[], kind: 'ours' | 'theirs'): DiffRow[] =>
  toDiffLines(lines, kind).map((l) => ({
    cls: l.t === '+' ? 'add' : 'del',
    n: l.n ?? '',
    tokens: [{ text: l.s, cls: '' as const }],
  }))

const oursRows = computed(() => toRows(props.ours, 'ours'))
const theirsRows = computed(() => toRows(props.theirs, 'theirs'))
</script>

<style scoped>
.cblock {
  border: 1px solid var(--border);
  border-radius: var(--r-sm);
  margin-bottom: 12px;
  overflow: hidden;
}
.cblock.chosen {
  border-color: var(--accent);
}
.cbhead {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  background: var(--bgSubtle);
  border-bottom: 1px solid var(--border);
}
.cbtitle {
  font-size: 12px;
  font-family: var(--code);
  color: var(--textDim);
}
.cbtake {
  padding: 2px 10px;
  border-radius: var(--r-xs);
  border: 1px solid var(--border);
  background: transparent;
  color: var(--textDim);
  cursor: pointer;
  transition:
    background 0.12s,
    color 0.12s,
    border-color 0.12s;
}
.cbtake:hover {
  color: var(--text);
  border-color: var(--accent);
}
.cbtake.on {
  background: var(--accent);
  color: var(--accentText);
  border-color: var(--accent);
}
.cbpanes {
  display: grid;
  grid-template-columns: 1fr 1fr;
}
.cbpane {
  min-width: 0;
  border-right: 1px solid var(--border);
}
.cbpane:last-child {
  border-right: none;
}
.cbpane.on {
  background: var(--accentDim);
}
.cbpanehd {
  padding: 4px 10px;
  font-size: 12px;
  font-family: var(--code);
  color: var(--textDim);
  background: var(--bgSubtle);
  border-bottom: 1px solid var(--border);
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.cbcode {
  overflow-x: auto;
  padding: 4px 0;
}
.cbempty {
  padding: 8px 10px;
  color: var(--textFaint);
  font-style: italic;
}
@media (prefers-reduced-motion: reduce) {
  .cbtake {
    transition: none;
  }
}
</style>
