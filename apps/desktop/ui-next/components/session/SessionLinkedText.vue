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
    <!-- Bare file path → chip opening the shared PreviewModal (absolute paths
         outside the workspace preview via their own parent dir — see
         useFilePreview.absScope). Only emitted when a file-preview host exists
         above, so a dead chip never renders. filePreview.open resolves the real
         target itself (index match / on-disk check) and surfaces a clear
         "could not load" when the file is gone — no fake-chip gate needed here. -->
    <a
      v-else-if="seg.type === 'path'"
      class="msglink msgpath"
      role="button"
      :title="seg.value"
      @click.prevent="openPath(seg.value)"
    >
      {{ seg.value }}
    </a>
    <!-- GitHub comment ref ("comment 5949627309") → resolve id → html_url qua
         gh.commentUrl rồi mở browser (xem useGhCommentLink). -->
    <a
      v-else-if="seg.type === 'ghc'"
      class="msglink msggh"
      role="button"
      :title="t('github.comment.open', { id: seg.ghId ?? '' })"
      @click.prevent="openGh?.(seg.ghId!)"
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
//
// Bare FILE PATHS (`/Users/…/draft.md`, `docs/x.md`) get the same treatment as
// the assistant markdown body: shape-matched by the shared PATH_TOKEN_RE and
// gated by filePathOf (closed extension list, no schemes/spaces) — so prose like
// `array.map` or `v1.2.3` still never linkifies.
import {
  filePathOf,
  hasFilePreviewHost,
  useFilePreview,
  PATH_TOKEN_RE,
} from '~/composables/useFilePreview'
import { GH_COMMENT_RE, useGhCommentLink } from '~/composables/useGhCommentLink'

const props = defineProps<{ text: string }>()
const { t } = useI18n()
const filePreview = useFilePreview()
// No preview host above (NOOP inject) → path chips would render but click dead;
// leave them as plain text instead.
const canLinkPaths = hasFilePreviewHost()
// GitHub comment refs — null when no ancestor declared a repo context.
const openGh = useGhCommentLink()

type Seg = {
  type: 'text' | 'link' | 'path' | 'ghc' | 'br'
  value: string
  ghId?: string
}

// Bare URL: http(s):// followed by non-space/non-'<'. Trailing sentence punctuation
// is peeled back off the match so "…/login." or "(…/login)" doesn't swallow the dot
// or paren into the href.
const URL_RE = /https?:\/\/[^\s<]+/g
const TRAILING_PUNCT = /[.,;:!?)\]}'"]+$/

function openPath(path: string): void {
  void filePreview.open(path)
}

// Split a plain-text run into text + linkable segments: file paths
// (PATH_TOKEN_RE gated by filePathOf; `:`-guard skips URL scheme tails) and
// GitHub comment refs (GH_COMMENT_RE; only when a gh opener is injected).
// Overlaps resolve in favour of paths — `comment1234.md` is a file, not a ref.
function pushWithPaths(out: Seg[], run: string): void {
  if ((!canLinkPaths && !openGh) || !/[.\d]/.test(run)) {
    if (run) out.push({ type: 'text', value: run })
    return
  }
  const hits: { index: number; raw: string; seg: Seg }[] = []
  if (canLinkPaths) {
    for (const m of run.matchAll(PATH_TOKEN_RE)) {
      const idx = m.index ?? 0
      if (run[idx - 1] === ':') continue
      if (!filePathOf(m[0])) continue
      hits.push({ index: idx, raw: m[0], seg: { type: 'path', value: m[0] } })
    }
  }
  if (openGh) {
    for (const m of run.matchAll(GH_COMMENT_RE)) {
      const idx = m.index ?? 0
      const raw = m[0]
      if (hits.some((h) => idx < h.index + h.raw.length && idx + raw.length > h.index)) continue
      hits.push({ index: idx, raw, seg: { type: 'ghc', value: raw, ghId: m[1] } })
    }
  }
  hits.sort((a, b) => a.index - b.index)
  let last = 0
  for (const h of hits) {
    if (h.index > last) out.push({ type: 'text', value: run.slice(last, h.index) })
    out.push(h.seg)
    last = h.index + h.raw.length
  }
  if (last < run.length) out.push({ type: 'text', value: run.slice(last) })
}

const segments = computed<Seg[]>(() => {
  const out: Seg[] = []
  const lines = props.text.split('\n')
  lines.forEach((line, li) => {
    if (li > 0) out.push({ type: 'br', value: '' })
    let last = 0
    for (const m of line.matchAll(URL_RE)) {
      const idx = m.index ?? 0
      const raw = m[0]
      const url = raw.replace(TRAILING_PUNCT, '')
      if (idx > last) pushWithPaths(out, line.slice(last, idx))
      out.push({ type: 'link', value: url })
      // Push any peeled-back trailing punctuation as plain text.
      if (url.length < raw.length) pushWithPaths(out, raw.slice(url.length))
      last = idx + raw.length
    }
    if (last < line.length) pushWithPaths(out, line.slice(last))
  })
  return out
})
</script>

<style scoped>
/* Inline link inside a message bubble — primary color + underline (proto link
   idiom, readable on the wash bubble in both themes). Long URLs wrap rather than
   overflow the bubble. */
.msglink {
  color: var(--primary);
  text-decoration: underline;
  text-underline-offset: 2px;
  word-break: break-word;
  cursor: pointer;
}
.msglink:hover {
  text-decoration-thickness: 2px;
}
/* Path chips read as file references, not external URLs — mono like inline code. */
.msgpath {
  font-family: var(--code);
  font-size: 0.92em;
  text-decoration-style: dotted;
}
/* GitHub comment refs — dotted underline marks an external jump. */
.msggh {
  text-decoration-style: dotted;
}
.msggh:hover {
  text-decoration-style: solid;
}
</style>
