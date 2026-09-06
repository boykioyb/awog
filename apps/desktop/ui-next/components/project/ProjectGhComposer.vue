<template>
  <div class="ghcomposer">
    <!-- Toolbar: Write/Preview + markdown insert helpers -->
    <div class="ghctoolbar">
      <button
        class="ghcseg"
        :class="{ on: mode === 'write' }"
        type="button"
        @click="mode = 'write'"
      >
        {{ t('projects.drawer.write') }}
      </button>
      <button
        class="ghcseg"
        :class="{ on: mode === 'preview' }"
        type="button"
        @click="mode = 'preview'"
      >
        {{ t('projects.drawer.preview') }}
      </button>
      <span class="ghcsep" />
      <button
        v-for="tool in TOOLS"
        :key="tool.k"
        class="ghctool"
        type="button"
        :title="t('projects.drawer.md.' + tool.k)"
        :aria-label="t('projects.drawer.md.' + tool.k)"
        :disabled="mode !== 'write' || posting"
        @click="tool.run()"
      >
        <Icon :name="tool.icon" style="width: 13px; height: 13px" />
      </button>
    </div>

    <textarea
      v-show="mode === 'write'"
      ref="ta"
      :value="modelValue"
      class="ghci"
      :placeholder="t('projects.drawer.commentPlaceholder')"
      :disabled="posting"
      @input="onInput"
    />
    <div v-if="mode === 'preview'" class="ghcpreview ghmd">
      <ProjectGhMarkdown v-if="modelValue.trim()" :source="modelValue" />
      <div v-else class="fd">{{ t('projects.drawer.previewEmpty') }}</div>
    </div>

    <div class="ghcbar">
      <!-- Translate-draft (LLM) collapsed into one dropdown so the action bar stays
           roomy on a narrow drawer; selecting a language bubbles `translate`. -->
      <button
        class="ghclang ghctrlang"
        type="button"
        :disabled="busy || !modelValue.trim()"
        :title="t('projects.drawer.translate')"
        :aria-label="t('projects.drawer.translate')"
        @click.stop="toggleTrMenu"
      >
        <Icon name="globe" style="width: 12px; height: 12px" />
        <span>{{ t('projects.drawer.translateMenu') }}</span>
        <Icon name="chev" style="width: 11px; height: 11px" />
      </button>
      <button
        class="iconbtn"
        type="button"
        :title="enhancing ? t('projects.drawer.enhancing') : t('projects.drawer.enhance')"
        :aria-label="t('projects.drawer.enhance')"
        :disabled="busy || !modelValue.trim()"
        style="width: 28px; height: 28px"
        @click="emit('enhance')"
      >
        <Icon
          name="skills"
          class="enhicon"
          :class="{ enhspin: enhancing }"
          style="width: 14px; height: 14px"
        />
      </button>
      <button
        v-if="canUndo"
        class="iconbtn"
        type="button"
        :title="t('projects.drawer.undo')"
        :aria-label="t('projects.drawer.undo')"
        :disabled="busy"
        style="width: 28px; height: 28px"
        @click="emit('undo')"
      >
        <Icon name="revert" style="width: 14px; height: 14px" />
      </button>
      <span v-if="translating" class="fd ghcbusy">{{ t('projects.drawer.translatingDraft') }}</span>
      <span style="flex: 1" />
      <button
        class="btn pri sm"
        type="button"
        :disabled="posting || !modelValue.trim()"
        :title="t('projects.drawer.comment')"
        @click="emit('submit')"
      >
        <Icon :name="posting ? 'clock' : 'send'" />
        {{ posting ? t('projects.drawer.posting') : t('projects.drawer.comment') }}
      </button>
    </div>

    <!-- Translate-language dropdown (vi / en / ja), anchored under the trigger. -->
    <ContextMenu
      :open="trMenu.pos.value !== null"
      :position="trMenu.pos.value ?? { x: 0, y: 0 }"
      :items="trMenuItems"
      @close="trMenu.close"
      @select="onTrSelect"
    />
  </div>
</template>

<script setup lang="ts">
// Comment composer for the GitHub drawer — a GitHub-style markdown editor: Write /
// Preview toggle, a markdown insert toolbar (bold/italic/code/link/list/quote),
// plus Translate (vi/en/ja) + Enhance (LLM) + Comment. The draft lives in the
// parent controller (useProjectGh) via v-model; translate/enhance/submit bubble up.
// `focus()` is exposed so a Reply action can prefill the draft and focus the input.
import { computed, nextTick, ref, useTemplateRef } from 'vue'
import ProjectGhMarkdown from './ProjectGhMarkdown.vue'
import type { MenuItem } from '~/composables/useContextMenu'
import { useContextMenu } from '~/composables/useContextMenu'
import type { TranslateLang } from '~/composables/useSelectionTranslate'

const props = defineProps<{
  modelValue: string
  posting: boolean
  enhancing: boolean
  translating: boolean
  canUndo: boolean
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', v: string): void
  (e: 'submit'): void
  (e: 'enhance'): void
  (e: 'translate', lang: TranslateLang): void
  (e: 'undo'): void
}>()

const { t } = useI18n()
const ta = useTemplateRef<HTMLTextAreaElement>('ta')
const mode = ref<'write' | 'preview'>('write')
const LANGS: TranslateLang[] = ['vi', 'en', 'ja']
// Any in-flight LLM/post action disables the toolbar's LLM buttons.
const busy = computed(() => props.posting || props.enhancing || props.translating)

