<template>
  <!-- Teleport to body: mounted once in the layout (like PreviewModal), floats
       above every surface (page, session, preview modal) at the top of the modal
       z-band so a translation opened from inside the preview overlay is visible. -->
  <Teleport to="body">
    <template v-if="active">
      <div class="sttbackdrop" @mousedown="close" />
      <div class="sttpop" :style="popStyle" @mousedown.stop>
        <div class="stthead">
          <Icon name="globe" style="width: 13px; height: 13px" />
          <span class="stttitle">{{ t('translate.title') }}</span>
          <div class="sttlangs">
            <button
              v-for="l in TRANSLATE_LANGS"
              :key="l"
              class="sttlang"
              :class="{ on: lang === l }"
              :title="LANG_LABEL[l]"
              @click="setLang(l)"
            >
              {{ l.toUpperCase() }}
            </button>
          </div>
          <button class="sttx" :title="t('common.close')" @click="close">
            <Icon name="x" style="width: 13px; height: 13px" />
          </button>
        </div>

        <div class="sttbody">
          <div v-if="loading" class="sttstatus">
            <span class="sttspin" />
            {{ t('translate.loading') }}
          </div>
          <div v-else-if="error" class="sttstatus err">
            <span>{{ t('translate.error') }}</span>
            <button class="sttbtn" @click="retry">{{ t('translate.retry') }}</button>
          </div>
          <!-- Translated prose can carry the source's links; a workspace path must open in
               the shared preview, never navigate the SPA (dead route → 404). -->
          <div v-else class="sttresult" @click="onMdLinkClick">
            <template v-for="(seg, i) in resultSegments" :key="i">
              <pre v-if="seg.type === 'mermaid'" class="sttcode"><code>{{ seg.code }}</code></pre>
              <!-- eslint-disable-next-line vue/no-v-html -- sanitized in useMarkdown -->
              <div v-else class="sttmd" v-html="seg.html" />
            </template>
          </div>
        </div>

        <div v-if="!loading && !error && result" class="sttfoot">
          <button class="sttbtn" @click="copyResult">
            <Icon :name="copied ? 'check' : 'copy'" style="width: 12px; height: 12px" />
            {{ copied ? t('translate.copied') : t('translate.copy') }}
          </button>
        </div>
      </div>
    </template>
  </Teleport>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from '~/composables/useI18n'
import { useEscToClose } from '~/composables/useEscToClose'
import { useMarkdown } from '~/composables/useMarkdown'
import { useMdFileLink } from '~/composables/useMdFileLink'
import { useSelectionTranslate } from '~/composables/useSelectionTranslate'

const { t } = useI18n()
const { renderMarkdown } = useMarkdown()
const { onMdLinkClick } = useMdFileLink()
const {
  active,
  lang,
  loading,
  result,
  error,
  copied,
  TRANSLATE_LANGS,
  LANG_LABEL,
  setLang,
  retry,
  close,
  copyResult,
} = useSelectionTranslate()

// Render the translation as markdown (bold, inline code, lists) — model output is
// sanitized by useMarkdown (raw HTML dropped, hrefs sanitized) → v-html-safe.
const resultSegments = computed(() => (result.value ? renderMarkdown(result.value) : []))

const POP_WIDTH = 340

// Anchor near the selection: below by default, flip above when the selection sits
// low in the viewport. Clamp left inside the viewport. window.* is read at open
// time (recomputes when `active` changes) — the popover is transient, no resize
// handling needed.
const popStyle = computed(() => {
  const a = active.value?.anchor
  if (!a) return {}
  const vw = window.innerWidth
  const vh = window.innerHeight
  const left = Math.max(8, Math.min(vw - POP_WIDTH - 8, a.cx - POP_WIDTH / 2))
  const placeAbove = a.bottom > vh * 0.6
  if (placeAbove) {
    return { left: `${left}px`, bottom: `${vh - a.top + 8}px`, width: `${POP_WIDTH}px` }
  }
  return { left: `${left}px`, top: `${a.bottom + 8}px`, width: `${POP_WIDTH}px` }
})

// ESC closes the popover from anywhere (a lang pill focused, the backdrop, …).
useEscToClose(
  () => !!active.value,
  () => close(),
)
</script>

