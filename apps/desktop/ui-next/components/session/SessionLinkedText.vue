<template>
  <template v-for="(seg, i) in segments" :key="i">
    <br v-if="seg.type === 'br'" />
    <a
      v-else-if="seg.type === 'link'"
      class="msglink"
      :href="seg.value"
      target="_blank"
      rel="noopener noreferrer"
      :title="seg.value"
    >
      {{ seg.value }}
    </a>
    <template v-else>{{ seg.value }}</template>
  </template>
</template>

<script setup lang="ts">
// Render plain (untrusted) message text with bare http(s) URLs turned into
// highlighted, clickable links — without markdown parsing or v-html (so user
// input stays literal + XSS-safe). Newlines become <br>. Used by the user + system
// bubbles, whose text is otherwise printed verbatim (no linkification). External
// links open in the OS browser via the Electron will-navigate handler (window.ts).
const props = defineProps<{ text: string }>()

type Seg = { type: 'text' | 'link' | 'br'; value: string }

// Bare URL: http(s):// followed by non-space/non-'<'. Trailing sentence punctuation
// is peeled back off the match so "…/login." or "(…/login)" doesn't swallow the dot
// or paren into the href.
const URL_RE = /https?:\/\/[^\s<]+/g

const segments = computed<Seg[]>(() => {
  const out: Seg[] = []
  const lines = props.text.split('\n')
  lines.forEach((line, li) => {
    if (li > 0) out.push({ type: 'br', value: '' })
    let last = 0
    for (const m of line.matchAll(URL_RE)) {
      const idx = m.index ?? 0
      const raw = m[0]
      const url = raw.replace(/[.,;:!?)\]}'"]+$/, '')
      if (idx > last) out.push({ type: 'text', value: line.slice(last, idx) })
      out.push({ type: 'link', value: url })
      // Push any peeled-back trailing punctuation as plain text.
      if (url.length < raw.length) out.push({ type: 'text', value: raw.slice(url.length) })
      last = idx + raw.length
    }
    if (last < line.length) out.push({ type: 'text', value: line.slice(last) })
  })
  return out
})
</script>

<style scoped>
/* Highlighted inline link inside a message bubble — accent color + hover underline,
   matching the app's link affordance. Long URLs wrap rather than overflow the bubble. */
.msglink {
  color: var(--accent);
  text-decoration: none;
  word-break: break-word;
  cursor: pointer;
}
.msglink:hover {
  text-decoration: underline;
}
</style>
