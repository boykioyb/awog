<template>
  <p class="odp" :class="[para.style, { list: !!para.marker }]" :style="paraStyle">
    <span v-if="para.marker" class="odmk">{{ para.marker }}</span>
    <span class="odtx">
      <template v-for="(run, i) in para.runs" :key="i">
        <a
          v-if="run.href"
          class="odrun odlink"
          :class="runClass(run)"
          :href="run.href"
          target="_blank"
          rel="noopener noreferrer"
        >
          {{ run.text }}
        </a>
        <sub v-else-if="run.vert === 'sub'" class="odrun" :class="runClass(run)">
          {{ run.text }}
        </sub>
        <sup v-else-if="run.vert === 'sup'" class="odrun" :class="runClass(run)">
          {{ run.text }}
        </sup>
        <span v-else class="odrun" :class="runClass(run)">{{ run.text }}</span>
      </template>
    </span>
  </p>
</template>

<script setup lang="ts">
// One DOCX paragraph: optional list marker + its formatted runs. Shared by the
// document body and by table cells (which hold paragraphs too), which is why this
// is its own component rather than markup inlined in OfficeDocView.
import type { DocxParagraph, DocxRun } from '~/utils/office-docx'

const props = defineProps<{ para: DocxParagraph }>()

// Indent steps mirror Word's list levels / left indent; 18px reads as one step.
const paraStyle = computed(() => ({
  ...(props.para.indent ? { paddingLeft: `${props.para.indent * 18}px` } : {}),
  ...(props.para.align ? { textAlign: props.para.align } : {}),
}))

const runClass = (run: DocxRun) => ({
  b: run.bold,
  i: run.italic,
  u: run.underline,
  s: run.strike,
  mono: run.mono,
})
</script>

<style scoped>
.odp {
  margin: 0.55em 0;
  line-height: 1.7;
  color: var(--text);
}
.odp.h1,
.odp.h2,
.odp.h3,
.odp.h4 {
  font-weight: 700;
  line-height: 1.3;
  margin: 1.15em 0 0.5em;
}
.odp.h1 {
  font-size: 1.6em;
  border-bottom: 1px solid var(--border);
  padding-bottom: 0.3em;
}
.odp.h2 {
  font-size: 1.35em;
}
.odp.h3 {
  font-size: 1.15em;
}
.odp.h4 {
  font-size: 1.05em;
}
.odp.quote {
  border-left: 3px solid var(--border);
  padding-left: 1em;
  color: var(--textMuted);
}
.odp.code {
  /* mono-ok: code paragraph in a .docx render */
  font-family: var(--code);
  font-size: 0.9em;
  background: var(--bgSubtle);
  border: 1px solid var(--border);
  border-radius: var(--r-sm);
  padding: 10px 12px;
}
.odp.caption {
  font-size: var(--fs-sm);
  color: var(--textFaint);
}
/* List rows: marker in its own column so wrapped text aligns under the text. */
.odp.list {
  display: flex;
  gap: 8px;
  margin: 0.2em 0;
}
.odmk {
  flex: 0 0 auto;
  min-width: 18px;
  color: var(--textDim);
  font-variant-numeric: tabular-nums;
}
/* DOCX runs carry their own line breaks (w:br) and tabs — keep them. Scoped to the
   run container so the surrounding template's own indentation can't leak in. */
.odtx {
  min-width: 0;
  white-space: pre-wrap;
}
.odrun.b {
  font-weight: 700;
}
.odrun.i {
  font-style: italic;
}
.odrun.u {
  text-decoration: underline;
}
.odrun.s {
  text-decoration: line-through;
}
.odrun.u.s {
  text-decoration: underline line-through;
}
.odrun.mono {
  /* mono-ok: monospace run carried over from the .docx */
  font-family: var(--code);
  font-size: 0.9em;
}
.odlink {
  color: var(--accent);
  text-decoration: underline;
}
</style>