<style scoped>
.sttbackdrop {
  position: fixed;
  inset: 0;
  z-index: 300;
}
.sttpop {
  position: fixed;
  z-index: 301;
  display: flex;
  flex-direction: column;
  max-height: 44vh;
  background: var(--bgEl);
  border: 1px solid var(--borderStrong);
  border-radius: var(--r-btn);
  box-shadow: 0 18px 50px rgba(0, 0, 0, 0.55);
  overflow: hidden;
}
.stthead {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-bottom: 1px solid var(--border);
  color: var(--textDim);
}
.stttitle {
  font-size: 12px;
  font-weight: 500;
  color: var(--text);
}
.sttlangs {
  display: flex;
  gap: 3px;
  margin-left: auto;
}
.sttlang {
  padding: 2px 7px;
  font-size: 12px;
  font-family: var(--code, ui-monospace, monospace);
  line-height: 1.4;
  border-radius: var(--r-xs);
  border: 1px solid var(--border);
  background: transparent;
  color: var(--textDim);
  cursor: pointer;
  transition:
    color 0.12s,
    border-color 0.12s,
    background 0.12s;
}
.sttlang:hover {
  color: var(--text);
  border-color: var(--borderStrong);
}
.sttlang.on {
  color: var(--accent);
  border-color: var(--accentBorder);
  background: var(--accentDim);
}
.sttx {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 3px;
  border-radius: var(--r-xs);
  color: var(--textDim);
  cursor: pointer;
  transition:
    color 0.12s,
    background 0.12s;
}
.sttx:hover {
  color: var(--text);
  background: var(--bgHover);
}
.sttbody {
  padding: 10px 12px;
  overflow-y: auto;
}
.sttresult {
  font-size: 1em;
  line-height: 1.5;
  color: var(--text);
  word-break: break-word;
  user-select: text;
}
/* Rendered-markdown prose inside the popover (sanitized HTML from useMarkdown). */
.sttmd :deep(p) {
  margin: 0 0 8px;
}
.sttmd :deep(strong) {
  font-weight: 650;
}
.sttmd :deep(em) {
  font-style: italic;
}
.sttmd :deep(a) {
  color: var(--accent);
  text-decoration: underline;
}
.sttmd :deep(ul),
.sttmd :deep(ol) {
  margin: 0 0 8px;
  padding-left: 20px;
}
.sttmd :deep(li) {
  margin: 2px 0;
}
.sttmd :deep(h1),
.sttmd :deep(h2),
.sttmd :deep(h3),
.sttmd :deep(h4) {
  font-size: 1.05em;
  font-weight: 650;
  margin: 4px 0 6px;
}
.sttmd :deep(blockquote) {
  margin: 0 0 8px;
  padding-left: 10px;
  border-left: 2px solid var(--border);
  color: var(--textDim);
}
.sttmd :deep(code) {
  font-family: var(--code, ui-monospace, monospace);
  font-size: 0.92em;
  background: var(--bgHover);
  padding: 1px 4px;
  border-radius: var(--r-xs);
}
.sttmd :deep(pre) {
  margin: 0 0 8px;
  padding: 8px 10px;
  background: var(--bgHover);
  border-radius: var(--r-xs);
  overflow-x: auto;
}
.sttmd :deep(pre code) {
  background: none;
  padding: 0;
}
.sttmd :deep(> *:last-child),
.sttmd :deep(li > *:last-child) {
  margin-bottom: 0;
}
.sttcode {
  margin: 0;
  padding: 8px 10px;
  background: var(--bgHover);
  border-radius: var(--r-xs);
  overflow-x: auto;
  font-family: var(--code, ui-monospace, monospace);
  font-size: 0.92em;
}
.sttstatus {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 1em;
  color: var(--textDim);
}
.sttstatus.err {
  color: var(--danger, var(--text));
}
.sttspin {
  width: 13px;
  height: 13px;
  border: 2px solid var(--border);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: sttspin 0.7s linear infinite;
}
@keyframes sttspin {
  to {
    transform: rotate(360deg);
  }
}
.sttfoot {
  display: flex;
  justify-content: flex-end;
  padding: 7px 10px;
  border-top: 1px solid var(--border);
}
.sttbtn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 4px 9px;
  font-size: 1em;
  border-radius: var(--r-xs);
  border: 1px solid var(--border);
  background: transparent;
  color: var(--textDim);
  cursor: pointer;
  transition:
    color 0.12s,
    border-color 0.12s;
}
.sttbtn:hover {
  color: var(--accent);
  border-color: var(--accentBorder);
}
</style>
