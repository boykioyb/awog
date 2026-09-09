<script setup lang="ts">
import { computed } from 'vue'
import type { SessionStepDetail } from '../types'

// The expanded body of a step — the phone counterpart of the desktop's
// SessionStepBody/SessionCodeView. Renders whatever the engine attached to the
// step (`detail`): a real unified diff, a file read, a terminal run, a result
// list, or plain text. Long payloads are clipped (a phone is not where you read
// 4k lines) with the remainder counted, never silently dropped.

const props = defineProps<{ detail: SessionStepDetail }>()

const MAX_LINES = 160

interface Clipped {
  lines: string[]
  hidden: number
}

function clip(src: string): Clipped {
  const all = src.split('\n')
  if (all.length <= MAX_LINES) return { lines: all, hidden: 0 }
  return { lines: all.slice(0, MAX_LINES), hidden: all.length - MAX_LINES }
}

const diff = computed<Clipped | null>(() =>
  props.detail.kind === 'diff' ? clip(props.detail.diff) : null,
)
const file = computed<Clipped | null>(() =>
  props.detail.kind === 'file' ? clip(props.detail.content) : null,
)
const terminalOut = computed<Clipped | null>(() =>
  props.detail.kind === 'terminal' ? clip(props.detail.output ?? '') : null,
)
const text = computed<Clipped | null>(() =>
  props.detail.kind === 'text' ? clip(props.detail.content) : null,
)

function diffClass(line: string): string {
  if (/^(diff --git|index |--- |\+\+\+ )/.test(line)) return 'meta'
  if (line.startsWith('@@')) return 'hunk'
  if (line.startsWith('+')) return 'add'
  if (line.startsWith('-')) return 'del'
  return ''
}
</script>

<template>
  <div class="detail">
    <!-- Unified diff (Edit/Write) -->
    <template v-if="detail.kind === 'diff' && diff">
      <div class="fname">{{ detail.path }}</div>
      <pre class="code"><span
        v-for="(ln, i) in diff.lines"
        :key="i"
        class="ln"
        :class="diffClass(ln)"
      >{{ ln }}
</span></pre>
      <p v-if="diff.hidden" class="more muted">… còn {{ diff.hidden }} dòng</p>
    </template>

    <!-- File content (Read) -->
    <template v-else-if="detail.kind === 'file' && file">
      <div class="fname">{{ detail.path }}</div>
      <pre class="code">{{ file.lines.join('\n') }}</pre>
      <p v-if="file.hidden" class="more muted">… còn {{ file.hidden }} dòng</p>
    </template>

    <!-- Terminal run -->
    <template v-else-if="detail.kind === 'terminal' && terminalOut">
      <div class="lbl">Lệnh</div>
      <pre class="code cmd">{{ detail.command }}</pre>
      <div class="lbl">
        Kết quả
        <span v-if="detail.exitCode != null" class="exit" :class="{ bad: detail.exitCode !== 0 }">
          exit {{ detail.exitCode }}
        </span>
      </div>
      <pre class="code">{{ terminalOut.lines.join('\n') || '(không có output)' }}</pre>
      <p v-if="terminalOut.hidden" class="more muted">… còn {{ terminalOut.hidden }} dòng</p>
    </template>

    <!-- Result list (search / glob / grep) -->
    <ul v-else-if="detail.kind === 'list'" class="list">
      <li v-for="(it, i) in detail.items.slice(0, 60)" :key="i">
        <span class="it-label">{{ it.label }}</span>
        <span v-if="it.path" class="it-path">{{ it.path }}</span>
        <span v-if="it.snippet" class="it-snip muted">{{ it.snippet }}</span>
      </li>
      <li v-if="detail.items.length > 60" class="more muted">
        … còn {{ detail.items.length - 60 }} mục
      </li>
    </ul>

    <!-- Thinking / plain text -->
    <template v-else-if="text">
      <pre class="code wrap">{{ text.lines.join('\n') }}</pre>
      <p v-if="text.hidden" class="more muted">… còn {{ text.hidden }} dòng</p>
    </template>
  </div>
</template>

<style scoped>
.detail {
  margin: 4px 0 8px 21px;
  border: 1px solid var(--border);
  border-radius: var(--r-sm);
  background: var(--surface);
  overflow: hidden;
}
.fname,
.lbl {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 10px;
  /* mono-ok: a file path / an exit code next to the command that produced it. */
  font-family: var(--mono);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  color: var(--text-dim);
  background: var(--surface-2);
  border-bottom: 1px solid var(--border);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.lbl + .code {
  border-bottom: 1px solid var(--border);
}
.exit {
  color: var(--accent);
}
.exit.bad {
  color: var(--danger);
}
.code {
  margin: 0;
  padding: 8px 10px;
  /* mono-ok: code, diff and terminal output. */
  font-family: var(--mono);
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  white-space: pre;
  overflow-x: auto;
  max-height: 320px;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
}
.code.wrap {
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--text-dim);
}
.code.cmd {
  color: var(--accent);
}
/* Lines stay INLINE: the literal newline inside each span does the breaking (the
   parent is `white-space: pre`). display:block would collapse empty lines to 0px
   and double-space every other one. */
.ln.add {
  color: var(--add);
  background: color-mix(in srgb, var(--add) 10%, transparent);
}
.ln.del {
  color: var(--del);
  background: color-mix(in srgb, var(--del) 10%, transparent);
}
.ln.hunk {
  color: var(--text-faint);
}
.ln.meta {
  display: none;
}
.list {
  list-style: none;
  margin: 0;
  padding: 6px 10px;
  max-height: 320px;
  overflow-y: auto;
}
.list li {
  padding: 3px 0;
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.it-path {
  /* mono-ok: a file path. */
  font-family: var(--mono);
  color: var(--text-dim);
}
/* The snippet is the matched LINE of a file — code, so it keeps mono; the label
   above it is prose and does not. */
.it-snip {
  font-family: var(--mono);
}
.it-path,
.it-snip {
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.more {
  margin: 0;
  padding: 6px 10px;
  font-size: var(--fs-sm);
  line-height: var(--lh-sm);
  border-top: 1px solid var(--border);
}
</style>
