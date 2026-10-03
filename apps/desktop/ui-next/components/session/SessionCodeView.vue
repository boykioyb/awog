<template>
  <div class="cview" :class="{ embedded }">
    <!-- When embedded inside a step body the filename header is redundant (the step
         header already names the tool + file), so it's hidden. -->
    <div v-if="!embedded" class="cvhead">
      <Icon
        :name="mode === 'diff' ? 'git' : 'commands'"
        style="width: var(--icon-xs); height: var(--icon-xs)"
      />
      <span class="min-w-0 truncate">{{ fname }}</span>
      <span class="cvlang">{{ mode === 'diff' ? 'diff' : 'ts' }}</span>
    </div>

    <!-- Unified diff: one row per line — [new-side line no.] [sign] [content].
         + rows tint success, − rows tint destructive, @@ hunk headers sit muted
         italic on a faint wash (proto diff idiom). -->
    <div v-if="mode === 'diff'" class="cvdiff">
      <div
        v-for="(l, i) in lines"
        :key="i"
        class="drow"
        :class="{ add: l.t === '+', del: l.t === '-', hunk: l.t === '@' }"
      >
        <span class="dnum">{{ l.n ?? '' }}</span>
        <span class="dsign">{{ SIGN[l.t] }}</span>
        <span class="dc">{{ l.s }}</span>
      </div>
    </div>

    <div v-else class="cvbody">
      <pre class="cvgut">{{ gutter }}</pre>
      <pre class="cvcode">{{ code }}</pre>
    </div>
  </div>
</template>

<script setup lang="ts">
// codeBlock / diffBlock (prototype ~1866) — shared between step details and the
// workspace panel. Syntax highlight from the prototype's hl() is dropped (visual
// fidelity is preserved by the .cvcode mono styling); plain text avoids v-html.
import type { DiffLine } from '~/composables/useSessionsData'

const props = withDefaults(
  defineProps<{
    fname: string
    mode?: 'code' | 'diff'
    code?: string
    lines?: DiffLine[]
    // Flatten for use inside a step body: hide the filename header + drop the
    // margin so it reads as part of the step (no card-in-card).
    embedded?: boolean
  }>(),
  { mode: 'code', code: '', lines: () => [], embedded: false },
)

const gutter = computed(() =>
  Array.from({ length: props.code.split('\n').length }, (_, i) => i + 1).join('\n'),
)

// Per-line change marker shown in the diff gutter (− is U+2212, matching the +N −N badge).
const SIGN: Record<DiffLine['t'], string> = { '+': '+', '-': '−', ' ': '', '@': '' }
</script>

<style scoped>
/* Bordered code box on a faint wash — same chrome in step bodies and standalone
   (proto: `rounded-md border border-border` + `bg-muted/40` on file content). */
.cview {
  margin: 4px 0;
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: var(--r-sm);
  background: rgb(from var(--muted) r g b / 40%);
}
.cview.embedded {
  margin: 0;
}
.cvhead {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 6px 10px;
  border-bottom: 1px solid var(--border);
  font-family: var(--code); /* mono-ok: the file path being shown */
  font-size: 11px;
  line-height: 16px;
  color: var(--muted-foreground);
  background: var(--muted);
}
.cvlang {
  margin-left: auto;
  flex: 0 0 auto;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--textFaint);
}
.cvbody {
  display: flex;
  overflow-x: auto;
}
.cvgut {
  margin: 0;
  padding: 8px;
  text-align: right;
  color: var(--textFaint);
  font-family: var(--code); /* mono-ok: gutter numbers sit in the code grid */
  font-size: 11px;
  line-height: 18px;
  user-select: none;
  border-right: 1px solid var(--border);
  background: var(--muted);
  white-space: pre;
  flex: 0 0 auto;
}
.cvcode {
  margin: 0;
  padding: 8px 12px;
  font-family: var(--code); /* mono-ok: file content */
  font-size: 11px;
  line-height: 18px;
  color: rgb(from var(--foreground) r g b / 90%);
  white-space: pre;
  flex: 1;
}
.cvdiff {
  font-family: var(--code); /* mono-ok: diff body */
  font-size: 11px;
  line-height: 18px;
  overflow-x: auto;
}
/* `.drow` — named away from the legacy global `.dl` rules so no property leaks
   in from prototype.css. */
.drow {
  display: flex;
  min-width: max-content;
  color: var(--muted-foreground);
}
/* Line-number gutter: fixed narrow rail, half-strength text (proto `w-8 …
   opacity-50`); the sign column carries the +/− marker. */
.dnum {
  width: 32px;
  flex: 0 0 auto;
  padding: 0 6px;
  text-align: right;
  user-select: none;
  border-right: 1px solid var(--border);
  opacity: 0.5;
  font-variant-numeric: tabular-nums;
}
.dsign {
  width: 16px;
  flex: 0 0 auto;
  text-align: center;
  user-select: none;
}
.dc {
  padding-right: 12px;
  white-space: pre;
}
.drow.add {
  background: rgb(from var(--success) r g b / 10%);
  color: var(--success);
}
.drow.del {
  background: rgb(from var(--destructive) r g b / 10%);
  color: var(--destructive);
}
.drow.hunk {
  background: rgb(from var(--muted) r g b / 60%);
  color: var(--muted-foreground);
  font-style: italic;
}
</style>
