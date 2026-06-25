<template>
  <!-- Real unified diff (Edit/MultiEdit) → parsed diff view. -->
  <SessionCodeView
    v-if="diffLines.length"
    mode="diff"
    :fname="target"
    :lines="diffLines"
    embedded
  />
  <!-- File content (Read/Write) → code view. -->
  <SessionCodeView v-else-if="codeText !== null" :fname="target" :code="codeText" embedded />
  <!-- Terminal output / plain text / list → raw. -->
  <pre v-else class="cvcode plain">{{ detail || '(no output)' }}</pre>
</template>

<script setup lang="ts">
// Renders a step's expandable detail (shared by top-level steps + subagent steps).
// Uses the engine `detailKind` to pick the right view with the REAL content (so a
// live Edit shows its actual diff, Read its file). Falls back to the mock DEMO_DIFF
// only for seed/mock steps that carry no real detail.
import type { DiffLine, StepDetailKind } from '~/composables/useSessionsMock'

const props = defineProps<{
  tool: string
  target: string
  detail?: string
  detailKind?: StepDetailKind
}>()
const { DEMO_DIFF } = useSessionsMock()

const isEditish = (t: string): boolean => /edit|write|update|create|notebook/i.test(t)
const isReadish = (t: string): boolean => /read/i.test(t)

const diffLines = computed<DiffLine[]>(() => {
  if (props.detailKind === 'diff' && props.detail) return parseDiff(props.detail)
  // Mock seed Edit/Write (no real detail) → keep the demo diff so the card isn't empty.
  if (!props.detailKind && !props.detail && isEditish(props.tool)) return DEMO_DIFF
  return []
})
const codeText = computed<string | null>(() => {
  if (props.detailKind === 'file') return props.detail ?? ''
  if (!props.detailKind && isReadish(props.tool)) return props.detail || '// (empty)'
  return null
})

// Minimal unified-diff parser → DiffLine[]. Tracks the new-side line number from
// each `@@ -a,b +c,d @@` hunk header; git file-headers are skipped.
function parseDiff(src: string): DiffLine[] {
  const out: DiffLine[] = []
  let newLine = 0
  for (const raw of src.split('\n')) {
    if (raw.startsWith('@@')) {
      const m = /\+(\d+)/.exec(raw)
      newLine = m && m[1] ? parseInt(m[1], 10) : newLine
      out.push({ t: '@', s: raw })
      continue
    }
    if (/^(diff --git|index |--- |\+\+\+ )/.test(raw)) continue
    if (raw.startsWith('+')) {
      out.push({ t: '+', n: newLine, s: raw.slice(1) })
      newLine++
    } else if (raw.startsWith('-')) {
      out.push({ t: '-', s: raw.slice(1) })
    } else {
      out.push({ t: ' ', n: newLine, s: raw.startsWith(' ') ? raw.slice(1) : raw })
      newLine++
    }
  }
  return out
}
</script>

<style scoped>
/* Raw-output <pre>: flush, no card chrome (matches the prototype inline style). */
.cvcode.plain {
  border: none;
  background: transparent;
  padding: 4px 0;
  white-space: pre-wrap;
}
</style>