// Translate-draft dropdown — collapses the vi/en/ja buttons into one trigger.
// These are one-shot LLM actions (not a view toggle), so no active/checked state.
const trMenu = useContextMenu()
const trMenuItems = computed<MenuItem[]>(() =>
  LANGS.map((lang) => ({ id: lang, label: t('projects.drawer.viewLang.' + lang) })),
)
function toggleTrMenu(e: MouseEvent): void {
  if (trMenu.pos.value) {
    trMenu.close()
    return
  }
  const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
  trMenu.pos.value = { x: r.left, y: r.bottom + 4 }
}
function onTrSelect(id: string): void {
  trMenu.close()
  emit('translate', id as TranslateLang)
}

function onInput(e: Event): void {
  emit('update:modelValue', (e.target as HTMLTextAreaElement).value)
}

// Emit the new value, then restore the selection on the controlled textarea after
// Vue re-renders it (the value flows back through the parent's v-model).
function applyEdit(next: string, selStart: number, selEnd: number): void {
  emit('update:modelValue', next)
  nextTick(() => {
    const el = ta.value
    if (!el) return
    el.focus()
    el.setSelectionRange(selStart, selEnd)
  })
}

// Wrap the current selection with markdown markers (bold/italic/code/link). Empty
// selection → markers inserted with the caret between them.
function surround(before: string, after: string): void {
  const el = ta.value
  if (!el) return
  const s = el.selectionStart
  const e = el.selectionEnd
  const v = el.value
  const sel = v.slice(s, e)
  const next = v.slice(0, s) + before + sel + after + v.slice(e)
  applyEdit(next, s + before.length, s + before.length + sel.length)
}

// Prefix every line in the selection (list / quote).
function prefixLines(prefix: string): void {
  const el = ta.value
  if (!el) return
  const s = el.selectionStart
  const e = el.selectionEnd
  const v = el.value
  const lineStart = v.lastIndexOf('\n', s - 1) + 1
  const block = v.slice(lineStart, e) || ''
  const replaced = block
    .split('\n')
    .map((l) => prefix + l)
    .join('\n')
  const next = v.slice(0, lineStart) + replaced + v.slice(e)
  applyEdit(next, lineStart, lineStart + replaced.length)
}

const TOOLS: { k: string; icon: string; run: () => void }[] = [
  { k: 'bold', icon: 'bold', run: () => surround('**', '**') },
  { k: 'italic', icon: 'italic', run: () => surround('_', '_') },
  { k: 'code', icon: 'code', run: () => surround('`', '`') },
  { k: 'link', icon: 'link', run: () => surround('[', '](url)') },
  { k: 'list', icon: 'listul', run: () => prefixLines('- ') },
  { k: 'quote', icon: 'quote', run: () => prefixLines('> ') },
]

// Focus + caret to end (after a Reply prefills the draft). Switch to Write first so
// the textarea is mounted.
function focus(): void {
  mode.value = 'write'
  nextTick(() => {
    const el = ta.value
    if (!el) return
    el.focus()
    el.setSelectionRange(el.value.length, el.value.length)
  })
}

defineExpose({ focus })
</script>

<style scoped>
.ghcomposer {
  margin-top: 14px;
  border: 1px solid var(--border);
  border-radius: var(--r-sm);
  background: var(--bgInput);
  padding: 9px;
}
.ghctoolbar {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-bottom: 8px;
  flex-wrap: wrap;
}
.ghcseg {
  font-size: 1em;
  padding: 3px 10px;
  border-radius: var(--r-xs);
  border: 1px solid transparent;
  background: transparent;
  color: var(--textDim);
  cursor: pointer;
}
.ghcseg:hover {
  color: var(--text);
}
.ghcseg.on {
  color: var(--accent);
  background: var(--accentDim);
  border-color: var(--accentBorder);
  font-weight: 600;
}
.ghcsep {
  width: 1px;
  align-self: stretch;
  background: var(--border);
  margin: 2px 4px;
}
.ghctool {
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  border-radius: var(--r-xs);
  border: 1px solid transparent;
  background: transparent;
  color: var(--textDim);
  cursor: pointer;
}
.ghctool:hover:not(:disabled) {
  color: var(--text);
  border-color: var(--border);
}
.ghci {
  width: 100%;
  min-height: 4.5rem;
  resize: vertical;
  background: transparent;
  border: none;
  outline: none;
  color: var(--text);
  font-family: inherit;
  font-size: 1em;
  line-height: 1.5;
}
.ghci:disabled {
  opacity: 0.6;
}
.ghcpreview {
  min-height: 4.5rem;
  padding: 2px 2px 6px;
  font-size: 1em;
  line-height: 1.6;
}
.ghcbar {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 6px;
  flex-wrap: wrap;
}
.ghclang {
  font-size: 12px;
  line-height: 18px;
  padding: 2px 8px;
  border-radius: var(--r-xs);
  border: 1px solid var(--border);
  background: transparent;
  color: var(--textDim);
  cursor: pointer;
}
.ghclang:hover:not(:disabled) {
  color: var(--accent);
  border-color: var(--accentBorder);
}
.ghctrlang {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-family: var(--sans);
}
.ghcbusy {
  font-size: 12px;
  line-height: 18px;
}
.btn.pri.sm:disabled,
.iconbtn:disabled,
.ghctool:disabled,
.ghclang:disabled {
  opacity: 0.5;
  cursor: default;
}
.enhicon {
  transition: opacity 0.15s ease;
}
.enhicon.enhspin {
  animation: ghenhspin 0.9s linear infinite;
}
@keyframes ghenhspin {
  to {
    transform: rotate(360deg);
  }
}
@media (prefers-reduced-motion: reduce) {
  .enhicon.enhspin {
    animation: none;
  }
}
</style>
