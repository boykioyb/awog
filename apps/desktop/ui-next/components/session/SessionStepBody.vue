<template>
  <!-- Nhãn mục (Path / Input / Output) + khối pre; nhãn Output có hairline phía trên để
       hai khối raw đọc thành hai phần riêng. -->
  <!-- Full path, above the code/diff. The step header can only ellipsise a long path
       (losing the filename) and the EMBEDDED code view hides its own filename header,
       so without this row the path is readable nowhere once it gets long. -->
  <div v-if="pathText" class="flex flex-col gap-0.5">
    <div class="text-xs font-medium text-muted-foreground">{{ t('sessions.step.path') }}</div>
    <!-- mono-ok: path / payload thô của tool -->
    <pre class="m-0 font-mono text-xs break-all whitespace-pre-wrap text-muted-foreground">{{
      pathText
    }}</pre>
  </div>
  <!-- Detail stub kept off the wire (sessions.get lite) — fetched lazily on
       expand via sessions.stepDetail; show a loading line instead of letting
       the branches below render "(no output)" / "(empty)". -->
  <div v-if="pending" class="flex flex-col gap-0.5">
    <pre class="m-0 font-mono text-xs whitespace-pre-wrap text-muted-foreground">{{
      t('sessions.step.loading')
    }}</pre>
  </div>
  <!-- Real unified diff (Edit/MultiEdit) → parsed diff view. -->
  <template v-if="!pending">
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
       clearly separated from the result. `data-sout` is the hook SessionStepItem
       tints destructive on a failed step. -->
    <template v-else>
      <div v-if="inputText" class="flex flex-col gap-0.5">
        <div class="text-xs font-medium text-muted-foreground">
          {{ t('sessions.step.input') }}
        </div>
        <pre class="m-0 font-mono text-xs break-all whitespace-pre-wrap text-foreground/85">{{
          inputText
        }}</pre>
      </div>
      <div class="flex flex-col gap-0.5">
        <div v-if="inputText" class="border-t pt-1.5 text-xs font-medium text-muted-foreground">
          {{ t('sessions.step.output') }}
        </div>
        <pre data-sout class="m-0 font-mono text-xs whitespace-pre-wrap text-muted-foreground">{{
          detail || t('sessions.step.noOutput')
        }}</pre>
      </div>
    </template>
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
  // Detail body kept off the wire (sessions.get lite) — true while the
  // sessions.stepDetail fetch is in flight; renders a loading line instead of
  // letting the detail branches render "(no output)".
  pending?: boolean
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
