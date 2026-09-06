<template>
  <!-- Sanitized markdown for an issue/PR body, comment or review. useMarkdown drops raw
       HTML + unsafe hrefs and Shiki-escapes code, splitting the source into ordered HTML
       runs + mermaid fences. Each HTML run is inlined imperatively (innerHTML on a
       Vue-owned node, not v-html) so the scoped .ghmd styles apply, mirroring
       SessionMarkdownHtml; each mermaid fence renders as a live, zoomable <MermaidView>
       diagram — the same renderer the session transcript uses. -->
  <div class="ghmdbody" @click="onMdLinkClick">
    <template v-for="(seg, i) in segments" :key="i">
      <MermaidView v-if="seg.type === 'mermaid'" :code="seg.code" />
      <div v-else :ref="(el) => setSegHtml(el, seg.html)" class="ghmdseg" />
    </template>
  </div>
</template>

<script setup lang="ts">
// One markdown run for the GitHub drawer (body / comment / review). Reuses
// useMarkdown().renderMarkdown — the same sanitized renderer the session transcript
// uses — which returns ordered HTML runs + mermaid fences. HTML runs inline
// imperatively (no v-html); mermaid fences reuse <MermaidView> so issue/PR prose gets
// live diagrams instead of the plain code card they fell back to before.
import { useMarkdown } from '~/composables/useMarkdown'
import { useMdFileLink } from '~/composables/useMdFileLink'
import { useCodeBlockAttacher } from '~/composables/useCodeBlockControls'

const props = withDefaults(
  defineProps<{
    source: string
    // Absolute root of the project the issue/PR belongs to, when the caller knows it —
    // a repo-relative path in the body then opens in the shared preview.
    workspaceRoot?: string | null
  }>(),
  { workspaceRoot: null },
)

const { renderMarkdown } = useMarkdown()
const attachCodeBlockControls = useCodeBlockAttacher()
// A repo-relative path in an issue/PR body (`docs/x.md`) must not navigate the SPA;
// GitHub URLs are external and keep their default (open-in-browser) behaviour.
const { onMdLinkClick } = useMdFileLink(() => props.workspaceRoot)

const segments = computed(() => renderMarkdown(props.source || ''))

// Inline a segment's sanitized HTML imperatively (function ref). The template ref hands
// an `Element | ComponentPublicInstance | null`; narrow at the boundary. A WeakMap of
// the last HTML written per node skips redundant innerHTML rebuilds on re-render.
const written = new WeakMap<HTMLElement, string>()
function setSegHtml(el: unknown, html: string): void {
  const node = el instanceof HTMLElement ? el : null
  if (!node || written.get(node) === html) return
  written.set(node, html)
  node.innerHTML = html
  // Re-attach the per-code-block controls: innerHTML just dropped the previous ones.
  attachCodeBlockControls(node)
}
</script>

<style scoped>
/* Inherit the drawer's .ghmd typography (font-size/line-height); add the inline
   prose styling the markdown needs. Colors via theme tokens only. */
/* Gap between segments (a prose run ↔ a diagram); within a run, the prose rules below
   own the spacing. */
/* Issue / PR bodies are long-form text, so they take the prose measure rather than the
   tighter UI leading inherited from the drawer. */
.ghmdbody {
  line-height: var(--lh-prose);
}
.ghmdbody > * + * {
  margin-top: 9px;
}
/* Trim each segment's outer block margins so the inter-segment gap stays uniform. */
.ghmdseg :deep(:first-child) {
  margin-top: 0;
}
.ghmdseg :deep(:last-child) {
  margin-bottom: 0;
}
.ghmdbody :deep(p) {
  margin: 0 0 9px;
}
.ghmdbody :deep(strong),
.ghmdbody :deep(b) {
  font-weight: 600;
}
.ghmdbody :deep(em) {
  font-style: italic;
}
.ghmdbody :deep(code) {
  /* mono-ok: inline code in the markdown render */
  font-family: var(--code);
  background: var(--bgInput);
  border: 1px solid var(--border);
  border-radius: var(--r-xs);
  padding: 0 4px;
  font-size: 0.92em;
  overflow-wrap: anywhere;
}
.ghmdbody :deep(pre) {
  margin: 0 0 9px;
  padding: 10px 12px;
  background: var(--bgInput);
  border: 1px solid var(--border);
  border-radius: var(--r-sm);
  overflow-x: auto;
  line-height: var(--lh-sm);
}
.ghmdbody :deep(pre code) {
  background: none;
  border: 0;
  padding: 0;
  font-size: 0.92em;
}
.ghmdbody :deep(ul),
.ghmdbody :deep(ol) {
  margin: 0 0 9px;
  padding-left: 22px;
}
.ghmdbody :deep(ul) {
  list-style: disc;
}
.ghmdbody :deep(ol) {
  list-style: decimal;
}
.ghmdbody :deep(li) {
  margin: 3px 0;
}
.ghmdbody :deep(a) {
  color: var(--accent);
  text-decoration: underline;
  text-underline-offset: 2px;
}
.ghmdbody :deep(blockquote) {
  margin: 0 0 9px;
  padding: 2px 0 2px 12px;
  border-left: 3px solid var(--border);
  color: var(--textDim);
}
.ghmdbody :deep(h1),
.ghmdbody :deep(h2),
.ghmdbody :deep(h3),
.ghmdbody :deep(h4),
.ghmdbody :deep(h5) {
  font-weight: 600;
  /* design-token-ok: heading font-size is em-relative (ADR 0079 leaves `em` alone), so
     no single whole-pixel leading exists for the whole h1…h6 group. */
  line-height: 1.3;
  margin: 14px 0 7px;
}
.ghmdbody :deep(h1) {
  font-size: 1.3em;
}
.ghmdbody :deep(h2) {
  font-size: 1.18em;
}
.ghmdbody :deep(h3) {
  font-size: 1.08em;
}
.ghmdbody :deep(hr) {
  border: 0;
  border-top: 1px solid var(--border);
  margin: 12px 0;
}
.ghmdbody :deep(table) {
  display: block;
  width: max-content;
  max-width: 100%;
  overflow-x: auto;
  border-collapse: collapse;
  margin: 0 0 10px;
  font-size: 0.96em;
}
.ghmdbody :deep(th),
.ghmdbody :deep(td) {
  border: 1px solid var(--border);
  padding: 6px 11px;
  text-align: left;
  vertical-align: top;
}
.ghmdbody :deep(th) {
  background: var(--bgInput);
  font-weight: 600;
}
.ghmdbody :deep(img) {
  max-width: 100%;
}
</style>
