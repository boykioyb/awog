<template>
  <div class="mt-3.5 rounded-md border bg-muted p-2">
    <!-- Toolbar: Write/Preview + markdown insert helpers -->
    <div class="mb-2 flex flex-wrap items-center gap-1">
      <ToggleGroup
        type="single"
        :spacing="1"
        :model-value="mode"
        @update:model-value="(v) => v && (mode = v as 'write' | 'preview')"
      >
        <ToggleGroupItem value="write" :class="SEG">
          {{ t('projects.drawer.write') }}
        </ToggleGroupItem>
        <ToggleGroupItem value="preview" :class="SEG">
          {{ t('projects.drawer.preview') }}
        </ToggleGroupItem>
      </ToggleGroup>
      <Separator orientation="vertical" class="mx-1 h-5" />
      <Button
        v-for="tool in TOOLS"
        :key="tool.k"
        variant="ghost"
        size="iconSm"
        class="text-dim"
        :title="t('projects.drawer.md.' + tool.k)"
        :aria-label="t('projects.drawer.md.' + tool.k)"
        :disabled="mode !== 'write' || posting"
        @click="tool.run()"
      >
        <Icon :name="tool.icon" class="size-3.5" />
      </Button>
    </div>

    <Textarea
      v-show="mode === 'write'"
      ref="ta"
      :model-value="modelValue"
      class="min-h-18 resize-y border-0 bg-transparent p-0 text-base shadow-none focus-visible:ring-0"
      :placeholder="t('projects.drawer.commentPlaceholder')"
      :disabled="posting"
      @update:model-value="onInput"
    />
    <div v-if="mode === 'preview'" class="min-h-18 px-0.5 pt-0.5 pb-1.5 text-base">
      <ProjectGhMarkdown v-if="modelValue.trim()" :source="modelValue" />
      <div v-else class="text-sm text-dim">{{ t('projects.drawer.previewEmpty') }}</div>
    </div>

    <div class="mt-1.5 flex flex-wrap items-center gap-1.5">
      <!-- Translate-draft (LLM) collapsed into one dropdown so the action bar stays
           roomy on a narrow drawer; selecting a language bubbles `translate`. -->
      <Button
        variant="outline"
        size="xs"
        class="font-normal text-dim hover:border-selected-border hover:text-primary"
        :disabled="busy || !modelValue.trim()"
        :title="t('projects.drawer.translate')"
        :aria-label="t('projects.drawer.translate')"
        @click.stop="toggleTrMenu"
      >
        <Icon name="globe" class="size-3" />
        <span>{{ t('projects.drawer.translateMenu') }}</span>
        <Icon name="chev" class="size-3" />
      </Button>
      <Button
        :title="enhancing ? t('projects.drawer.enhancing') : t('projects.drawer.enhance')"
        :aria-label="t('projects.drawer.enhance')"
        :disabled="busy || !modelValue.trim()"
        variant="outline"
        size="iconSm"
        @click="emit('enhance')"
      >
        <Icon
          name="skills"
          class="size-3.5"
          :class="{ 'animate-spin motion-reduce:animate-none': enhancing }"
        />
      </Button>
      <Button
        v-if="canUndo"
        :title="t('projects.drawer.undo')"
        :aria-label="t('projects.drawer.undo')"
        :disabled="busy"
        variant="outline"
        size="iconSm"
        @click="emit('undo')"
      >
        <Icon name="revert" class="size-3.5" />
      </Button>
      <span v-if="translating" class="text-sm text-dim">
        {{ t('projects.drawer.translatingDraft') }}
      </span>
      <span class="flex-1" />
      <Button
        :disabled="posting || !modelValue.trim()"
        :title="t('projects.drawer.comment')"
        variant="default"
        size="sm"
        @click="emit('submit')"
      >
        <Icon :name="posting ? 'clock' : 'send'" />
        {{ posting ? t('projects.drawer.posting') : t('projects.drawer.comment') }}
      </Button>
    </div>

    <!-- Translate-language dropdown (vi / en / ja), anchored under the trigger. -->
    <AppContextMenu
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
import Button from '~/components/ui/button/Button.vue'
import Separator from '~/components/ui/separator/Separator.vue'
import Textarea from '~/components/ui/textarea/Textarea.vue'
import ToggleGroup from '~/components/ui/toggle-group/ToggleGroup.vue'
import ToggleGroupItem from '~/components/ui/toggle-group/ToggleGroupItem.vue'

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
// Textarea shadcn là component ⇒ template ref là instance, element ở `$el`.
const taRef = useTemplateRef<{ $el: HTMLTextAreaElement }>('ta')
const taEl = computed(() => taRef.value?.$el ?? null)
// Tab Write/Preview: đang chọn = accent-tint.
const SEG =
  'h-6.5 rounded-sm border border-transparent px-2.5 text-base font-normal text-dim hover:bg-transparent hover:text-foreground data-[state=on]:border-selected-border data-[state=on]:bg-selected data-[state=on]:font-semibold data-[state=on]:text-primary'
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

function onInput(v: string | number): void {
  emit('update:modelValue', String(v))
}

// Emit the new value, then restore the selection on the controlled textarea after
// Vue re-renders it (the value flows back through the parent's v-model).
function applyEdit(next: string, selStart: number, selEnd: number): void {
  emit('update:modelValue', next)
  nextTick(() => {
    const el = taEl.value
    if (!el) return
    el.focus()
    el.setSelectionRange(selStart, selEnd)
  })
}

// Wrap the current selection with markdown markers (bold/italic/code/link). Empty
// selection → markers inserted with the caret between them.
function surround(before: string, after: string): void {
  const el = taEl.value
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
  const el = taEl.value
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
    const el = taEl.value
    if (!el) return
    el.focus()
    el.setSelectionRange(el.value.length, el.value.length)
  })
}

defineExpose({ focus })
</script>
