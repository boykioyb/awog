<template>
  <div class="ghdiff">
    <div v-if="!rows.length" class="ghdiff-empty">{{ t('projects.drawer.diffEmpty') }}</div>
    <template v-else>
      <div v-for="(r, i) in rows" :key="i" class="dl" :class="r.type">
        <div v-if="r.type === 'hunk'" class="dhunk">{{ r.text }}</div>
        <template v-else>
          <span class="dln">{{ r.oldNo }}</span>
          <span class="dln dln-n">{{ r.newNo }}</span>
          <!-- Single interpolation in a pre-wrap cell — keep on one line so no markup
               whitespace leaks into the rendered diff. -->
          <span class="dc">{{ r.text }}</span>
        </template>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
// Read-only per-file unified-diff view (GitHub style): two line-number gutters
// (old / new), hunk-header rows, and background-coloured add/del rows. The leading
// +/-/space marker stays in the code cell (like GitHub). Long lines WRAP (pre-wrap)
// so the pane never scrolls horizontally; the gutter stays top-aligned. `patch` is
// one file's hunk body (split out of `gh.diff` by useProjectGh.parseUnifiedDiff).
// Interpolation only (never v-html).
const props = defineProps<{ patch: string }>()

const { t } = useI18n()

type DiffRow = { type: 'hunk' | 'add' | 'del' | 'ctx'; oldNo: string; newNo: string; text: string }

const HUNK_RE = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/

const rows = computed<DiffRow[]>(() => {
  if (!props.patch) return []
  let oldNo = 0
  let newNo = 0
  return props.patch.split('\n').map((raw): DiffRow => {
    if (raw.startsWith('@@')) {
      const m = HUNK_RE.exec(raw)
      if (m) {
        oldNo = Number(m[1])
        newNo = Number(m[2])
      }
      return { type: 'hunk', oldNo: '', newNo: '', text: raw }
    }
    if (raw.startsWith('+')) {
      const row: DiffRow = { type: 'add', oldNo: '', newNo: String(newNo), text: raw }
      newNo += 1
      return row
    }
    if (raw.startsWith('-')) {
      const row: DiffRow = { type: 'del', oldNo: String(oldNo), newNo: '', text: raw }
      oldNo += 1
      return row
    }
    const row: DiffRow = { type: 'ctx', oldNo: String(oldNo), newNo: String(newNo), text: raw }
    oldNo += 1
    newNo += 1
    return row
  })
})
</script>

<style scoped>
.ghdiff {
  background: var(--bgInput);
  font-family: var(--code);
  font-size: var(--fs-xs);
  line-height: 1.55;
}
.ghdiff-empty {
  padding: 8px 10px;
  color: var(--textDim);
}
/* Flex rows (not a table) so the code cell wraps reliably while the gutter stays
   fixed-width + top-aligned. */
.dl {
  display: flex;
  align-items: flex-start;
}
/* Line-number gutters: fixed width, right-aligned, faint, non-selectable. */
.dln {
  flex: 0 0 auto;
  width: 34px;
  padding: 0 8px;
  text-align: right;
  color: var(--textFaint);
  user-select: none;
  font-size: var(--fs-xs);
  line-height: 1.55;
  white-space: nowrap;
}
.dln-n {
  border-right: 1px solid var(--border);
}
.dc {
  flex: 1;
  min-width: 0;
  padding: 0 10px;
  color: var(--text);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
/* Background-coloured rows (GitHub colours the row, not the text). */
.dl.add {
  background: var(--addBg);
}
.dl.del {
  background: var(--delBg);
}
.dhunk {
  flex: 1;
  min-width: 0;
  padding: 2px 10px;
  background: var(--bgSubtle);
  color: var(--textDim);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
</style>
