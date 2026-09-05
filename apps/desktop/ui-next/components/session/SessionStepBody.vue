<template>
  <!-- Full path, above the code/diff. The step header can only ellipsise a long path
       (losing the filename) and the EMBEDDED code view hides its own filename header,
       so without this row the path is readable nowhere once it gets long. -->
  <div v-if="pathText" class="stepio">
    <div class="stepio-lbl">{{ t('sessions.step.path') }}</div>
    <pre class="cvcode plain steppath">{{ pathText }}</pre>
  </div>
  <!-- Real unified diff (Edit/MultiEdit) → parsed diff view. -->
  <SessionCodeView
    v-if="diffLines.length"
    mode="diff"
    :fname="target"
    :lines="diffLines"
    embedded
  />
  <!-- File content (Read/Write) → code view. Its own filename header is suppressed
       when embedded; the Path row above is what names the file. -->
  <SessionCodeView v-else-if="codeText !== null" :fname="target" :code="codeText" embedded />
  <!-- Terminal output / plain text / list → Input + Output split. The header
       truncates the input (command / query / url); here it shows in full,
       clearly separated from the result. -->
  <template v-else>
    <div v-if="inputText" class="stepio">
      <div class="stepio-lbl">{{ t('sessions.step.input') }}</div>
      <pre class="cvcode plain">{{ inputText }}</pre>
    </div>
    <div class="stepio">
      <div v-if="inputText" class="stepio-lbl">{{ t('sessions.step.output') }}</div>
      <pre class="cvcode plain">{{ detail || t('sessions.step.noOutput') }}</pre>
    </div>
  </template>
</template>

<script setup lang="ts">
// Renders a step's expandable detail (shared by top-level steps + subagent steps).
// Uses the engine `detailKind` to pick the right view with the REAL content (so a
// live Edit shows its actual diff, Read its file). A step with no captured detail
// renders NOTHING here — never a placeholder diff, which would read as content the
// tool actually wrote.
import type { DiffLine, StepDetailKind } from '~/composables/useSessionsData'

const props = defineProps<{
  tool: string
  target: string
  detail?: string
  detailKind?: StepDetailKind
}>()
const { t } = useI18n()

const isReadish = (t: string): boolean => /read/i.test(t)

// Full input for the raw branch (terminal command, search pattern, fetched URL,
// MCP args…). It's the step `target`, which the engine carries un-truncated — the
// header only ellipsises it, so this is where the user reads the whole command.
const inputText = computed<string>(() => props.target?.trim() ?? '')

const diffLines = computed<DiffLine[]>(() => {
  if (props.detailKind === 'diff' && props.detail) return parseDiff(props.detail)
  return []
})
const codeText = computed<string | null>(() => {
  if (props.detailKind === 'file') return props.detail ?? ''
  if (!props.detailKind && isReadish(props.tool)) return props.detail || '// (empty)'
  return null
})

// The path row belongs to the diff / code branches only — the raw branch below
// already prints the full target as its Input block.
const pathText = computed<string>(() => {
  if (diffLines.value.length === 0 && codeText.value === null) return ''
  return inputText.value
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
/* Input / Output split: a small muted label above each <pre>, with a hairline
   between the input and output blocks so they read as distinct sections. */
.stepio + .stepio {
  margin-top: 6px;
  padding-top: 6px;
  border-top: 1px solid var(--border);
}
/* A path has no spaces to wrap at, so break it anywhere rather than let it scroll
   out of view — the point of this row is that the WHOLE path is visible. */
.steppath {
  word-break: break-all;
}
.stepio-lbl {
  font-size: var(--fs-xs);
  font-weight: 650;
  color: var(--textDim);
}
</style>
